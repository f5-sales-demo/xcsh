import { describe, expect, test } from "bun:test";
import { buildFilterFromMetadata, buildMinimalExportFilter, type KindDefaultsMetadata } from "../src/defaults-metadata";
import { applyMinimalExportFilter } from "../src/manifest-export";

function makeMeta(overrides: Partial<KindDefaultsMetadata> = {}): KindDefaultsMetadata {
	return {
		serverDefaultFields: [],
		fieldDefaults: {},
		minimumConfigFields: [],
		fieldConflicts: {},
		...overrides,
	};
}

describe("buildFilterFromMetadata", () => {
	test("returns undefined when there are no server-default fields", () => {
		expect(buildFilterFromMetadata(makeMeta())).toBeUndefined();
	});

	test("splits server-default fields into known-value defaults vs empty-default fields, stripping the spec. prefix", () => {
		const meta = makeMeta({
			serverDefaultFields: ["spec.loadbalancer_algorithm", "spec.swagger_specs"],
			fieldDefaults: { "spec.loadbalancer_algorithm": "ROUND_ROBIN" },
		});

		const filter = buildFilterFromMetadata(meta);

		// known default value → serverDefaults map (keyed without spec. prefix)
		expect(filter?.serverDefaults).toEqual({ loadbalancer_algorithm: "ROUND_ROBIN" });
		// no known value → serverDefaultFields list (without spec. prefix)
		expect(filter?.serverDefaultFields).toEqual(["swagger_specs"]);
	});

	test("derives oneof default variants from conflicts on server-defaulted fields (keyed by leaf field name)", () => {
		const meta = makeMeta({
			serverDefaultFields: ["spec.round_robin"],
			fieldConflicts: { "spec.round_robin": ["least_active", "random"] },
		});

		const filter = buildFilterFromMetadata(meta);

		expect(filter?.oneofDefaultVariants).toEqual({ round_robin: "round_robin" });
	});

	test("ignores conflicts on fields that are not server-defaulted", () => {
		const meta = makeMeta({
			serverDefaultFields: ["spec.monitoring"],
			fieldConflicts: { "spec.user_choice": ["other_choice"] },
		});

		const filter = buildFilterFromMetadata(meta);

		expect(filter?.oneofDefaultVariants).toEqual({});
	});

	test("strips the spec. prefix from minimum-config fields", () => {
		const meta = makeMeta({
			serverDefaultFields: ["spec.timeout"],
			minimumConfigFields: ["spec.timeout", "spec.interval"],
		});

		const filter = buildFilterFromMetadata(meta);

		expect(filter?.minimumConfigFields).toEqual(["timeout", "interval"]);
	});
});

describe("buildMinimalExportFilter (generated-table lookup)", () => {
	test("returns undefined for an unknown kind", () => {
		expect(buildMinimalExportFilter("definitely_not_a_real_kind_xyz")).toBeUndefined();
	});
});

describe("metadata → filter → applyMinimalExportFilter (end-to-end)", () => {
	test("strips server defaults and empty oneof variants while keeping user config (origin_pool-like)", () => {
		const meta = makeMeta({
			serverDefaultFields: [
				"spec.loadbalancer_algorithm",
				"spec.endpoint_selection",
				"spec.round_robin",
				"spec.no_tls",
			],
			fieldDefaults: { "spec.loadbalancer_algorithm": "ROUND_ROBIN", "spec.endpoint_selection": "DISTRIBUTED" },
			fieldConflicts: { "spec.round_robin": ["least_active", "random"] },
		});
		const filter = buildFilterFromMetadata(meta);

		const spec = {
			origin_servers: [{ public_ip: { ip: "1.2.3.4" } }],
			port: 443,
			loadbalancer_algorithm: "ROUND_ROBIN", // matches default → stripped
			endpoint_selection: "LOCAL_PREFERRED", // differs from default → kept
			round_robin: {}, // empty oneof default → stripped
			no_tls: {}, // trivially-empty server-default field → stripped
		};

		const result = applyMinimalExportFilter(spec, filter);

		expect(result).toEqual({
			origin_servers: [{ public_ip: { ip: "1.2.3.4" } }],
			port: 443,
			endpoint_selection: "LOCAL_PREFERRED",
		});
	});
});
