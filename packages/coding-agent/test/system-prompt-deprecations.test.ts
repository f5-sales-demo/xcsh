import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { buildSystemPrompt } from "../src/system-prompt";

beforeAll(() => {
	registerCodingAgentPromptHelpers();
});

// The guardrails MUST be present on every rendered system prompt — including code
// paths that never consult the xcsh:// protocol.
describe("system prompt deprecation guardrails", () => {
	it("forbids vesctl and routes API calls to xcsh_api", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("vesctl");
		expect(rendered).toContain("xcsh_api");
	});

	it("remaps the legacy API-docs URL to the embedded/enriched canonical URL", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("docs.cloud.f5.com/docs-v2/api");
		expect(rendered).toContain("f5-sales-demo.github.io/api-specs-enriched/en/");
	});

	it("captures the Volterra brand-vs-identifier nuance", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("F5 Distributed Cloud");
		expect(rendered).toContain("volterra_*");
	});

	it("renders no leftover template placeholder", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).not.toContain("{{deprecationGuardrails}}");
	});
});
