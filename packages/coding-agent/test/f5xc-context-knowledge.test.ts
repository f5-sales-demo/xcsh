import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService, type F5XCContext } from "@f5xc-salesdemos/xcsh/services/f5xc-context";
import {
	TEST_CONTEXT as _TEST_CONTEXT,
	TEST_CONTEXT_WITH_KNOWLEDGE as _TEST_CONTEXT_WITH_KNOWLEDGE,
} from "./f5xc-test-fixtures";

const TEST_CONTEXT: F5XCContext = { ..._TEST_CONTEXT };
const TEST_CONTEXT_WITH_KNOWLEDGE: F5XCContext = structuredClone(_TEST_CONTEXT_WITH_KNOWLEDGE) as F5XCContext;

function writeContext(contextsDir: string, context: F5XCContext): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name, { mode: 0o644 });
}

describe("ContextService knowledge sources", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		testDir = path.join(os.tmpdir(), `xcsh-test-knowledge-${Snowflake.next()}`);
		f5xcConfigDir = path.join(testDir, "f5xc");
		f5xcContextsDir = path.join(f5xcConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(f5xcConfigDir, { recursive: true });

		savedEnv.F5XC_API_URL = process.env.F5XC_API_URL;
		savedEnv.F5XC_API_TOKEN = process.env.F5XC_API_TOKEN;
		savedEnv.F5XC_NAMESPACE = process.env.F5XC_NAMESPACE;
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;
		delete process.env.F5XC_NAMESPACE;

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
		writeContext(f5xcContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		const service = ContextService.init(f5xcConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "with-knowledge");
		expect(ctx).toBeDefined();
		expect(ctx?.knowledgeSources).toHaveLength(2);
		expect(ctx?.knowledgeSources?.[0].type).toBe("skill-dir");
		expect(ctx?.knowledgeSources?.[1].url).toBe("https://example.com/llms.txt");
		expect(ctx?.includeSkills).toEqual(["f5xc-*"]);
		expect(ctx?.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("export/import round-trip preserves new fields", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		const service = ContextService.init(f5xcConfigDir);
		const bundle = await service.exportContexts({ includeToken: true });

		const importDir = path.join(testDir, "import");
		const importConfigDir = path.join(importDir, "f5xc");
		fs.mkdirSync(path.join(importConfigDir, "contexts"), { recursive: true });
		ContextService._resetForTest();
		_resetSettingsForTest();
		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
		const importService = ContextService.init(importConfigDir);
		await importService.importContexts(bundle, { overwrite: false });

		const contexts = await importService.listContexts();
		const ctx = contexts.find(c => c.name === "with-knowledge");
		expect(ctx?.knowledgeSources).toHaveLength(2);
		expect(ctx?.includeSkills).toEqual(["f5xc-*"]);
		expect(ctx?.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("getActiveContextSkillConfig returns skill-dir URLs only", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT_WITH_KNOWLEDGE);
		writeActiveContext(f5xcConfigDir, "with-knowledge");
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const config = service.getActiveContextSkillConfig();
		expect(config.skillDirs).toEqual(["/home/test/skills"]);
		expect(config.includeSkills).toEqual(["f5xc-*"]);
		expect(config.excludeSkills).toEqual(["deprecated-*"]);
	});

	it("getActiveContextSkillConfig returns empty for plain context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, "production");
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const config = service.getActiveContextSkillConfig();
		expect(config.skillDirs).toEqual([]);
		expect(config.includeSkills).toEqual([]);
		expect(config.excludeSkills).toEqual([]);
	});

	it("validates and preserves well-formed knowledgeSources", async () => {
		const context: F5XCContext = {
			...TEST_CONTEXT,
			name: "valid-sources",
			knowledgeSources: [
				{ url: "https://example.com/llms.txt", type: "llms-txt" },
				{ url: "/path/to/skills", type: "skill-dir", label: "My Skills" },
				{ url: "https://docs.example.com", type: "docs-site" },
			],
		};
		writeContext(f5xcContextsDir, context);
		const service = ContextService.init(f5xcConfigDir);
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
		writeContext(f5xcContextsDir, rawContext as unknown as F5XCContext);
		const service = ContextService.init(f5xcConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "bad-sources");
		expect(ctx?.knowledgeSources).toHaveLength(1);
		expect(ctx?.knowledgeSources?.[0].url).toBe("https://valid.com/llms.txt");
	});

	it("loads contexts without knowledgeSources unchanged (backward compat)", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		const contexts = await service.listContexts();
		const ctx = contexts.find(c => c.name === "production");
		expect(ctx).toBeDefined();
		expect(ctx?.knowledgeSources).toBeUndefined();
		expect(ctx?.includeSkills).toBeUndefined();
		expect(ctx?.excludeSkills).toBeUndefined();
		expect(ctx?.apiUrl).toBe(TEST_CONTEXT.apiUrl);
	});
});
