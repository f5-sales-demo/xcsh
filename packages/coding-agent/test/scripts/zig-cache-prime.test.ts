import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../../../..");
const downloader = path.join(root, "scripts/ci-download-zig-archive.sh");
const payload = Buffer.from("checksum-verified Zig archive fixture with resumable bytes");
const checksum = createHash("sha256").update(payload).digest("hex");

type Step = { id?: string; name?: string; uses?: string; if?: string; with?: Record<string, string> };
type Action = { inputs: Record<string, { default: string }>; runs: { steps: Step[] } };
type Workflow = {
	on: { push: { branches: string[]; paths: string[] }; schedule: { cron: string }[]; workflow_dispatch: unknown };
	permissions: Record<string, string>;
	jobs: Record<
		string,
		{
			if: string;
			strategy: { "fail-fast": boolean; matrix: { os: string[] } };
			"timeout-minutes": number;
			steps: Step[];
		}
	>;
};

describe("hosted Zig archive priming", () => {
	test("seeds all hosted native platforms on main daily, on installer changes, and manually", async () => {
		const workflow = Bun.YAML.parse(
			await readFile(path.join(root, ".github/workflows/zig-cache-prime.yml"), "utf8"),
		) as Workflow;
		expect(workflow.on.push.branches).toEqual(["main"]);
		expect(workflow.on.push.paths).toContain(".github/actions/setup-zig/**");
		expect(workflow.on.push.paths).toContain("scripts/ci-download-zig-archive.sh");
		expect(workflow.on.schedule).toEqual([{ cron: "17 3 * * *" }]);
		expect(workflow.on).toHaveProperty("workflow_dispatch");
		expect(workflow.permissions).toEqual({ contents: "read" });
		const prime = workflow.jobs.prime;
		expect(prime.if).toBe("github.ref == 'refs/heads/main'");
		expect(prime.strategy["fail-fast"]).toBe(false);
		expect(prime.strategy.matrix.os).toEqual(["macos-15-intel", "macos-14", "windows-latest"]);
		expect(prime["timeout-minutes"]).toBe(45);
		expect(prime.steps.find(step => step.uses === "./.github/actions/setup-zig")?.with).toEqual({
			"cache-build": "false",
		});
	});

	test("saves the verified archive immediately with the restore key and identical path", async () => {
		const action = Bun.YAML.parse(
			await readFile(path.join(root, ".github/actions/setup-zig/action.yml"), "utf8"),
		) as Action;
		expect(action.inputs["cache-build"].default).toBe("true");
		const steps = action.runs.steps;
		const restore = steps.find(step => step.id === "archive");
		const save = steps.find(step => step.uses?.startsWith("actions/cache/save@"));
		if (!restore || !save) throw new Error("Archive restore/save steps are required");
		expect(restore?.uses).toStartWith("actions/cache/restore@");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		expect(restore?.with?.key).toBe("setup-zig-archive-${{ runner.os }}-${{ runner.arch }}-0.16.0");
		expect(save?.with?.path).toBe(restore?.with?.path);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		expect(save?.with?.key).toBe("${{ steps.archive.outputs.cache-primary-key }}");
		expect(save?.if).toContain("steps.archive.outputs.cache-hit != 'true'");
		const installIndex = steps.findIndex(step => step.name === "Install Zig 0.16.0");
		expect(steps[installIndex + 1]).toBe(save);
		expect(steps.find(step => step.name === "Restore Zig build cache")?.if).toContain("inputs.cache-build == 'true'");
	});
});

async function downloadFixture(
	mode: "resume" | "range-refused" | "unavailable" | "bad-checksum" | "warm" | "corrupt-cache",
	runnerOs = "Linux",
) {
	const directory = await mkdtemp(path.join(tmpdir(), "xcsh-zig-download-"));
	const destination = path.join(directory, "cache/zig.tar.xz");
	const staging = path.join(directory, "staging/zig.part");
	const tools = path.join(directory, "tools");
	const delays = path.join(directory, "delays");
	await mkdir(tools);
	await writeFile(path.join(tools, "sleep"), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$ZIG_TEST_DELAYS"\n');
	await chmod(path.join(tools, "sleep"), 0o755);
	if (mode === "warm" || mode === "corrupt-cache") {
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, mode === "warm" ? payload : "corrupt");
	}
	const ranges: (string | undefined)[] = [];
	let publishedDuringDownload = false;
	const server = createServer(async (request, response) => {
		ranges.push(request.headers.range);
		publishedDuringDownload ||= await Bun.file(destination).exists();
		if (mode === "unavailable") {
			response.writeHead(503);
			response.end();
			return;
		}
		if ((mode === "resume" || mode === "range-refused") && ranges.length === 1) {
			response.writeHead(200, { "Content-Length": payload.length, Connection: "close" });
			response.end(payload.subarray(0, 12));
			return;
		}
		if (request.headers.range && mode !== "range-refused") {
			const offset = Number(request.headers.range.match(/bytes=(\d+)-/)?.[1]);
			response.writeHead(206, {
				"Content-Range": `bytes ${offset}-${payload.length - 1}/${payload.length}`,
				"Content-Length": payload.length - offset,
			});
			response.end(payload.subarray(offset));
			return;
		}
		const body = mode === "bad-checksum" ? Buffer.from("invalid archive") : payload;
		response.writeHead(200, { "Content-Length": body.length });
		response.end(body);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port");
	try {
		const child = Bun.spawn(
			["bash", downloader, `http://127.0.0.1:${address.port}/archive`, checksum, destination, staging],
			{
				env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, RUNNER_OS: runnerOs, ZIG_TEST_DELAYS: delays },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return {
			code,
			stdout,
			stderr,
			ranges,
			publishedDuringDownload,
			archive: (await Bun.file(destination).exists()) ? await readFile(destination) : undefined,
			delays: (await Bun.file(delays).exists()) ? (await readFile(delays, "utf8")).trim().split("\n") : [],
		};
	} finally {
		await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
		await rm(directory, { recursive: true, force: true });
	}
}

describe("resilient checksum-verified Zig downloads", () => {
	test("uses a valid archive without contacting the server", async () => {
		const result = await downloadFixture("warm");
		expect(result.code).toBe(0);
		expect(result.ranges).toEqual([]);
		expect(result.archive).toEqual(payload);
	});
	for (const os of ["Linux", "macOS", "Windows"]) {
		test(`retains partial bytes and resumes before publishing on ${os}`, async () => {
			const result = await downloadFixture("resume", os);
			expect(result.code).toBe(0);
			expect(result.ranges).toEqual([undefined, "bytes=12-"]);
			expect(result.delays).toEqual(["5"]);
			expect(result.publishedDuringDownload).toBe(false);
			expect(result.archive).toEqual(payload);
		});
	}
	test("restarts cleanly when a server refuses a resumed range", async () => {
		const result = await downloadFixture("range-refused");
		expect(result.code).toBe(0);
		expect(result.ranges).toEqual([undefined, "bytes=12-", undefined]);
		expect(result.delays).toEqual(["5", "10"]);
		expect(result.archive).toEqual(payload);
	});
	test("fails after four attempts without publishing a partial archive", async () => {
		const result = await downloadFixture("unavailable");
		expect(result.code).not.toBe(0);
		expect(result.ranges).toHaveLength(4);
		expect(result.delays).toEqual(["5", "10", "20"]);
		expect(result.archive).toBeUndefined();
	});
	test("rejects incorrect checksums without publishing", async () => {
		const result = await downloadFixture("bad-checksum");
		expect(result.code).not.toBe(0);
		expect(result.ranges).toHaveLength(1);
		expect(result.archive).toBeUndefined();
	});
	test("replaces a corrupt cached archive with verified bytes", async () => {
		const result = await downloadFixture("corrupt-cache");
		expect(result.code).toBe(0);
		expect(result.ranges).toHaveLength(1);
		expect(result.publishedDuringDownload).toBe(false);
		expect(result.archive).toEqual(payload);
	});
});
