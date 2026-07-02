import { describe, expect, it } from "bun:test";
import {
	buildMinimalSpec,
	chosenOneofMembers,
	requiredSpecFields,
	type SchemaIndex,
} from "../../src/sweep/openapi-spec";

// Synthetic index mirroring real enriched-OpenAPI shapes.
const INDEX: SchemaIndex = {
	// healthcheck: required scalars + oneof(health_check) recommending http_health_check
	healthcheckCreateSpecType: {
		type: "object",
		"x-ves-oneof-field-health_check": JSON.stringify(["http_health_check", "tcp_health_check"]),
		"x-f5xc-recommended-oneof-variant": { health_check: "http_health_check" },
		"x-f5xc-minimum-configuration": {
			required_fields: ["metadata.name", "metadata.namespace", "spec.interval", "spec.timeout"],
		},
		properties: {
			interval: { type: "integer", "x-ves-example": "10" },
			timeout: { type: "integer", "x-ves-example": "1" },
			http_health_check: { allOf: [{ $ref: "#/components/schemas/healthcheckHttp" }] },
			tcp_health_check: { allOf: [{ $ref: "#/components/schemas/healthcheckTcp" }] },
		},
	},
	healthcheckHttp: {
		type: "object",
		"x-f5xc-minimum-configuration": { required_fields: ["path"] },
		properties: { path: { type: "string", "x-ves-example": "/healthz" } },
	},
	healthcheckTcp: { type: "object", properties: {} },
	// ip_prefix_set: array of objects, bare required_field name
	ip_prefix_setCreateSpecType: {
		type: "object",
		"x-f5xc-minimum-configuration": { required_fields: ["ipv4_prefixes"] },
		properties: {
			ipv4_prefixes: { type: "array", items: { $ref: "#/components/schemas/ipv4PrefixItem" } },
		},
	},
	ipv4PrefixItem: {
		type: "object",
		"x-f5xc-minimum-configuration": { required_fields: ["ipv4_prefix"] },
		properties: { ipv4_prefix: { type: "string", "x-ves-example": "10.0.0.0/24" } },
	},
};

describe("requiredSpecFields", () => {
	it("strips spec./metadata. and keeps only real properties", () => {
		expect(requiredSpecFields(INDEX.healthcheckCreateSpecType!)).toEqual(["interval", "timeout"]);
	});
	it("handles bare field names", () => {
		expect(requiredSpecFields(INDEX.ip_prefix_setCreateSpecType!)).toEqual(["ipv4_prefixes"]);
	});
});

describe("chosenOneofMembers", () => {
	it("picks the recommended variant", () => {
		expect(chosenOneofMembers(INDEX.healthcheckCreateSpecType!)).toEqual(["http_health_check"]);
	});
});

describe("buildMinimalSpec", () => {
	it("builds healthcheck: scalars coerced + recommended oneof object recursed", () => {
		const { ok, body } = buildMinimalSpec(INDEX, "healthcheck", "hc1", "demo");
		expect(ok).toBe(true);
		expect(body).toEqual({
			metadata: { name: "hc1", namespace: "demo" },
			spec: { interval: 10, timeout: 1, http_health_check: { path: "/healthz" } },
		});
	});
	it("builds ip-prefix-set: array of objects from item schema", () => {
		const { body } = buildMinimalSpec(INDEX, "ip_prefix_set", "p1", "demo");
		expect(body.spec).toEqual({ ipv4_prefixes: [{ ipv4_prefix: "10.0.0.0/24" }] });
	});
	it("reports when no schema exists", () => {
		const { ok, reason } = buildMinimalSpec(INDEX, "nonexistent", "x", "demo");
		expect(ok).toBe(false);
		expect(reason).toMatch(/no CreateSpecType/);
	});
});
