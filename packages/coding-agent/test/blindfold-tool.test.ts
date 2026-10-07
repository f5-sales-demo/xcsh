import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { evaluateToolCall } from "../src/sandbox/enforce";
import { ContextService } from "../src/services/xcsh-context";
import { XcshBlindfoldTool } from "../src/tools/xcsh-blindfold";

let root: string, settings: Settings, service: ContextService;
let plan = false;
beforeEach(async () => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	root = mkdtempSync(join(tmpdir(), "blindfold-tool-"));
	settings = await Settings.init({ cwd: root, agentDir: root, inMemory: true });
	service = ContextService.init(join(root, "config"));
	plan = false;
});
afterEach(() => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	rmSync(root, { recursive: true, force: true });
});
function tool() {
	return new XcshBlindfoldTool({
		cwd: root,
		settings,
		getContextService: async () => service,
		getPlanModeState: () => (plan ? { enabled: true } : undefined),
	} as never);
}
describe("Blindfold assistant boundary", () => {
	test("preparation requires a retained output path", async () => {
		await expect(tool().execute("call", { operation: "encrypt", input: "input" })).rejects.toThrow(
			"requires outputFile",
		);
	});
	test("schema rejects plaintext keys, literal passwords and tokens", async () => {
		for (const field of ["password", "passphrase", "token", "privateKey"]) {
			await expect(
				tool().execute("call", { operation: "encrypt", input: "input", [field]: "secret" } as never),
			).rejects.toThrow("Invalid Blindfold arguments");
		}
	});
	test("Plan Mode blocks create and artifact output", async () => {
		plan = true;
		await expect(tool().execute("call", { operation: "create", cert: "a", key: "b", name: "demo" })).rejects.toThrow(
			"Plan mode",
		);
		await expect(tool().execute("call", { operation: "policy", outputFile: "policy.json" })).rejects.toThrow(
			"Plan mode",
		);
	});
	test("file fence checks every input and output", () => {
		const fence = {
			allow: [root],
			allowReadOnly: [],
			allowWriteOnly: [],
			deny: ["/private-test"],
			denyOnSeatbelt: [],
			denyEnumerate: [],
		};
		for (const key of ["input", "cert", "key", "bundle", "outputFile", "resultFile"]) {
			expect(
				evaluateToolCall({ toolName: "xcsh_blindfold", input: { [key]: "/private-test/secret" }, cwd: root, fence })
					.block,
			).toBe(true);
		}
	});
});
