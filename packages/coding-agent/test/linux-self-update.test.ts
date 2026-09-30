import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { replaceStandaloneExecutable } from "../src/cli/update-cli";

const version = "22.4.5";
const tag = `v${version}`;
const targetPath = "/opt/example/xcsh/bin/xcsh";
const script = Buffer.from("#!/bin/sh\nexit 0\n");
const source = {
	type: "file",
	path: "scripts/install.sh",
	encoding: "base64",
	size: script.length,
	sha: createHash("sha1").update(`blob ${script.length}\0`).update(script).digest("hex"),
	content: script.toString("base64"),
};
const assets = [
	"xcsh-linux-x64",
	"xcsh-linux-x64.sha256",
	"xcsh-linux-x64.provenance.json",
	"xcsh-linux-x64.provenance.json.sha256",
].map(name => ({ name, digest: `sha256:${"1".repeat(64)}`, size: 10 }));
const release = { tag_name: tag, draft: false, prerelease: false, immutable: true, assets };

function harness(overrides: { release?: unknown; source?: unknown; failure?: boolean } = {}) {
	const requests: string[] = [];
	const executions: { script: Buffer; installDir: string; version: string }[] = [];
	return {
		requests,
		executions,
		options: {
			targetPath,
			platform: "linux" as const,
			arch: "x64" as const,
			fetchImpl: async (input: string | URL | Request) => {
				const url = String(input);
				requests.push(url);
				return Response.json(
					url.includes("/releases/") ? (overrides.release ?? release) : (overrides.source ?? source),
				);
			},
			runLinuxInstaller: async (input: { script: Buffer; installDir: string; version: string }) => {
				executions.push(input);
				if (overrides.failure) throw new Error("verified installer failed");
			},
		},
	};
}

describe("Linux standalone self-update integrity", () => {
	it("executes only the authenticated tagged installer with the exact target and version", async () => {
		const h = harness();
		await replaceStandaloneExecutable(version, h.options);
		expect(h.requests).toEqual([
			`https://api.github.com/repos/f5-sales-demo/xcsh/releases/tags/${tag}`,
			`https://api.github.com/repos/f5-sales-demo/xcsh/contents/scripts/install.sh?ref=${tag}`,
		]);
		expect(h.executions).toEqual([{ script, installDir: "/opt/example/xcsh/bin", version }]);
	});

	it.each([
		["mutable", { ...release, immutable: false }],
		["draft", { ...release, draft: true }],
		["prerelease", { ...release, prerelease: true }],
		["wrong tag", { ...release, tag_name: "v22.4.3" }],
	])("rejects a %s release before fetching or executing installer code", async (_name, invalid) => {
		const h = harness({ release: invalid });
		await expect(replaceStandaloneExecutable(version, h.options)).rejects.toThrow("immutable release");
		expect(h.requests).toHaveLength(1);
		expect(h.executions).toEqual([]);
	});

	it.each([
		["modified bytes", { ...source, content: Buffer.from("modified").toString("base64") }],
		["wrong size", { ...source, size: source.size + 1 }],
		["wrong blob", { ...source, sha: "0".repeat(40) }],
		["wrong file", { ...source, path: "scripts/other.sh" }],
		["symlink", { ...source, type: "symlink" }],
		["oversized source", { ...source, size: 256 * 1024 + 1 }],
	])("rejects %s without running installer code", async (_name, invalid) => {
		const h = harness({ source: invalid });
		await expect(replaceStandaloneExecutable(version, h.options)).rejects.toThrow("installer source");
		expect(h.executions).toEqual([]);
	});

	it.each([
		["historical binary-only payload", []],
		["duplicate binary", [...assets, assets[0]]],
		["missing checksum", assets.filter(asset => !asset.name.endsWith(".sha256"))],
		["unverifiable asset", assets.map(asset => ({ ...asset, digest: null }))],
	])("rejects %s before fetching installer source", async (_name, invalid) => {
		const h = harness({ release: { ...release, assets: invalid } });
		await expect(replaceStandaloneExecutable(version, h.options)).rejects.toThrow("integrity assets");
		expect(h.requests).toHaveLength(1);
		expect(h.executions).toEqual([]);
	});

	it("does not fall back when release metadata cannot be fetched", async () => {
		const h = harness();
		await expect(
			replaceStandaloneExecutable(version, {
				...h.options,
				fetchImpl: async () => new Response(null, { status: 503 }),
			}),
		).rejects.toThrow("immutable release metadata");
		expect(h.executions).toEqual([]);
	});

	it("rejects a renamed target before performing a request or writing an adjacent executable", async () => {
		const h = harness();
		await expect(
			replaceStandaloneExecutable(version, { ...h.options, targetPath: "/opt/example/xcsh/bin/renamed" }),
		).rejects.toThrow("xcsh executable path");
		expect(h.requests).toEqual([]);
	});

	it("propagates verified installer failure instead of falling back to binary-only replacement", async () => {
		const h = harness({ failure: true });
		await expect(replaceStandaloneExecutable(version, h.options)).rejects.toThrow("verified installer failed");
		expect(h.executions).toHaveLength(1);
		expect(h.requests).toHaveLength(2);
	});

	it("rejects an unstable version before performing any request", async () => {
		const h = harness();
		await expect(replaceStandaloneExecutable("22.4.5-preview", h.options)).rejects.toThrow(
			"stable published version",
		);
		expect(h.requests).toEqual([]);
	});

	it.skipIf(process.platform === "win32")(
		"forwards actual installer arguments and installation directory",
		async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-verified-update-"));
			const bytes = Buffer.from('printf "%s\\n" "$@" > "$PI_INSTALL_DIR/installer-args"\n');
			const metadata = {
				...source,
				size: bytes.length,
				content: bytes.toString("base64"),
				sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
			};
			const h = harness({ source: metadata });
			try {
				await replaceStandaloneExecutable(version, {
					...h.options,
					targetPath: path.join(dir, "xcsh"),
					runLinuxInstaller: undefined,
				});
				expect(fs.readFileSync(path.join(dir, "installer-args"), "utf8")).toBe("--binary\n--ref\nv22.4.5\n");
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"reports a real installer exit without mutating the previous executable",
		async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-verified-update-failure-"));
			const target = path.join(dir, "xcsh");
			const bytes = Buffer.from("exit 7\n");
			const metadata = {
				...source,
				size: bytes.length,
				content: bytes.toString("base64"),
				sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
			};
			const h = harness({ source: metadata });
			fs.writeFileSync(target, "previous executable");
			try {
				await expect(
					replaceStandaloneExecutable(version, { ...h.options, targetPath: target, runLinuxInstaller: undefined }),
				).rejects.toThrow("status 7");
				expect(fs.readFileSync(target, "utf8")).toBe("previous executable");
				expect(fs.readdirSync(dir)).toEqual(["xcsh"]);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
