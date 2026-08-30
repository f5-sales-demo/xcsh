import { describe, expect, it } from "bun:test";
import { EXTENSION_CAPABILITIES } from "../../src/browser/capabilities.generated";
import { renderToolReference } from "../../src/browser/extension-contract";
import { EXTENSION_TOOL_REFERENCE } from "../../src/internal-urls/extension-tools.generated";

describe("renderToolReference", () => {
	const fixture = {
		contractVersion: "9.8.7",
		tools: [
			{
				name: "zeta",
				summary: "Zeta summary.",
				category: "beta",
				params: {
					type: "object",
					properties: { outer: { required: ["value"], properties: { value: { type: "string" } } } },
				},
				flags: { mutates: true, requiresExplainMode: false },
			},
			{
				name: "alpha",
				summary: "Alpha summary.",
				category: "alpha",
				params: { properties: {}, type: "object" },
				flags: { readOnly: true },
			},
		],
	};

	it("sorts categories and tools deterministically regardless of manifest order", () => {
		const reordered = { ...fixture, tools: [...fixture.tools].reverse() };
		expect(renderToolReference(fixture)).toBe(renderToolReference(reordered));
		const output = renderToolReference(fixture);
		expect(output.indexOf("## alpha")).toBeLessThan(output.indexOf("## beta"));
	});

	it("renders summaries plus exact nested parameter schemas and semantic flags as canonical JSON", () => {
		const output = renderToolReference(fixture);
		expect(output).toContain("Alpha summary.");
		expect(output).toContain("Zeta summary.");
		expect(output).toContain(
			'{"properties":{"outer":{"properties":{"value":{"type":"string"}},"required":["value"]}},"type":"object"}',
		);
		expect(output).toContain('{"mutates":true,"requiresExplainMode":false}');
	});

	it("keeps the committed generated artifact fresh", () => {
		expect(EXTENSION_TOOL_REFERENCE).toBe(renderToolReference(EXTENSION_CAPABILITIES));
	});

	it("includes every manifest tool exactly once", () => {
		for (const tool of EXTENSION_CAPABILITIES.tools) {
			const heading = `### \`${tool.name}\``;
			expect(EXTENSION_TOOL_REFERENCE.split(heading)).toHaveLength(2);
		}
	});
});
