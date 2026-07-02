import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { chooseSessionContext, resolveAutoBind } from "../src/services/session-context-binding";
import { ContextService } from "../src/services/xcsh-context";

let cfg: string;
beforeEach(() => {
	cfg = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-cfg-"));
	fs.mkdirSync(path.join(cfg, "contexts"), { recursive: true });
	delete process.env.XCSH_API_URL;
});
afterEach(() => fs.rmSync(cfg, { recursive: true, force: true }));

function writeContext(name: string, apiUrl: string): void {
	fs.writeFileSync(
		path.join(cfg, "contexts", `${name}.json`),
		JSON.stringify({ schemaVersion: 1, name, apiUrl, apiToken: "t", defaultNamespace: "default" }),
	);
}

describe("foundation: no startup auto-load", () => {
	test("fresh init with one context does NOT auto-activate", async () => {
		writeContext("solo", "https://solo.console.ves.volterra.io");
		const svc = ContextService.init(cfg);
		// Under the clean break, initializing the service must NOT load a context.
		expect(svc.getStatus().activeContextName ?? null).toBeNull();
	});
});

describe("foundation: bind decisions over real contexts", () => {
	beforeEach(async () => {
		await Settings.init({ inMemory: true, cwd: cfg });
	});
	afterEach(() => {
		_resetSettingsForTest();
	});

	test("fresh folder + one context → auto-binds and activates", async () => {
		writeContext("solo", "https://solo.console.ves.volterra.io");
		const svc = ContextService.init(cfg);
		const available = (await svc.listContexts()).map(c => c.name);
		const choice = chooseSessionContext(
			undefined,
			resolveAutoBind({ kind: "cli", availableContexts: available, folderContext: null }),
		);
		expect(choice).toEqual({ activate: "solo" });
		if ("activate" in choice) await svc.activate(choice.activate);
		expect(svc.getStatus().activeContextName).toBe("solo");
	});

	test("fresh folder + multiple contexts, no link → unbound (needsSelection)", async () => {
		writeContext("a", "https://a.console.ves.volterra.io");
		writeContext("b", "https://b.console.ves.volterra.io");
		const svc = ContextService.init(cfg);
		const available = (await svc.listContexts()).map(c => c.name);
		const choice = chooseSessionContext(
			undefined,
			resolveAutoBind({ kind: "cli", availableContexts: available, folderContext: null }),
		);
		expect(choice).toEqual({ needsSelection: true });
		expect(svc.getStatus().activeContextName ?? null).toBeNull();
	});

	test("resume: bound name re-activates regardless of count", async () => {
		writeContext("a", "https://a.console.ves.volterra.io");
		writeContext("b", "https://b.console.ves.volterra.io");
		const svc = ContextService.init(cfg);
		const choice = chooseSessionContext(
			"b",
			resolveAutoBind({ kind: "cli", availableContexts: ["a", "b"], folderContext: null }),
		);
		expect(choice).toEqual({ activate: "b" });
		if ("activate" in choice) await svc.activate(choice.activate);
		expect(svc.getStatus().activeContextName).toBe("b");
	});

	test("resume: deleted bound context → activate throws, handled as unbound", async () => {
		const svc = ContextService.init(cfg); // no contexts on disk
		const choice = chooseSessionContext("ghost", { kind: "none" });
		expect(choice).toEqual({ activate: "ghost" });
		if ("activate" in choice) {
			await expect(svc.activate(choice.activate)).rejects.toThrow(); // caught + surfaced by the bootstrap
		}
		expect(svc.getStatus().activeContextName ?? null).toBeNull();
	});
});
