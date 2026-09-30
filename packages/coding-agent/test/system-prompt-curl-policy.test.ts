import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { isDisallowedCliCommand } from "../src/deprecations";
import apiToolPrompt from "../src/prompts/tools/xcsh-api.md" with { type: "text" };
import { buildSystemPrompt } from "../src/system-prompt";

beforeAll(() => registerCodingAgentPromptHelpers());

describe("requested curl policy", () => {
	for (const [name, options] of [
		["eager", { loadingMode: "eager" as const }],
		["progressive", { loadingMode: "progressive" as const }],
		["custom", { customPrompt: "Custom assistant" }],
		["transformed", { transformPrompt: () => "Transformed assistant" }],
	] as const) {
		it(`preserves example and execution boundaries in ${name} composition`, async () => {
			const rendered = await buildSystemPrompt({
				...options,
				tools: new Map(),
				skills: [],
				rules: [],
				contextFiles: [],
			});
			expect(rendered).toContain("Prefer `xcsh_api`");
			expect(rendered).toContain("Provide accurate curl examples when requested");
			expect(rendered).toContain("Generating an example does not authorize executing it");
			expect(rendered).toContain("explicitly requests curl execution");
			expect(rendered).toContain("existing context, credential, approval, and execution controls");
			expect(rendered).toContain("$XCSH_API_URL");
			expect(rendered).toContain("Authorization: APIToken $XCSH_API_TOKEN");
			expect(rendered).not.toContain("Never construct cURL");
			expect(rendered).not.toContain("never raw `curl`");
			expect(rendered).toContain("Never propose, generate, or run `vesctl`");
		});
	}

	it("permits curl regardless of F5 markers while retaining vesctl deprecation", () => {
		for (const command of [
			'curl "$XCSH_API_URL/api/config/namespaces/default/dns_zones"',
			'curl https://tenant.volterra.io/api/data/test -H "Authorization: APIToken $XCSH_API_TOKEN"',
			"curl https://example.com",
		])
			expect(isDisallowedCliCommand(command)).toBe(false);
		expect(isDisallowedCliCommand("vesctl dns list")).toBe(true);
	});

	it("scopes native deletion and discovery to default execution requests", () => {
		expect(apiToolPrompt).toContain("For default execution requests");
		expect(apiToolPrompt).toContain("Example-only requests must not trigger resource operations");
		expect(apiToolPrompt).toContain("explicitly requested curl execution");
	});
});
