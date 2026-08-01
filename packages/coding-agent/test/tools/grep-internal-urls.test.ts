import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { ArtifactProtocolHandler } from "../../src/internal-urls/artifact-protocol";
import { InternalUrlRouter } from "../../src/internal-urls/router";
import type { ToolSession } from "../../src/tools";
import { GrepTool } from "../../src/tools/grep";

function getResultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(c => c.type === "text")
		.map(c => c.text ?? "")
		.join("\n");
}

describe("GrepTool internal URL resolution", () => {
	let tmpDir: string;
	let artifactsDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-test-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		await fs.mkdir(artifactsDir);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
		return {
			cwd: tmpDir,
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated({ "grep.contextBefore": 0, "grep.contextAfter": 0 }),
			...overrides,
		};
	}

	function createRouterWithArtifacts(): InternalUrlRouter {
		const router = new InternalUrlRouter();
		router.register(new ArtifactProtocolHandler({ getArtifactsDir: () => artifactsDir }));
		return router;
	}

	it("resolves artifact:// URL to backing file and greps it", async () => {
		const content = "line one\nfound the needle here\nline three\n";
		await Bun.write(path.join(artifactsDir, "5.bash.log"), content);

		const router = createRouterWithArtifacts();
		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		const result = await tool.execute("test-call", {
			pattern: "needle",
			path: "artifact://5",
		});

		const text = getResultText(result);
		expect(text).toContain("needle");
	});

	it("greps artifact:// with regex pattern", async () => {
		const content = "ERROR: connection refused\nWARN: timeout\nERROR: disk full\nINFO: ok\n";
		await Bun.write(path.join(artifactsDir, "3.python.log"), content);

		const router = createRouterWithArtifacts();
		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		const result = await tool.execute("test-call", {
			pattern: "ERROR.*",
			path: "artifact://3",
		});

		const text = getResultText(result);
		expect(text).toContain("connection refused");
		expect(text).toContain("disk full");
		expect(text).not.toContain("timeout");
		expect(text).not.toContain("INFO");
	});

	it("greps in-memory content when an internal URL has no backing file (#2)", async () => {
		const router = new InternalUrlRouter();
		router.register({
			scheme: "agent",
			async resolve() {
				return {
					url: "agent://0",
					content: "line one\nthe needle is here\nline three\n",
					contentType: "text/plain" as const,
				};
			},
		});

		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		const result = await tool.execute("test-call", { pattern: "needle", path: "agent://0" });
		const text = getResultText(result);
		expect(text).toContain("needle");
	});

	it("does not treat a query string as a glob for internal URLs (#1)", async () => {
		const router = new InternalUrlRouter();
		router.register({
			scheme: "spec",
			async resolve() {
				return {
					url: "spec://virtual?resource=http_loadbalancer",
					content: "spec fields\n  request_logs: {}\n  other: 1\n",
					contentType: "text/markdown" as const,
					// synthetic, non-filesystem sourcePath (like api-spec/api-catalog)
					sourcePath: "spec://virtual",
				};
			},
		});

		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		// The `?` must NOT trigger "Glob patterns are not supported".
		const result = await tool.execute("test-call", {
			pattern: "request_logs",
			path: "spec://virtual?resource=http_loadbalancer",
		});
		const text = getResultText(result);
		expect(text).toContain("request_logs");
	});

	it("rejects real glob metacharacters in internal URL paths (#1)", async () => {
		const router = new InternalUrlRouter();
		router.register({
			scheme: "spec",
			async resolve() {
				return { url: "spec://x", content: "x", contentType: "text/plain" as const };
			},
		});
		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		expect(tool.execute("test-call", { pattern: "foo", path: "spec://virtual*?resource=x" })).rejects.toThrow(
			"Glob patterns are not supported for internal URLs",
		);
	});

	it("falls back to normal path resolution when no internalRouter", async () => {
		await Bun.write(path.join(tmpDir, "test.txt"), "hello world\n");

		const session = createSession(); // no internalRouter
		const tool = new GrepTool(session);

		const result = await tool.execute("test-call", {
			pattern: "hello",
			path: "test.txt",
		});

		const text = getResultText(result);
		expect(text).toContain("hello");
	});

	it("falls back to normal resolution for non-internal URLs", async () => {
		await Bun.write(path.join(tmpDir, "data.log"), "some data here\n");

		const router = createRouterWithArtifacts();
		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		const result = await tool.execute("test-call", {
			pattern: "data",
			path: "data.log",
		});

		const text = getResultText(result);
		expect(text).toContain("data");
	});

	it("throws on nonexistent artifact ID", async () => {
		const router = createRouterWithArtifacts();
		const session = createSession({ internalRouter: router });
		const tool = new GrepTool(session);

		expect(tool.execute("test-call", { pattern: "foo", path: "artifact://999" })).rejects.toThrow(
			"Artifact 999 not found",
		);
	});
});
