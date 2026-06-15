import { describe, expect, test } from "bun:test";
import type { MinimalExportFilter } from "../src/manifest-export";
import { applyMinimalExportFilter, formatManifestOutput, toManifest, toManifestList } from "../src/manifest-export";

describe("toManifest", () => {
	test("extracts kind, metadata, and spec from API response", () => {
		const apiResponse = {
			metadata: {
				name: "my-lb",
				namespace: "default",
				labels: { env: "prod" },
				description: "My load balancer",
			},
			system_metadata: {
				uid: "abc-123",
				creation_timestamp: "2026-01-01T00:00:00Z",
				creator_id: "user@example.com",
				tenant: "my-tenant",
			},
			spec: {
				domains: ["example.com"],
				http: { dns_volterra_managed: false, port: 80 },
			},
			status: { state: "active" },
		};

		const result = toManifest(apiResponse, "http_loadbalancer");

		expect(result.kind).toBe("http_loadbalancer");
		expect(result.metadata).toEqual({
			name: "my-lb",
			namespace: "default",
			labels: { env: "prod" },
			description: "My load balancer",
		});
		expect(result.spec).toEqual({
			domains: ["example.com"],
			http: { dns_volterra_managed: false, port: 80 },
		});
	});

	test("strips system_metadata and status", () => {
		const apiResponse = {
			metadata: { name: "test", namespace: "ns" },
			system_metadata: { uid: "x", creation_timestamp: "2026-01-01T00:00:00Z" },
			spec: { foo: "bar" },
			status: { phase: "ready" },
		};

		const result = toManifest(apiResponse, "origin_pool");

		expect(result).not.toHaveProperty("system_metadata");
		expect(result).not.toHaveProperty("status");
		expect(Object.keys(result)).toEqual(["kind", "metadata", "spec"]);
	});

	test("keeps only allowed metadata fields", () => {
		const apiResponse = {
			metadata: {
				name: "test",
				namespace: "ns",
				labels: { a: "b" },
				annotations: { x: "y" },
				description: "desc",
				disable: true,
				unknown_field: "should be dropped",
				internal_id: 123,
			},
			spec: {},
		};

		const result = toManifest(apiResponse, "app_firewall");

		expect(Object.keys(result.metadata).sort()).toEqual([
			"annotations",
			"description",
			"disable",
			"labels",
			"name",
			"namespace",
		]);
	});

	test("omits empty objects from metadata", () => {
		const apiResponse = {
			metadata: {
				name: "test",
				namespace: "ns",
				labels: {},
				annotations: {},
			},
			spec: {},
		};

		const result = toManifest(apiResponse, "healthcheck");

		expect(result.metadata).toEqual({ name: "test", namespace: "ns" });
	});

	test("omits null and undefined metadata values", () => {
		const apiResponse = {
			metadata: {
				name: "test",
				namespace: "ns",
				description: null,
				disable: undefined,
			},
			spec: { key: "value" },
		};

		const result = toManifest(apiResponse, "origin_pool");

		expect(result.metadata).toEqual({ name: "test", namespace: "ns" });
	});

	test("handles empty spec", () => {
		const result = toManifest({ metadata: { name: "x", namespace: "y" }, spec: {} }, "app_firewall");
		expect(result.spec).toEqual({});
	});

	test("handles missing metadata and spec", () => {
		const result = toManifest({}, "unknown_kind");
		expect(result.kind).toBe("unknown_kind");
		expect(result.metadata).toEqual({});
		expect(result.spec).toEqual({});
	});

	test("preserves full spec including server-added defaults", () => {
		const apiResponse = {
			metadata: { name: "fw", namespace: "ns" },
			spec: {
				user_field: "value",
				monitoring: {},
				default_detection_settings: { setting: true },
			},
		};

		const result = toManifest(apiResponse, "app_firewall");

		expect(result.spec).toEqual({
			user_field: "value",
			monitoring: {},
			default_detection_settings: { setting: true },
		});
	});
});

describe("toManifestList", () => {
	test("transforms list response items", () => {
		const listResponse = {
			items: [
				{ metadata: { name: "a", namespace: "ns" }, spec: { x: 1 } },
				{ metadata: { name: "b", namespace: "ns" }, spec: { y: 2 } },
			],
		};

		const result = toManifestList(listResponse, "origin_pool");

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe("origin_pool");
		expect(result[0].metadata).toEqual({ name: "a", namespace: "ns" });
		expect(result[1].metadata).toEqual({ name: "b", namespace: "ns" });
	});

	test("returns empty array for empty list", () => {
		expect(toManifestList({ items: [] }, "origin_pool")).toEqual([]);
	});

	test("returns empty array when items is missing", () => {
		expect(toManifestList({}, "origin_pool")).toEqual([]);
	});

	test("strips system_metadata from each item", () => {
		const listResponse = {
			items: [
				{
					metadata: { name: "a", namespace: "ns" },
					system_metadata: { uid: "x" },
					spec: {},
					status: {},
				},
			],
		};

		const result = toManifestList(listResponse, "healthcheck");

		expect(result[0]).not.toHaveProperty("system_metadata");
		expect(result[0]).not.toHaveProperty("status");
	});
});

describe("formatManifestOutput", () => {
	const singleManifest = {
		kind: "http_loadbalancer",
		metadata: { name: "my-lb", namespace: "default" },
		spec: { domains: ["example.com"] },
	};

	test("formats single manifest as JSON", () => {
		const output = formatManifestOutput([singleManifest], "json");
		const parsed = JSON.parse(output);
		expect(parsed.kind).toBe("http_loadbalancer");
		expect(parsed.metadata.name).toBe("my-lb");
	});

	test("formats multiple manifests as JSON array", () => {
		const second = { kind: "origin_pool", metadata: { name: "pool" }, spec: {} };
		const output = formatManifestOutput([singleManifest, second], "json");
		const parsed = JSON.parse(output);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
	});

	test("formats single manifest as YAML", () => {
		const output = formatManifestOutput([singleManifest], "yaml");
		expect(output).toContain("kind: http_loadbalancer");
		expect(output).toContain("name: my-lb");
	});

	test("formats multiple manifests as multi-doc YAML", () => {
		const second = { kind: "origin_pool", metadata: { name: "pool" }, spec: {} };
		const output = formatManifestOutput([singleManifest, second], "yaml");
		expect(output).toContain("---");
		expect(output).toContain("kind: http_loadbalancer");
		expect(output).toContain("kind: origin_pool");
	});
});

describe("applyMinimalExportFilter", () => {
	test("returns spec unchanged when no filter provided", () => {
		const spec = { domains: ["example.com"], monitoring: {} };
		const result = applyMinimalExportFilter(spec, undefined);
		expect(result).toEqual(spec);
	});

	test("strips field matching known default value", () => {
		const spec = { domains: ["example.com"], monitoring: {} };
		const filter: MinimalExportFilter = {
			serverDefaults: { monitoring: {} },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"] });
	});

	test("keeps field NOT matching known default value", () => {
		const spec = { domains: ["example.com"], monitoring: { enabled: true } };
		const filter: MinimalExportFilter = {
			serverDefaults: { monitoring: {} },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"], monitoring: { enabled: true } });
	});

	test("strips trivially-empty server-default field", () => {
		const spec = { domains: ["example.com"], custom_auth_types: [], add_location: false };
		const filter: MinimalExportFilter = {
			serverDefaultFields: ["custom_auth_types", "add_location"],
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"] });
	});

	test("keeps non-empty server-default field", () => {
		const spec = { custom_auth_types: [{ name: "x" }] };
		const filter: MinimalExportFilter = {
			serverDefaultFields: ["custom_auth_types"],
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ custom_auth_types: [{ name: "x" }] });
	});

	test("strips oneof default variant with empty value", () => {
		const spec = { domains: ["example.com"], round_robin: {} };
		const filter: MinimalExportFilter = {
			oneofDefaultVariants: { round_robin: "round_robin" },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"] });
	});

	test("keeps oneof non-default variant even if empty", () => {
		const spec = { domains: ["example.com"], least_active: {} };
		const filter: MinimalExportFilter = {
			oneofDefaultVariants: { round_robin: "round_robin" },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"], least_active: {} });
	});

	test("minimum config fields never stripped", () => {
		const spec = { domains: ["example.com"], advertise_on_public_default_vip: {} };
		const filter: MinimalExportFilter = {
			serverDefaultFields: ["advertise_on_public_default_vip"],
			minimumConfigFields: ["advertise_on_public_default_vip"],
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"], advertise_on_public_default_vip: {} });
	});

	test("unknown fields always kept", () => {
		const spec = { custom_field: "value", another: { nested: true } };
		const filter: MinimalExportFilter = {
			serverDefaults: { monitoring: {} },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ custom_field: "value", another: { nested: true } });
	});

	test("nested object stripping with parent pruning", () => {
		const spec = {
			domains: ["example.com"],
			detection_settings: {
				setting_a: {},
				setting_b: {},
			},
		};
		const filter: MinimalExportFilter = {
			serverDefaults: {
				"detection_settings.setting_a": {},
				"detection_settings.setting_b": {},
			},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ domains: ["example.com"] });
	});

	test("nested stripping keeps parent when sibling has content", () => {
		const spec = {
			detection_settings: {
				setting_a: {},
				setting_b: { custom: true },
			},
		};
		const filter: MinimalExportFilter = {
			serverDefaults: { "detection_settings.setting_a": {} },
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ detection_settings: { setting_b: { custom: true } } });
	});

	test("real resource: app_firewall minimal export", () => {
		const spec = {
			detection_settings: { custom_rule: "block" },
			monitoring: {},
			allow_all_response_codes: {},
			default_anonymization: {},
			default_bot_setting: {},
			default_detection_settings: {},
			use_default_blocking_page: {},
			disable_ai_enhancements: {},
		};
		const filter: MinimalExportFilter = {
			serverDefaults: {
				monitoring: {},
				allow_all_response_codes: {},
				default_anonymization: {},
				default_bot_setting: {},
				default_detection_settings: {},
				use_default_blocking_page: {},
				disable_ai_enhancements: {},
			},
		};
		const result = applyMinimalExportFilter(spec, filter);
		expect(result).toEqual({ detection_settings: { custom_rule: "block" } });
	});

	test("toManifest with filter produces minimal output", () => {
		const apiResponse = {
			metadata: { name: "fw", namespace: "ns" },
			spec: {
				user_field: "value",
				monitoring: {},
				default_detection_settings: {},
			},
		};
		const filter: MinimalExportFilter = {
			serverDefaults: { monitoring: {}, default_detection_settings: {} },
		};
		const result = toManifest(apiResponse, "app_firewall", filter);
		expect(result.spec).toEqual({ user_field: "value" });
	});
});
