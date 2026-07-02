import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
