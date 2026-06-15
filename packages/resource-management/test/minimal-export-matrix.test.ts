import { describe, expect, test } from "bun:test";
import type { MinimalExportFilter } from "../src/manifest-export";
import { applyMinimalExportFilter, formatManifestOutput, toManifest } from "../src/manifest-export";
import { parseManifests } from "../src/manifest-parser";

function makeFilter(overrides: Partial<MinimalExportFilter> = {}): MinimalExportFilter {
	return {
		serverDefaults: {},
		serverDefaultFields: [],
		minimumConfigFields: [],
		oneofDefaultVariants: {},
		...overrides,
	};
}

function roundTrip(spec: Record<string, unknown>, kind: string): Record<string, unknown> {
	const manifest = { kind, metadata: { name: "test", namespace: "ns" }, spec };
	const json = formatManifestOutput([manifest], "json");
	const parsed = parseManifests([JSON.parse(json) as Record<string, unknown>], "test");
	return parsed[0].spec;
}

describe("round-trip: export → format → parse for each resource type", () => {
	const resourceTypes = [
		"http_loadbalancer",
		"origin_pool",
		"healthcheck",
		"app_firewall",
		"route",
		"api_discovery",
		"network_connector",
		"network_firewall",
		"network_policy",
		"site_mesh_group",
		"virtual_site",
		"virtual_network",
	] as const;

	for (const kind of resourceTypes) {
		test(`${kind}: filtered manifest round-trips through format→parse`, () => {
			const spec = { user_field: "value", domains: ["example.com"] };
			const filter = makeFilter({ serverDefaults: { default_field: {} } });
			const apiResponse = {
				metadata: { name: `test-${kind}`, namespace: "ns" },
				spec: { ...spec, default_field: {} },
			};

			const manifest = toManifest(apiResponse, kind, filter);
			expect(manifest.spec).not.toHaveProperty("default_field");
			expect(manifest.spec).toHaveProperty("user_field");

			const formatted = formatManifestOutput([manifest], "json");
			const reparsed = parseManifests([JSON.parse(formatted) as Record<string, unknown>], "test");
			expect(reparsed).toHaveLength(1);
			expect(reparsed[0].kind).toBe(kind);
			expect(reparsed[0].metadata.name).toBe(`test-${kind}`);
		});

		test(`${kind}: YAML round-trip preserves content`, () => {
			const apiResponse = {
				metadata: { name: `yaml-${kind}`, namespace: "ns" },
				spec: { domains: ["example.com"], config: { enabled: true } },
			};

			const manifest = toManifest(apiResponse, kind);
			const yaml = formatManifestOutput([manifest], "yaml");

			expect(yaml).toContain(`kind: ${kind}`);
			expect(yaml).toContain(`name: yaml-${kind}`);
			expect(yaml).toContain("example.com");
		});
	}
});

describe("stripping behavior matrix", () => {
	test("app_firewall: strips 7 known server defaults", () => {
		const filter = makeFilter({
			serverDefaults: {
				monitoring: {},
				allow_all_response_codes: {},
				default_anonymization: {},
				default_bot_setting: {},
				default_detection_settings: {},
				use_default_blocking_page: {},
				disable_ai_enhancements: {},
			},
		});

		const spec = {
			detection_settings: { signature_selection_setting: { default_attack_type_settings: {} } },
			monitoring: {},
			allow_all_response_codes: {},
			default_anonymization: {},
			default_bot_setting: {},
			default_detection_settings: {},
			use_default_blocking_page: {},
			disable_ai_enhancements: {},
		};

		const result = applyMinimalExportFilter(spec, filter);
		expect(Object.keys(result)).toEqual(["detection_settings"]);
	});

	test("app_firewall: keeps non-default monitoring value", () => {
		const filter = makeFilter({ serverDefaults: { monitoring: {} } });
		const spec = { monitoring: { enabled: true }, user_config: "value" };
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toHaveProperty("monitoring");
		expect(result).toHaveProperty("user_config");
	});

	test("healthcheck: minimumConfigFields survive stripping", () => {
		const filter = makeFilter({
			serverDefaultFields: ["timeout", "interval", "unhealthy_threshold", "healthy_threshold"],
			minimumConfigFields: ["timeout", "interval"],
		});
		const spec = { timeout: 0, interval: 0, unhealthy_threshold: 0, healthy_threshold: 0, custom: "yes" };
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toHaveProperty("timeout");
		expect(result).toHaveProperty("interval");
		expect(result).not.toHaveProperty("unhealthy_threshold");
		expect(result).not.toHaveProperty("healthy_threshold");
		expect(result).toHaveProperty("custom");
	});

	test("http_loadbalancer: oneOf default variant stripped, non-default kept", () => {
		const filter = makeFilter({
			oneofDefaultVariants: {
				round_robin: "round_robin",
				disable_rate_limit: "disable_rate_limit",
				no_challenge: "no_challenge",
			},
		});

		const specWithDefaults = {
			domains: ["example.com"],
			round_robin: {},
			disable_rate_limit: {},
			no_challenge: {},
		};
		const result1 = applyMinimalExportFilter(specWithDefaults, filter);
		expect(result1).toEqual({ domains: ["example.com"] });

		const specWithNonDefaults = {
			domains: ["example.com"],
			least_active: {},
			rate_limit: { total_number: 100 },
			js_challenge: { js_script_delay: 5000 },
		};
		const result2 = applyMinimalExportFilter(specWithNonDefaults, filter);
		expect(result2).toEqual(specWithNonDefaults);
	});

	test("origin_pool: complex nested spec preserves user config", () => {
		const filter = makeFilter({
			serverDefaultFields: ["no_tls", "same_as_endpoint_port"],
			oneofDefaultVariants: { round_robin: "round_robin" },
		});
		const spec = {
			origin_servers: [{ public_ip: { ip: "1.2.3.4" } }],
			port: 443,
			use_tls: { sni: "example.com" },
			loadbalancer_algorithm: "ROUND_ROBIN",
			round_robin: {},
			no_tls: {},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toHaveProperty("origin_servers");
		expect(result).toHaveProperty("port");
		expect(result).toHaveProperty("use_tls");
		expect(result).toHaveProperty("loadbalancer_algorithm");
		expect(result).not.toHaveProperty("round_robin");
		expect(result).not.toHaveProperty("no_tls");
	});

	test("network_firewall: strips server defaults, keeps user policies", () => {
		const filter = makeFilter({
			serverDefaults: { default_detection_settings: {}, monitoring: {} },
			serverDefaultFields: ["disable_intrusion_prevention"],
		});
		const spec = {
			active_enhanced_firewall_policies: { policies: [{ name: "my-policy" }] },
			default_detection_settings: {},
			monitoring: {},
			disable_intrusion_prevention: {},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({
			active_enhanced_firewall_policies: { policies: [{ name: "my-policy" }] },
		});
	});

	test("virtual_network: unknown fields always kept", () => {
		const filter = makeFilter({ serverDefaults: { known_default: {} } });
		const spec = {
			site_local_network: true,
			custom_config: { subnets: ["10.0.0.0/8"] },
			known_default: {},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toHaveProperty("site_local_network");
		expect(result).toHaveProperty("custom_config");
		expect(result).not.toHaveProperty("known_default");
	});

	test("site_mesh_group: all user config preserved when no defaults match", () => {
		const filter = makeFilter();
		const spec = {
			type: "SITE_MESH_GROUP_TYPE_FULL_MESH",
			virtual_site: { tenant: "t", namespace: "ns", name: "vs" },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual(spec);
	});

	test("network_policy: nested parent pruning after child strip", () => {
		const filter = makeFilter({
			serverDefaults: { "rules.default_action": {} },
		});
		const spec = {
			rules: { default_action: {}, custom_rule: "block" },
			endpoint: { any: true },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({
			rules: { custom_rule: "block" },
			endpoint: { any: true },
		});
	});

	test("api_discovery: strips single server default", () => {
		const filter = makeFilter({ serverDefaults: { discovered_api_settings: {} } });
		const spec = {
			discovery_config: { enable: true },
			discovered_api_settings: {},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ discovery_config: { enable: true } });
	});

	test("route: empty filter preserves everything", () => {
		const filter = makeFilter();
		const spec = {
			match: { path: { prefix: "/api" } },
			route_destination: { destinations: [{ cluster: { name: "backend" } }] },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual(spec);
	});
});
