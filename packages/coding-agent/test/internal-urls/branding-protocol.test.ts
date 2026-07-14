import { describe, expect, it } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";

// Verifies the data-driven deprecations (authored in branding.yaml) surface through
// the xcsh://branding protocol — the progressive-disclosure counterpart to the
// always-on system-prompt guardrails.
describe("xcsh://branding host", () => {
	it("overview surfaces the cli, api-docs, and brand deprecations", async () => {
		const handler = new InternalDocsProtocolHandler();
		const res = await handler.resolve(parseInternalUrl("xcsh://branding") as never);
		expect(res.content).toContain("vesctl");
		expect(res.content).toContain("docs.cloud.f5.com/docs-v2/api");
		expect(res.content).toContain("api-specs-enriched/en/");
		expect(res.content).toContain("Volterra");
	});

	it("volterra page maps deprecated tooling to canonical replacements", async () => {
		const handler = new InternalDocsProtocolHandler();
		const res = await handler.resolve(parseInternalUrl("xcsh://branding/volterra") as never);
		expect(res.content).toContain("vesctl");
		expect(res.content).toContain("F5 Distributed Cloud");
		expect(res.content).toContain("api-specs-enriched/en/");
	});
});
