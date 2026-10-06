import { describe, expect, it } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { ProviderDocumentationResolver } from "../../src/internal-urls/provider-documentation";
import {
	normalizeAssistantDocumentationCitations,
	SessionCitationRegistry,
} from "../../src/internal-urls/public-citations";

const commit = "a".repeat(40);
const url = (page: string) => parseInternalUrl(`xcsh://terraform-release/v15.3.0/documentation/${page}`);
describe("targeted release documentation", () => {
	it("projects internal release citations with immutable provenance without conflicting with embedded reads", async () => {
		const resolver = new ProviderDocumentationResolver({
			fetch: async input =>
				String(input).includes("/git/ref/")
					? Response.json({ object: { type: "commit", sha: commit } })
					: new Response("# New field"),
		});
		const target = url("resources/origin_pool/properties/new_field/index.md");
		const result = await resolver.resolve(target);
		const registry = new SessionCitationRegistry();
		registry.observe({
			role: "toolResult",
			toolCallId: "read-1",
			toolName: "read",
			content: [{ type: "text", text: result.content }],
			isError: false,
			timestamp: Date.now(),
			details: { meta: { source: { type: "internal", value: target.href } } },
		});
		const mapped = registry.resolve(target.href);
		expect(mapped && "publicUrl" in mapped ? mapped.sourceVersion : null).toBe("v15.3.0");
		expect(normalizeAssistantDocumentationCitations(`See [New field](${target.href})`, registry.resolve)).toContain(
			`https://github.com/f5-sales-demo/terraform-provider-xcsh/blob/${commit}/documentation/`,
		);
		expect(
			registry.resolve("xcsh://terraform-documentation/documentation/resources/origin_pool/index.md"),
		).not.toHaveProperty("reason", "conflicting-source-version");
	});
	it("dereferences annotated tags and retrieves only the requested canonical page at the immutable commit", async () => {
		const requests: string[] = [];
		const resolver = new ProviderDocumentationResolver({
			fetch: async input => {
				const target = String(input);
				requests.push(target);
				if (target.includes("/git/ref/")) return Response.json({ object: { type: "tag", sha: "b".repeat(40) } });
				if (target.includes("/git/tags/")) return Response.json({ object: { type: "commit", sha: commit } });
				return new Response("# New field\n\nnew_field enables the new behavior.");
			},
		});
		const result = await resolver.resolve(url("resources/origin_pool/properties/new_field/index.md"));
		expect(requests).toHaveLength(3);
		expect(requests[2]).toBe(
			`https://raw.githubusercontent.com/f5-sales-demo/terraform-provider-xcsh/${commit}/documentation/resources/origin_pool/properties/new_field/index.md`,
		);
		expect(result.content).toContain("Provider: v15.3.0");
		expect(result.content).toContain("new_field");
		expect(result.content).toContain(
			`Cite: https://github.com/f5-sales-demo/terraform-provider-xcsh/blob/${commit}/documentation/`,
		);
		expect(requests.some(item => item.endsWith("/documentation/llms.txt"))).toBe(false);
	});
	it("reuses the immutable commit across requested pages", async () => {
		const requests: string[] = [];
		const resolver = new ProviderDocumentationResolver({
			fetch: async input => {
				requests.push(String(input));
				return String(input).includes("/git/ref/")
					? Response.json({ object: { type: "commit", sha: commit } })
					: new Response("# Configuration");
			},
		});
		await resolver.resolve(url("resources/origin_pool/index.md"));
		await resolver.resolve(url("resources/origin_pool/properties/port/index.md"));
		expect(requests.filter(item => item.includes("/git/ref/"))).toHaveLength(1);
	});
	it.each([
		"xcsh://terraform-release/v15.3.0/docs/resources/origin_pool.md",
		"xcsh://terraform-release/main/documentation/index.md",
		"xcsh://terraform-release/v15.3.0/documentation/%2e%2e/index.md",
	])("rejects unsafe or noncanonical routes: %s", async value => {
		const resolver = new ProviderDocumentationResolver({
			fetch: async () => {
				throw new Error("must not fetch");
			},
		});
		await expect(resolver.resolve(parseInternalUrl(value))).rejects.toThrow(/canonical/);
	});
	it("reports missing pages without claiming the selected release lacks a feature", async () => {
		const resolver = new ProviderDocumentationResolver({
			fetch: async input =>
				String(input).includes("/git/ref/")
					? Response.json({ object: { type: "commit", sha: commit } })
					: new Response("missing", { status: 404 }),
		});
		const result = await resolver.resolve(url("resources/origin_pool/properties/new_field/index.md"));
		expect(result.content).toContain("HTTP 404");
		expect(result.content).toContain("does not establish");
	});
	it("bounds immutable commit and page lookups", async () => {
		const resolver = new ProviderDocumentationResolver({ timeoutMs: 5, fetch: () => new Promise(() => {}) });
		expect((await resolver.resolve(url("index.md"))).content).toContain("timed out");
	});
});
