import { describe, expect, test } from "bun:test";
import {
	getDeprecatedClis,
	isDisallowedCliCommand,
	renderDeprecationGuardrails,
	XCSH_NATIVE_API_GUIDANCE,
} from "@f5-sales-demo/xcsh/deprecations";

describe("getDeprecatedClis", () => {
	test("includes vesctl from branding data", () => {
		expect(getDeprecatedClis()).toContain("vesctl");
	});

	test("is lowercased and deduplicated", () => {
		const clis = getDeprecatedClis();
		expect(clis).toEqual(clis.map(c => c.toLowerCase()));
		expect(new Set(clis).size).toBe(clis.length);
	});
});

describe("isDisallowedCliCommand", () => {
	test("flags a vesctl command", () => {
		expect(isDisallowedCliCommand("vesctl dns list")).toBe(true);
	});

	test("flags a curl against the F5 XC API", () => {
		expect(isDisallowedCliCommand("curl $F5XC_API_URL/api/config/namespaces/default/http_loadbalancers")).toBe(true);
	});

	test("allows a normal non-F5XC command", () => {
		expect(isDisallowedCliCommand("kubectl get pods")).toBe(false);
	});

	test("allows a curl to an unrelated host", () => {
		expect(isDisallowedCliCommand("curl https://example.com/health")).toBe(false);
	});

	test("is case- and whitespace-insensitive on the leading token", () => {
		expect(isDisallowedCliCommand("  VESCTL  dns list ")).toBe(true);
	});
});

describe("renderDeprecationGuardrails", () => {
	const block = renderDeprecationGuardrails();

	test("forbids vesctl and points to xcsh_api", () => {
		expect(block).toContain("vesctl");
		expect(block).toContain("xcsh_api");
	});

	test("remaps the legacy API-docs URL to the enriched canonical URL", () => {
		expect(block).toContain("docs.cloud.f5.com/docs-v2/api");
		expect(block).toContain("f5-sales-demo.github.io/api-specs-enriched/en/");
	});

	test("captures the Volterra brand-vs-identifier nuance", () => {
		expect(block).toContain("Volterra");
		expect(block).toContain("F5 Distributed Cloud");
		expect(block).toContain("volterra_*");
	});

	test("points to xcsh://branding for full detail", () => {
		expect(block).toContain("xcsh://branding");
	});
});

describe("XCSH_NATIVE_API_GUIDANCE", () => {
	test("names the xcsh-native replacement path", () => {
		expect(XCSH_NATIVE_API_GUIDANCE).toContain("xcsh_api");
	});
});
