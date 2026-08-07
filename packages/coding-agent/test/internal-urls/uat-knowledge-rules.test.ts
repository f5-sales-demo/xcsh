import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledRules } from "../../src/bundled-rules";
import { registerCodingAgentPromptHelpers } from "../../src/config/prompt-templates";
import { Settings } from "../../src/config/settings";
import { InternalUrlRouter, RuleProtocolHandler } from "../../src/internal-urls";
import { createAgentSession } from "../../src/sdk";
import { KnowledgeService } from "../../src/services/xcsh-knowledge";
import { SessionManager } from "../../src/session/session-manager";
import { buildSystemPrompt } from "../../src/system-prompt";

const MOCK_CATEGORIZED_PORTAL = `# F5 Distributed Cloud Sales Demos

> Demo guides and runbooks for F5 Distributed Cloud sales engineering.

## Product Features

- [WAF](https://f5-sales-demo.github.io/waf/llms.txt): F5 XC web application firewall

## Developer Tools

- [xcsh GitHub Action](https://f5-sales-demo.github.io/xcsh-action/llms.txt): GitHub Marketplace Action for deterministic manifest operations
- [xcsh](https://f5-sales-demo.github.io/xcsh/llms.txt): AI-powered development environment and CLI tool

## Lab Infrastructure

- [Origin Server](https://f5-sales-demo.github.io/origin-server/llms.txt): Ubuntu origin server
`;

describe("End-to-End UAT Knowledge & Rule Protections", () => {
	let testDir: string;

	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});

	beforeEach(() => {
		KnowledgeService._resetForTest();
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-uat-test-"));
	});

	afterEach(() => {
		KnowledgeService._resetForTest();
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it("fetches, parses, and categorizes portal llms.txt index", async () => {
		using _hook = hookFetch(() => new Response(MOCK_CATEGORIZED_PORTAL, { status: 200 }));
		const service = KnowledgeService.init(testDir);

		const index = await service.refreshIndex();

		expect(index.schemaVersion).toBe(2);
		expect(index.topics).toHaveLength(4);
		expect(service.getTopicSummary()).toBe(
			"Developer Tools: xcsh, xcsh GitHub Action; Lab Infrastructure: Origin Server; Product Features: WAF",
		);
	});

	it("injects categorized knowledge topics into system prompt rendering", async () => {
		using _hook = hookFetch(() => new Response(MOCK_CATEGORIZED_PORTAL, { status: 200 }));
		const service = KnowledgeService.init(testDir);
		await service.refreshIndex();

		const prompt = await buildSystemPrompt({
			cwd: testDir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: ["read"],
			context: {
				tenant: "example-corp",
				namespace: "demo-app",
				credentialSource: "context",
				authStatus: "connected",
			},
			knowledgeTopics: service.getTopicSummary(),
		});

		expect(prompt).toContain("Available federated F5 XC documentation topics by category:");
		expect(prompt).toContain(
			"Developer Tools: xcsh, xcsh GitHub Action; Lab Infrastructure: Origin Server; Product Features: WAF",
		);
	});

	it("resolves rule://llms-search with progressive lookup and xcsh-action routing directives", async () => {
		const router = new InternalUrlRouter();
		router.register(new RuleProtocolHandler({ getRules: getBundledRules }));

		const resource = await router.resolve("rule://llms-search");

		expect(resource.sourcePath).toBe("embedded:llms-search.md");
		expect(resource.content).toContain("# Documentation Lookup Hierarchy (llms.txt Cascade)");
		expect(resource.content).toContain("1. **Federation index**");
		expect(resource.content).toContain("Follow `## Contents` links recursively");
		expect(resource.content).toContain("f5-sales-demo/xcsh-action");
	});

	it("resolves rule://epistemic-integrity with F5 XC Bot Defense SKU example", async () => {
		const router = new InternalUrlRouter();
		router.register(new RuleProtocolHandler({ getRules: getBundledRules }));

		const resource = await router.resolve("rule://epistemic-integrity");

		expect(resource.sourcePath).toBe("embedded:epistemic-integrity.md");
		expect(resource.content).toContain("# Epistemic Integrity Dialogue Examples");
		expect(resource.content).toContain("bot defense is a separate SKU above the base WAAP tier");
		expect(resource.content).toContain("that's a contract question — not a product question");
	});

	it("executes read tool against rule://llms-search in a clean SDK session with discovery disabled", async () => {
		const { session } = await createAgentSession({
			cwd: testDir,
			agentDir: testDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			rules: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			toolNames: ["read"],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const readTool = session.getToolByName("read");
			expect(readTool).toBeDefined();

			const result = await readTool?.execute("uat-call-1", { path: "rule://llms-search" });
			const text = result?.content.find(block => block.type === "text")?.text ?? "";

			expect(text).toContain("f5-sales-demo/xcsh-action");
			expect(text).toContain("Documentation Lookup Hierarchy");
		} finally {
			await session.dispose();
		}
	});
});
