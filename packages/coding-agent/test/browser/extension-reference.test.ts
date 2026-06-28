import { describe, expect, it } from "bun:test";
import capabilitiesJson from "../../src/browser/capabilities.json";
import { type Manifest, renderToolReference } from "../../src/browser/extension-contract";
import { EXTENSION_TOOLS_REFERENCE } from "../../src/internal-urls/extension-tools.generated";

const MANIFEST = {
	contractVersion: "1.0.0",
	tools: [
		{
			name: "click",
			summary: "Click an element.",
			category: "interaction",
			params: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
			flags: { mutates: true },
		},
		{
			name: "read_console",
			summary: "Read logs.",
			category: "read",
			params: { type: "object", properties: { pattern: { type: "string" } } },
			flags: { readOnly: true },
		},
		{
			name: "annotate",
			summary: "Draw an overlay.",
			category: "annotation",
			params: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
			flags: { requiresExplainMode: true },
		},
	],
};

describe("renderToolReference", () => {
	const md = renderToolReference(MANIFEST);

	it("documents every tool by name", () => {
		expect(md).toContain("click");
		expect(md).toContain("read_console");
		expect(md).toContain("annotate");
	});

	it("renders required params plainly and optional params with a ?", () => {
		expect(md).toContain("ref: string");
		expect(md).toContain("kind: string");
		expect(md).toContain("pattern?: string");
	});

	it("annotates semantic flags (mutates / read-only / explain-mode)", () => {
		expect(md.toLowerCase()).toContain("mutates");
		expect(md.toLowerCase()).toContain("read-only");
		expect(md.toLowerCase()).toContain("explain mode");
	});

	it("stamps the contract version so staleness is visible", () => {
		expect(md).toContain("1.0.0");
	});
});

describe("generated extension tool reference", () => {
	it("is in sync with the contract (run generate-extension-capabilities to refresh)", () => {
		expect(EXTENSION_TOOLS_REFERENCE).toBe(renderToolReference(capabilitiesJson as Manifest));
	});

	it("documents every tool in the contract", () => {
		for (const t of (capabilitiesJson as Manifest).tools) {
			expect(EXTENSION_TOOLS_REFERENCE).toContain(t.name);
		}
	});
});
