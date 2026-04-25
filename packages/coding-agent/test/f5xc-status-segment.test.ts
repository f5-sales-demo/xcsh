import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService } from "@f5xc-salesdemos/xcsh/services/f5xc-context";
import { renderF5XCContextSegment } from "@f5xc-salesdemos/xcsh/services/f5xc-context-segment";
import { TEST_CONTEXT } from "./f5xc-test-fixtures";

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

describe("context.f5xc status line segment", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}

		testDir = path.join(os.tmpdir(), "test-f5xc-segment", Snowflake.next());
		f5xcConfigDir = path.join(testDir, "f5xc-config");
		f5xcContextsDir = path.join(f5xcConfigDir, "contexts");
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
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("returns visible: false when no context is active", () => {
		ContextService.init(f5xcConfigDir);
		const result = renderF5XCContextSegment();
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("returns content with context name when active", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const result = renderF5XCContextSegment();
		expect(result.visible).toBe(true);
		expect(result.content).toBe("test-tenant:default");
	});

	it("returns visible: false when ContextService is not initialized (crash isolation)", () => {
		// Do NOT call ContextService.init() — simulates startup without F5XC config
		ContextService._resetForTest();
		const result = renderF5XCContextSegment();
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("segment content never contains the API token", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const result = renderF5XCContextSegment();
		expect(result.visible).toBe(true);
		expect(result.content).not.toContain(TEST_CONTEXT.apiToken);
	});

	it("updates after context switch", async () => {
		const context2 = { ...TEST_CONTEXT, name: "staging", apiUrl: "https://staging.console.ves.volterra.io" };
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, context2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		expect(renderF5XCContextSegment().content).toBe("test-tenant:default");

		await service.activate("staging");

		expect(renderF5XCContextSegment().content).toBe("staging:default");
	});
});
