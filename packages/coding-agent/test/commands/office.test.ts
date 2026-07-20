/**
 * `xcsh office` command tests.
 *
 *  - `manifest` (via the `writeManifest` seam) writes a valid, parseable manifest
 *    that keeps the local-ip.sh task-pane page URL;
 *  - the positional `action` arg rejects unknown subcommands (framework `options`
 *    constraint), and accepts the three real ones.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CliConfig } from "@f5-sales-demo/pi-utils/cli";
import { OFFICE_ACTIONS, writeManifest } from "../../src/cli/office-cli";
import Office from "../../src/commands/office";

const config: CliConfig = { bin: "xcsh", version: "0.0.0", commands: new Map() };

// `writeManifest` reads packages/office-pane/dist in dev mode; build it so the
// test is self-sufficient regardless of cross-package run order.
const OFFICE_PANE_DIR = resolve(import.meta.dir, "..", "..", "..", "office-pane");

beforeAll(() => {
	const result = spawnSync("bun", ["run", "build.ts"], { cwd: OFFICE_PANE_DIR, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`office-pane build.ts failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
	}
});

describe("office manifest", () => {
	it("writes a valid manifest that keeps the local-ip.sh task-pane URL", async () => {
		const dir = mkdtempSync(join(tmpdir(), "office-cmd-test-"));
		try {
			const out = join(dir, "manifest.json");
			const text = await writeManifest(out);

			const written = await Bun.file(out).json();
			expect(written.extensions[0].runtimes[0].code.page).toBe("https://127-0-0-1.local-ip.sh:8444/taskpane.html");
			expect(written.extensions[0].requirements.scopes).toContain("document");
			// The returned text is the same JSON.
			expect(JSON.parse(text).id).toBe(written.id);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("office action arg validation", () => {
	it("accepts the three real subcommands", async () => {
		for (const action of OFFICE_ACTIONS) {
			const { args } = await new Office([action], config).parse(Office);
			expect(args.action).toBe(action);
		}
	});

	it("rejects an unknown subcommand", async () => {
		await expect(new Office(["bogus"], config).parse(Office)).rejects.toThrow(/one of/);
	});
});
