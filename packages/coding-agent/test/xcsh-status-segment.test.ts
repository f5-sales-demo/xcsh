import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService } from "@f5xc-salesdemos/xcsh/services/xcsh-context";
import { renderXCSHContextSegment } from "@f5xc-salesdemos/xcsh/services/xcsh-context-segment";
import { TEST_CONTEXT } from "./xcsh-test-fixtures";

function writeContext(
	contextsDir: string,
	context: { name: string; apiUrl: string; apiToken: string; defaultNamespace: string },
): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name);
}

describe("context.xcsh status line segment", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}

		testDir = path.join(os.tmpdir(), "test-xcsh-segment", Snowflake.next());
		xcshConfigDir = path.join(testDir, "xcsh-config");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");

		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("returns visible: false when no context is active", () => {
		ContextService.init(xcshConfigDir);
		const result = renderXCSHContextSegment();
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("returns content with context name when active", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const result = renderXCSHContextSegment();
		expect(result.visible).toBe(true);
		expect(result.content).toBe("test-tenant:default");
	});

	it("returns visible: false when ContextService is not initialized (crash isolation)", () => {
		// Do NOT call ContextService.init() — simulates startup without XCSH config
		ContextService._resetForTest();
		const result = renderXCSHContextSegment();
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("segment content never contains the API token", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const result = renderXCSHContextSegment();
		expect(result.visible).toBe(true);
		expect(result.content).not.toContain(TEST_CONTEXT.apiToken);
	});

	it("updates after context switch", async () => {
		const context2 = { ...TEST_CONTEXT, name: "staging", apiUrl: "https://staging.console.ves.volterra.io" };
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeContext(xcshContextsDir, context2);
		writeActiveContext(xcshConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		expect(renderXCSHContextSegment().content).toBe("test-tenant:default");

		await service.activate("staging");

		expect(renderXCSHContextSegment().content).toBe("staging:default");
	});
});
