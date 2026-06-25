import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService, type XCSHContext } from "@f5xc-salesdemos/xcsh/services/xcsh-context";
import {
	TEST_CONTEXT as _TEST_CONTEXT,
	TEST_CONTEXT_WITH_KNOWLEDGE as _TEST_CONTEXT_WITH_KNOWLEDGE,
} from "./xcsh-test-fixtures";

const TEST_CONTEXT: XCSHContext = { ..._TEST_CONTEXT };
const TEST_CONTEXT_WITH_KNOWLEDGE = structuredClone(_TEST_CONTEXT_WITH_KNOWLEDGE) as unknown as XCSHContext;

function writeContext(contextsDir: string, context: XCSHContext): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name, { mode: 0o644 });
}

describe("ContextService knowledge sources", () => {
	let testDir: string;
	let xcshConfigDir: string;
	let xcshContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		testDir = path.join(os.tmpdir(), `xcsh-test-knowledge-${Snowflake.next()}`);
		xcshConfigDir = path.join(testDir, "xcsh");
		xcshContextsDir = path.join(xcshConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(xcshConfigDir, { recursive: true });

		savedEnv.XCSH_API_URL = process.env.XCSH_API_URL;
		savedEnv.XCSH_API_TOKEN = process.env.XCSH_API_TOKEN;
		savedEnv.XCSH_NAMESPACE = process.env.XCSH_NAMESPACE;
		delete process.env.XCSH_API_URL;
		delete process.env.XCSH_API_TOKEN;
		delete process.env.XCSH_NAMESPACE;

		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		ContextService._resetForTest();
		_resetSettingsForTest();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it("round-trips knowledgeSources through create and read", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		const service = ContextService.init(xcshConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "with-knowledge");
		expect(ctx).toBeDefined();
		expect(ctx?.knowledgeSources).toHaveLength(2);
		expect(ctx?.knowledgeSources?.[0].type).toBe("skill-dir");
		expect(ctx?.knowledgeSources?.[1].url).toBe("https://example.com/llms.txt");
		expect(ctx?.includeSkills).toEqual(["xcsh-*"]);
		expect(ctx?.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("export/import round-trip preserves new fields", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		const service = ContextService.init(xcshConfigDir);
		const bundle = await service.exportContexts({ includeToken: true });

		const importDir = path.join(testDir, "import");
		const importConfigDir = path.join(importDir, "xcsh");
		fs.mkdirSync(path.join(importConfigDir, "contexts"), { recursive: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
		const importService = ContextService.init(importConfigDir);
		await importService.importContexts(bundle, { overwrite: false });

		const contexts = await importService.listContexts();
		const ctx = contexts.find(c => c.name === "with-knowledge");
		expect(ctx?.knowledgeSources).toHaveLength(2);
		expect(ctx?.includeSkills).toEqual(["xcsh-*"]);
		expect(ctx?.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("getActiveContextSkillConfig returns skill-dir URLs only", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		writeActiveContext(xcshConfigDir, "with-knowledge");
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const config = service.getActiveContextSkillConfig();
		expect(config.skillDirs).toEqual(["/home/test/skills"]);
		expect(config.includeSkills).toEqual(["xcsh-*"]);
		expect(config.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("getActiveContextSkillConfig returns empty for plain context", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		writeActiveContext(xcshConfigDir, "production");
		const service = ContextService.init(xcshConfigDir);
		await service.loadActive();

		const config = service.getActiveContextSkillConfig();
		expect(config.skillDirs).toEqual([]);
		expect(config.includeSkills).toEqual([]);
		expect(config.excludeSkills).toEqual([]);
	});

	it("validates and preserves well-formed knowledgeSources", async () => {
		const context: XCSHContext = {
			...TEST_CONTEXT,
			name: "valid-sources",
			knowledgeSources: [
				{ url: "https://example.com/llms.txt", type: "llms-txt" },
				{ url: "/path/to/skills", type: "skill-dir", label: "My Skills" },
				{ url: "https://docs.example.com", type: "docs-site" },
			],
		};
		writeContext(xcshContextsDir, context);
		const service = ContextService.init(xcshConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "valid-sources");
		expect(ctx?.knowledgeSources).toHaveLength(3);
	});

	it("drops malformed knowledgeSources entries", async () => {
		const rawContext = {
			...TEST_CONTEXT,
			name: "bad-sources",
			knowledgeSources: [
				{ url: "https://valid.com/llms.txt", type: "llms-txt" },
				{ noUrl: true },
				{ url: 123 },
				{ url: "https://bad-type.com", type: "invalid-type" },
				"not-an-object",
			],
		};
		writeContext(xcshContextsDir, rawContext as unknown as XCSHContext);
		const service = ContextService.init(xcshConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "bad-sources");
		expect(ctx?.knowledgeSources).toHaveLength(1);
		expect(ctx?.knowledgeSources?.[0].url).toBe("https://valid.com/llms.txt");
	});

	it("loads contexts without knowledgeSources unchanged (backward compat)", async () => {
		writeContext(xcshContextsDir, TEST_CONTEXT);
		const service = ContextService.init(xcshConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "production");
		expect(ctx).toBeDefined();
		expect(ctx?.knowledgeSources).toBeUndefined();
		expect(ctx?.includeSkills).toBeUndefined();
		expect(ctx?.excludeSkills).toBeUndefined();
		expect(ctx?.apiUrl).toBe(TEST_CONTEXT.apiUrl);
	});
});
