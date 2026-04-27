import { describe, expect, it } from "bun:test";
import { parseLlmsTxt } from "@f5xc-salesdemos/xcsh/services/f5xc-knowledge";

const SAMPLE_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

> Demo guides and runbooks for F5 Distributed Cloud sales engineering.

## Documentation Sets

- [Abridged documentation](https://f5xc-salesdemos.github.io/docs/llms-small.txt): a compact version
- [Complete documentation](https://f5xc-salesdemos.github.io/docs/llms-full.txt): the full documentation

## Federated Sites

- [WAF](https://f5xc-salesdemos.github.io/waf/llms.txt): F5 XC web application firewall
- [DDoS](https://f5xc-salesdemos.github.io/ddos/llms.txt): F5 XC DDoS protection
- [f5xc Docs Builder](https://f5xc-salesdemos.github.io/docs-builder/llms.txt): Containerized Astro build system
- [Dev Container](https://f5xc-salesdemos.github.io/devcontainer/llms.txt): Isolated development environment
- [xcsh](https://f5xc-salesdemos.github.io/xcsh/llms.txt): AI-powered development CLI
- [F5 XC Docs](https://f5xc-salesdemos.github.io/docs/llms.txt): Organization landing page
- [CDN Simulator](https://f5xc-salesdemos.github.io/cdn-simulator/llms.txt): NGINX-based CDN edge node simulator
- [Origin Server](https://f5xc-salesdemos.github.io/origin-server/llms.txt): Ubuntu origin server
- [Docs Icons](https://f5xc-salesdemos.github.io/docs-icons/llms.txt): NPM icon packages
- [XC Docs Theme](https://f5xc-salesdemos.github.io/docs-theme/llms.txt): Shared branding and styling
`;

const NOW = new Date("2026-04-27T12:00:00.000Z");

describe("parseLlmsTxt", () => {
	it("parses title and description", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		expect(result.title).toBe("F5 Distributed Cloud Sales Demos");
		expect(result.description).toBe("Demo guides and runbooks for F5 Distributed Cloud sales engineering.");
	});

	it("extracts products from Federated Sites section only", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		const names = result.products.map(p => p.name);
		expect(names).toContain("WAF");
		expect(names).toContain("DDoS");
	});

	it("skips Documentation Sets entries", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		const urls = result.products.map(p => p.url);
		expect(urls.every(u => !u.includes("llms-small.txt") && !u.includes("llms-full.txt"))).toBe(true);
	});

	it("filters infrastructure sites by slug", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		const names = result.products.map(p => p.name);
		expect(names).not.toContain("f5xc Docs Builder");
		expect(names).not.toContain("Dev Container");
		expect(names).not.toContain("xcsh");
		expect(names).not.toContain("F5 XC Docs");
		expect(names).not.toContain("CDN Simulator");
		expect(names).not.toContain("Origin Server");
		expect(names).not.toContain("Docs Icons");
		expect(names).not.toContain("XC Docs Theme");
	});

	it("keeps only product sites after filtering", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		expect(result.products).toEqual([
			{
				name: "WAF",
				description: "F5 XC web application firewall",
				url: "https://f5xc-salesdemos.github.io/waf/llms.txt",
			},
			{ name: "DDoS", description: "F5 XC DDoS protection", url: "https://f5xc-salesdemos.github.io/ddos/llms.txt" },
		]);
	});

	it("sets fetchedAt from provided timestamp", () => {
		const result = parseLlmsTxt(SAMPLE_LLMS_TXT, NOW);
		expect(result.fetchedAt).toBe("2026-04-27T12:00:00.000Z");
	});

	it("handles empty input", () => {
		const result = parseLlmsTxt("", NOW);
		expect(result.title).toBe("");
		expect(result.description).toBe("");
		expect(result.products).toEqual([]);
	});

	it("handles malformed lines gracefully", () => {
		const input = `# Title
> Desc

## Federated Sites

- not a valid entry
- [Valid](https://f5xc-salesdemos.github.io/waf/llms.txt): WAF docs
- [Missing colon](https://example.com/llms.txt)
`;
		const result = parseLlmsTxt(input, NOW);
		expect(result.products).toEqual([
			{ name: "Valid", description: "WAF docs", url: "https://f5xc-salesdemos.github.io/waf/llms.txt" },
		]);
	});
});
