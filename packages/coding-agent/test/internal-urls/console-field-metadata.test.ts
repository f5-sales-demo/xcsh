import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { CONSOLE_CATALOG_DATA } from "../../src/internal-urls/console-catalog.generated";
import { CONSOLE_FIELD_METADATA } from "../../src/internal-urls/console-field-metadata.generated";
import type { ConsoleFieldMeta } from "../../src/internal-urls/console-field-metadata-types";
import { createConsoleResolver } from "../../src/internal-urls/console-resolve";

function requiredFields(kind: string): string[] {
	const fields = CONSOLE_FIELD_METADATA.resources[kind] ?? {};
	return Object.entries(fields)
		.filter(([, m]) => (m as ConsoleFieldMeta).required === true)
		.map(([f]) => f);
}

describe("console field-requirements registry", () => {
	test("embeds the authoritative registry from api-specs-enriched", () => {
		expect(Object.keys(CONSOLE_FIELD_METADATA.resources).length).toBeGreaterThan(50);
	});

	test("http_loadbalancer requires Domains + Load Balancer Type (the gap that broke create)", () => {
		const req = requiredFields("http_loadbalancer");
		expect(req).toContain("metadata.name");
		expect(req).toContain("spec.domains");
		expect(req).toContain("spec.https_auto_cert"); // Load Balancer Type (OneOf)
	});

	test("origin_pool requires Port (the gap that broke create)", () => {
		const req = requiredFields("origin_pool");
		expect(req).toContain("spec.origin_servers");
		expect(req).toContain("spec.port");
	});

	test("xcsh://console/<resource> surfaces a Required fields section with constraints", async () => {
		const resolver = createConsoleResolver(CONSOLE_CATALOG_DATA, CONSOLE_FIELD_METADATA);
		const res = await resolver.resolve({
			rawHost: "console",
			rawPathname: "/http-load-balancer",
			pathname: "/http-load-balancer",
			href: "xcsh://console/http-load-balancer",
			searchParams: new URLSearchParams(),
			// biome-ignore lint/suspicious/noExplicitAny: minimal InternalUrl stub for the test
		} as any);
		expect(res.content).toContain("Required fields & constraints");
		expect(res.content).toContain("Domains");
		expect(res.content).toContain("`spec.domains`");
		// validation constraint surfaced
		expect(res.content).toContain("maxLength: 64");
	});
});

describe("create-workflow required-field coverage (core resources)", () => {
	// The four single-resource flows verified live this session must fully cover
	// their required fields (no gaps) — this is the invariant that prevents the
	// "required field not filled → form validation error" class of bug.
	const core = ["health-check", "app-firewall", "service-policy", "origin-pool"];
	for (const id of core) {
		test(`${id}/create covers all required fields`, () => {
			const createRaw = CONSOLE_CATALOG_DATA.workflows[`${id}/create`];
			expect(createRaw, `${id}/create workflow must exist`).toBeTruthy();
			const kind = (parseYaml(CONSOLE_CATALOG_DATA.resources[id] ?? "") as { api?: { kind?: string } })?.api?.kind;
			const fields = (kind && CONSOLE_FIELD_METADATA.resources[kind]) || {};
			const req = Object.entries(fields).filter(([, m]) => (m as ConsoleFieldMeta).required === true);
			const wfText = createRaw ?? "";
			for (const [, raw] of req) {
				const m = raw as ConsoleFieldMeta;
				const label = m.label ?? "";
				const hasDefault = m.default !== undefined && m.default !== "" && m.default !== 0;
				// Covered if a step names the field, a console default applies, or the
				// console pre-selects an API-required OneOf (no step needed for a
				// minimal create — e.g. service_policy.spec.rule_choice).
				const covered =
					hasDefault ||
					m.console_preselected === true ||
					wfText.includes(`name='${label}'`) ||
					wfText.toLowerCase().includes(label.toLowerCase());
				expect(covered, `${id}: required field "${label}" must be filled or defaulted`).toBe(true);
			}
		});
	}
});
