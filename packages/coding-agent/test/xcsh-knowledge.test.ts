import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { KnowledgeService, parseLlmsTxt } from "../src/services/xcsh-knowledge";

const CATEGORIZED_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

> Demo guides and runbooks for F5 Distributed Cloud sales engineering.

## Documentation Sets

- [Abridged documentation](https://f5-sales-demo.github.io/docs/llms-small.txt): compact portal docs
- [Complete documentation](https://f5-sales-demo.github.io/docs/llms-full.txt): complete portal docs

## Sections

- [Sales Demos](https://f5-sales-demo.github.io/docs/_llms-txt/en.txt): portal content

## Product Features

- [WAF](https://f5-sales-demo.github.io/waf/llms.txt): F5 XC web application firewall

## Developer Tools

- [xcsh GitHub Action](https://f5-sales-demo.github.io/xcsh-action/llms.txt): GitHub Marketplace Action for deterministic manifest operations
- [xcsh](https://f5-sales-demo.github.io/xcsh/llms.txt): AI-powered development environment and CLI tool

## Lab Infrastructure

- [Origin Server](https://f5-sales-demo.github.io/origin-server/llms.txt): Ubuntu origin server

## Documentation Portal

- [F5 XC Docs](https://f5-sales-demo.github.io/docs/llms.txt): Organization landing page

## Translations

- [Français](https://f5-sales-demo.github.io/docs/fr/llms.txt): French portal index
`;

const NOW = new Date("2026-08-06T12:00:00.000Z");

describe("parseLlmsTxt", () => {
	it("parses categorized federation entries as documentation topics", () => {
		const result = parseLlmsTxt(CATEGORIZED_LLMS_TXT, NOW);

		expect(result.schemaVersion).toBe(2);
		expect(result.title).toBe("F5 Distributed Cloud Sales Demos");
		expect(result.description).toBe("Demo guides and runbooks for F5 Distributed Cloud sales engineering.");
		expect(result.topics).toEqual([
			{
				name: "WAF",
				description: "F5 XC web application firewall",
				url: "https://f5-sales-demo.github.io/waf/llms.txt",
				category: "Product Features",
			},
			{
				name: "xcsh GitHub Action",
				description: "GitHub Marketplace Action for deterministic manifest operations",
				url: "https://f5-sales-demo.github.io/xcsh-action/llms.txt",
				category: "Developer Tools",
			},
			{
				name: "xcsh",
				description: "AI-powered development environment and CLI tool",
				url: "https://f5-sales-demo.github.io/xcsh/llms.txt",
				category: "Developer Tools",
			},
			{
				name: "Origin Server",
				description: "Ubuntu origin server",
				url: "https://f5-sales-demo.github.io/origin-server/llms.txt",
				category: "Lab Infrastructure",
			},
		]);
		expect(result.fetchedAt).toBe("2026-08-06T12:00:00.000Z");
	});

	it("excludes documentation sets, section bundles, translations, and the portal self-link", () => {
		const result = parseLlmsTxt(CATEGORIZED_LLMS_TXT, NOW);
		const urls = result.topics.map(topic => topic.url);

		expect(urls).not.toContain("https://f5-sales-demo.github.io/docs/llms-small.txt");
		expect(urls).not.toContain("https://f5-sales-demo.github.io/docs/_llms-txt/en.txt");
		expect(urls).not.toContain("https://f5-sales-demo.github.io/docs/fr/llms.txt");
		expect(urls).not.toContain("https://f5-sales-demo.github.io/docs/llms.txt");
	});

	it("supports the legacy Federated Sites heading without a hardcoded category allowlist", () => {
		const input = `# Index\n> Docs\n\n## Federated Sites\n\n- [Future Tool](https://example.com/future-tool/llms.txt): Future docs\n`;
		const result = parseLlmsTxt(input, NOW);

		expect(result.topics).toEqual([
			{
				name: "Future Tool",
				description: "Future docs",
				url: "https://example.com/future-tool/llms.txt",
				category: "Federated Sites",
			},
		]);
	});

	it("ignores malformed and duplicate entries", () => {
		const input = `# Index\n> Docs\n\n## Developer Tools\n\n- not a valid entry\n- [Action](https://example.com/action/llms.txt): Action docs\n- [Action duplicate](https://example.com/action/llms.txt): Duplicate\n- [Missing colon](https://example.com/missing/llms.txt)\n`;
		const result = parseLlmsTxt(input, NOW);

		expect(result.topics).toHaveLength(1);
		expect(result.topics[0]?.name).toBe("Action");
	});

	it("returns an empty versioned index for empty input", () => {
		const result = parseLlmsTxt("", NOW);
		expect(result).toEqual({
			schemaVersion: 2,
			title: "",
			description: "",
			topics: [],
			fetchedAt: "2026-08-06T12:00:00.000Z",
		});
	});
});

describe("KnowledgeService", () => {
	let testDir: string;

	beforeEach(() => {
		KnowledgeService._resetForTest();
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-test-knowledge-"));
	});

	afterEach(() => {
		KnowledgeService._resetForTest();
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it("round-trips a versioned categorized cache", () => {
		const service = KnowledgeService.init(testDir);
		service.saveCache(parseLlmsTxt(CATEGORIZED_LLMS_TXT, NOW));

		KnowledgeService._resetForTest();
		const restored = KnowledgeService.init(testDir);
		restored.loadCache();

		expect(restored.getIndex()?.schemaVersion).toBe(2);
		expect(restored.getIndex()?.topics.map(topic => topic.name)).toContain("xcsh GitHub Action");
	});

	it("invalidates legacy and empty caches", () => {
		const service = KnowledgeService.init(testDir);
		fs.writeFileSync(service.cachePath, JSON.stringify({ fetchedAt: NOW.toISOString(), products: [] }));
		service.loadCache();
		expect(service.getIndex()).toBeNull();

		fs.writeFileSync(
			service.cachePath,
			JSON.stringify({
				schemaVersion: 2,
				title: "Index",
				description: "Docs",
				topics: [],
				fetchedAt: NOW.toISOString(),
			}),
		);
		service.loadCache();
		expect(service.getIndex()).toBeNull();
	});

	it("refreshes and exposes sorted topic names", async () => {
		using _hook = hookFetch(() => new Response(CATEGORIZED_LLMS_TXT, { status: 200 }));
		const service = KnowledgeService.init(testDir);

		const index = await service.refreshIndex();

		expect(index.topics).toHaveLength(4);
		expect(service.getTopicNames()).toEqual(["Origin Server", "WAF", "xcsh", "xcsh GitHub Action"]);
		expect(service.getTopicSummary()).toBe(
			"Developer Tools: xcsh, xcsh GitHub Action; Lab Infrastructure: Origin Server; Product Features: WAF",
		);
	});

	it("returns a fresh cache without fetching", async () => {
		const service = KnowledgeService.init(testDir);
		service.saveCache(parseLlmsTxt(CATEGORIZED_LLMS_TXT));
		service.loadCache();
		let fetchCalled = false;
		using _hook = hookFetch(() => {
			fetchCalled = true;
			return new Response(CATEGORIZED_LLMS_TXT, { status: 200 });
		});

		const result = await service.getOrRefreshIndex();

		expect(result?.topics).toHaveLength(4);
		expect(fetchCalled).toBe(false);
	});

	it("keeps stale topics when a refresh returns no federation entries", async () => {
		const service = KnowledgeService.init(testDir);
		service.saveCache(parseLlmsTxt(CATEGORIZED_LLMS_TXT, new Date(0)));
		service.loadCache();
		using _hook = hookFetch(() => new Response("# Empty portal\n\n> No entries", { status: 200 }));

		const result = await service.getOrRefreshIndex(0);

		expect(result?.topics.map(topic => topic.name)).toContain("xcsh GitHub Action");
		expect(service.getIndex()?.topics).toHaveLength(4);
	});

	it("keeps stale topics when the network fails", async () => {
		const service = KnowledgeService.init(testDir);
		service.saveCache(parseLlmsTxt(CATEGORIZED_LLMS_TXT, new Date(0)));
		service.loadCache();
		using _hook = hookFetch(() => {
			throw new Error("network down");
		});

		const result = await service.getOrRefreshIndex(0);

		expect(result?.topics).toHaveLength(4);
	});
});
