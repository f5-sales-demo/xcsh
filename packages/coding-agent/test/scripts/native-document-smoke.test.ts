import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const helper = path.resolve(import.meta.dir, "../../../../scripts/install-tests/native-document-smoke.ts");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function runFixture(output: string, cache?: string, code = 0, readonlyCapture = false) {
	const root = await mkdtemp(path.join(os.tmpdir(), "native-document-contract-"));
	const candidate = path.join(root, "candidate.ts");
	const recordPath = path.join(root, "received.json");
	await writeFile(
		candidate,
		`#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(recordPath)}, JSON.stringify({ cache: process.env.XCSH_RELEASE_CACHE_DIR ?? null, args: process.argv.slice(2), config: process.env.PI_CONFIG_DIR }));\n${readonlyCapture ? `require("node:fs").chmodSync(require("node:path").dirname(process.env.PI_CONFIG_DIR), 0o500);` : ""}
process.stdout.write(${JSON.stringify(output)});\nprocess.exitCode = ${code};\n`,
		{ mode: 0o700 },
	);
	await chmod(candidate, 0o700);
	const child = Bun.spawn([process.execPath, helper, candidate], {
		env: { ...process.env, XCSH_RELEASE_CACHE_DIR: cache },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const received = JSON.parse(await readFile(recordPath, "utf8"));
	return {
		root,
		exitCode,
		stdout,
		stderr,
		received,
		async close() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

describe("ordinary native document smoke candidate and failure evidence", () => {
	test("preserves the exact selected release cache while isolating user configuration", async () => {
		const selected = path.join(os.tmpdir(), "reviewed candidate cache with spaces");
		const run = await runFixture("Method: markit\nSynthetic document content.\n", selected);
		try {
			expect(run.exitCode).toBe(0);
			expect(run.received.cache).toBe(selected);
			expect(run.received.args).toHaveLength(2);
			expect(run.received.args[0]).toBe("read");
			expect(run.received.args[1]).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+\/synthetic\.pdf$/);
			expect(run.received.config).not.toBe(process.env.PI_CONFIG_DIR);
		} finally {
			await run.close();
		}
	});

	test("omitting a selected cache leaves ordinary launcher selection unchanged", async () => {
		const run = await runFixture("Method: markit\nSynthetic document content.\n");
		try {
			expect(run.exitCode).toBe(0);
			expect(run.received.cache).toBeNull();
		} finally {
			await run.close();
		}
	});
	test("caps retained output and rejects truncated native evidence", async () => {
		const output = "Method: markit\nSynthetic document content.\n" + "x".repeat(70_000);
		const run = await runFixture(output);
		let retained: string | undefined;
		try {
			expect(run.exitCode).not.toBe(0);
			const matched = /NATIVE_DOCUMENT_SMOKE_FAILURE (\{[^\n]+\})/.exec(run.stderr);
			expect(matched).not.toBeNull();
			const diagnostic = JSON.parse(matched![1]);
			retained = diagnostic.retainedDirectory;
			expect(diagnostic.stdoutTruncated).toBe(true);
			expect(diagnostic.stdoutBytesObserved).toBe(Buffer.byteLength(output));
			expect((await readFile(path.join(retained!, "stdout.private.log"))).length).toBe(64 * 1024);
		} finally {
			if (retained) await rm(retained, { recursive: true, force: true });
			await run.close();
		}
	});

	for (const [label, output, code, method, content] of [
		["wrong converter", "Method: fallback\nSynthetic document content.\n", 0, false, true],
		["missing content", "Method: markit\n", 0, true, false],
		["failed process", "Method: markit\nSynthetic document content.\n", 7, true, true],
	] as const) {
		test(`retains private output and distinguishes ${label} without weakening acceptance`, async () => {
			const run = await runFixture(output, undefined, code);
			let retained: string | undefined;
			try {
				expect(run.exitCode).not.toBe(0);
				const matched = /NATIVE_DOCUMENT_SMOKE_FAILURE (\{[^\n]+\})/.exec(run.stderr);
				expect(matched).not.toBeNull();
				const diagnostic = JSON.parse(matched![1]);
				retained = diagnostic.retainedDirectory;
				expect(diagnostic.criteria).toEqual({
					exitCodeZero: code === 0,
					nativeMethodMatched: method,
					contentMatched: content,
				});
				expect(diagnostic.exitCode).toBe(code);
				expect(diagnostic.stdoutSha256).toBe(hash(output));
				const capture = path.join(retained!, "stdout.private.log");
				expect(await readFile(capture, "utf8")).toBe(output);
				expect((await stat(capture)).mode & 0o777).toBe(0o600);
				expect(run.stderr).not.toContain(output.trim());
			} finally {
				if (retained) await rm(retained, { recursive: true, force: true });
				await run.close();
			}
		});
	}
});

test("evidence write failure preserves the primary conversion criteria and storage cause", async () => {
	const run = await runFixture("Method: fallback\nSynthetic document content.\n", undefined, 0, true);
	const directory = path.dirname(run.received.config);
	try {
		expect(run.exitCode).not.toBe(0);
		expect(run.stderr).toContain("EACCES");
		const matched = /NATIVE_DOCUMENT_SMOKE_FAILURE (\{[^\n]+\})/.exec(run.stderr);
		expect(matched).not.toBeNull();
		const diagnostic = JSON.parse(matched![1]);
		expect(diagnostic.criteria).toEqual({ exitCodeZero: true, nativeMethodMatched: false, contentMatched: true });
		expect(run.stderr).not.toContain("Method: fallback\nSynthetic document content.");
	} finally {
		await chmod(directory, 0o700);
		await rm(directory, { recursive: true, force: true });
		await run.close();
	}
});
