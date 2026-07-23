import { describe, expect, it } from "bun:test";

// Import from the zero-dep classify module — plugin-cli.ts transitively loads native addons.
import { classifyInstallTarget } from "../../src/cli/classify-install-target";

const KNOWN = new Set(["my-marketplace"]);

describe("classifyInstallTarget", () => {
	it("classifies plugin@marketplace as marketplace when marketplace is registered", () => {
		const result = classifyInstallTarget("hello@my-marketplace", KNOWN);
		expect(result).toEqual({ type: "marketplace", name: "hello", marketplace: "my-marketplace" });
	});

	it("classifies scoped @scope/pkg as npm (rule 1: starts with @)", () => {
		const result = classifyInstallTarget("@scope/pkg", KNOWN);
		expect(result).toEqual({ type: "npm", spec: "@scope/pkg" });
	});

	it("classifies @scope/pkg@1.0.0 as npm (starts with @, rule 1 wins)", () => {
		const result = classifyInstallTarget("@scope/pkg@1.0.0", KNOWN);
		expect(result).toEqual({ type: "npm", spec: "@scope/pkg@1.0.0" });
	});

	it("classifies bare name with no @ as npm", () => {
		const result = classifyInstallTarget("bare-name", KNOWN);
		expect(result).toEqual({ type: "npm", spec: "bare-name" });
	});

	it("classifies pkg@version as npm when version is not a known marketplace", () => {
		const result = classifyInstallTarget("pkg@1.2.3", KNOWN);
		expect(result).toEqual({ type: "npm", spec: "pkg@1.2.3" });
	});

	it("classifies pkg@marketplace as npm when marketplace is not registered", () => {
		const result = classifyInstallTarget("hello@my-marketplace", new Set());
		expect(result).toEqual({ type: "npm", spec: "hello@my-marketplace" });
	});

	it("scoped @scope/pkg@marketplace is still npm — rule 1 wins", () => {
		// Even though this starts with @, the rule only triggers when spec.startsWith("@")
		// but @scope/pkg@my-marketplace DOES start with @ so rule 1 applies -> npm.
		// This confirms rule 1 is absolute for scoped packages.
		const result = classifyInstallTarget("@scope/pkg@my-marketplace", KNOWN);
		expect(result).toEqual({ type: "npm", spec: "@scope/pkg@my-marketplace" });
	});

	it("splits on last @ for non-scoped multi-@ spec", () => {
		// e.g. "some-pkg@my-marketplace" where my-marketplace is known
		const result = classifyInstallTarget("some-pkg@my-marketplace", KNOWN);
		expect(result).toEqual({ type: "marketplace", name: "some-pkg", marketplace: "my-marketplace" });
	});

	it("resolves a bare name to the marketplace that publishes it (catalog index)", () => {
		const index = new Map<string, string[]>([["azure", ["f5-sales-demo-marketplace"]]]);
		const result = classifyInstallTarget("azure", new Set(["f5-sales-demo-marketplace"]), index);
		expect(result).toEqual({ type: "marketplace", name: "azure", marketplace: "f5-sales-demo-marketplace" });
	});

	it("reports ambiguity when a bare name is published by multiple marketplaces", () => {
		const index = new Map<string, string[]>([["azure", ["mp-a", "mp-b"]]]);
		const result = classifyInstallTarget("azure", new Set(["mp-a", "mp-b"]), index);
		expect(result).toEqual({ type: "ambiguous", name: "azure", marketplaces: ["mp-a", "mp-b"] });
	});

	it("falls back to npm for a bare name absent from every catalog", () => {
		const index = new Map<string, string[]>([["azure", ["f5-sales-demo-marketplace"]]]);
		const result = classifyInstallTarget("cowsay", new Set(["f5-sales-demo-marketplace"]), index);
		expect(result).toEqual({ type: "npm", spec: "cowsay" });
	});

	it("forces npm for an explicit npm: prefix even when a marketplace publishes the name", () => {
		const index = new Map<string, string[]>([["azure", ["f5-sales-demo-marketplace"]]]);
		const result = classifyInstallTarget("npm:azure", new Set(["f5-sales-demo-marketplace"]), index);
		expect(result).toEqual({ type: "npm", spec: "azure" });
	});
});
