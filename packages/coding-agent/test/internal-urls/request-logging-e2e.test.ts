import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import { InternalUrlRouter } from "@f5-sales-demo/xcsh/internal-urls/router";
import { InternalDocsProtocolHandler } from "@f5-sales-demo/xcsh/internal-urls/xcsh-protocol";
import type { ToolSession } from "@f5-sales-demo/xcsh/tools";
import { GrepTool } from "@f5-sales-demo/xcsh/tools/grep";

/**
 * End-to-end UAT for the retrieval-ergonomics fixes, driven over the REAL
 * `xcsh://` handler and the REAL embedded generated specs (not synthetic
 * fixtures). This is the scenario from the customer session that motivated the
 * work: reaching the `http_loadbalancer` configuration to answer a
 * request-logging question.
 */

function realRouter(): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(new InternalDocsProtocolHandler());
	return router;
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(c => c.type === "text")
		.map(c => c.text ?? "")
		.join("\n");
}

describe("request-logging retrieval — end-to-end over real generated specs", () => {
	let tmpDir: string;
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rl-e2e-"));
	});
	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("resolves the real http_loadbalancer spec in the virtual domain", async () => {
		const res = await realRouter().resolve("xcsh://api-spec/virtual?resource=http_loadbalancer");
		expect(res.content).toContain("http_loadbalancer");
		// Not the fallback renders.
		expect(res.content).not.toMatch(/^# (Domain|Resource) not found/);
	});

	it("cross-domain resolves a wrong-domain request (config -> virtual) with a note", async () => {
		const res = await realRouter().resolve("xcsh://api-spec/config?resource=http_loadbalancer");
		expect(res.content).toContain("resolved resource");
		expect(res.content).toContain("http_loadbalancer");
		expect(res.content).not.toContain("# Domain not found");
	});

	it("grep finds a field inside the real spec via in-memory search (no glob error)", async () => {
		const session = {
			cwd: tmpDir,
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated({ "grep.contextBefore": 0, "grep.contextAfter": 0 }),
			internalRouter: realRouter(),
		} as unknown as ToolSession;
		const tool = new GrepTool(session);

		// The `?` in the URL must not trip the glob guard, and the match must come
		// from the resolved in-memory content (synthetic sourcePath, no real file).
		const result = await tool.execute("rl-e2e", {
			pattern: "http_loadbalancer",
			path: "xcsh://api-spec/virtual?resource=http_loadbalancer",
		});
		expect(resultText(result)).toContain("http_loadbalancer");
	});

	it("renders the guided-workflow index (the path enable_request_logging uses once synced)", async () => {
		const res = await realRouter().resolve("xcsh://api-spec/workflows/");
		// An existing workflow proves the rendering path; enable_request_logging
		// (api-specs-enriched#924) arrives here via the enriched-specs-updated sync.
		expect(res.content).toContain("enable_waf_protection");
	});
});
