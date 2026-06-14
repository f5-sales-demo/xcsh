import { describe, expect, it } from "bun:test";
import { ManifestParseError } from "../../../src/resource-management/manifest-parser";
import { validateManifest, validateManifests } from "../../../src/resource-management/manifest-validator";
import { buildManifest, NAMESPACE, parseManifests } from "./_helpers";

describe("Integration: validation-matrix", () => {
	// ──── http_loadbalancer ────

	it("1. http_loadbalancer: empty spec → MISSING_FIELD for spec.domains", () => {
		const manifest = buildManifest("http_loadbalancer", "val-lb-empty", {});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("domains"));
		expect(err).toBeDefined();
	});

	it("2. http_loadbalancer: missing metadata.name → MISSING_FIELD", () => {
		const raw = {
			kind: "http_loadbalancer",
			metadata: { namespace: NAMESPACE },
			spec: { domains: ["x.example.com"] },
		};
		// parseManifests requires metadata.name — build manifest manually to skip that
		// Use validateManifest on a hand-crafted ResourceManifest with empty name
		const manifest = {
			kind: "http_loadbalancer",
			metadata: { name: "", namespace: NAMESPACE },
			spec: { domains: ["x.example.com"] },
			rawObject: raw,
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path === "metadata.name");
		expect(err).toBeDefined();
	});

	it("3. http_loadbalancer: missing namespace, no override → MISSING_FIELD", () => {
		const raw = {
			kind: "http_loadbalancer",
			metadata: { name: "val-lb-ns" },
			spec: { domains: ["x.example.com"] },
		};
		const manifest = {
			kind: "http_loadbalancer",
			metadata: { name: "val-lb-ns" },
			spec: { domains: ["x.example.com"] },
			rawObject: raw,
		};
		const { result } = validateManifest(manifest);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path === "metadata.namespace");
		expect(err).toBeDefined();
	});

	it("4. http_loadbalancer: namespace override provided → passes namespace check", () => {
		const manifest = buildManifest(
			"http_loadbalancer",
			"val-lb-ns-ok",
			{
				domains: ["x.example.com"],
			},
			{ namespace: undefined },
		);
		// Even without namespace in metadata, providing override should pass namespace validation
		const { result } = validateManifest(manifest, "override-ns");
		const nsError = result.errors.find(e => e.code === "MISSING_FIELD" && e.path === "metadata.namespace");
		expect(nsError).toBeUndefined();
	});

	// ──── origin_pool ────

	it("5. origin_pool: no origin_servers → MISSING_FIELD", () => {
		const manifest = buildManifest("origin_pool", "val-op-no-servers", { port: 80 });
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("origin_servers"));
		expect(err).toBeDefined();
	});

	it("6. origin_pool: no port → MISSING_FIELD", () => {
		const manifest = buildManifest("origin_pool", "val-op-no-port", {
			origin_servers: [{ public_ip: { ip: "10.0.0.1" } }],
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("port"));
		expect(err).toBeDefined();
	});

	// ──── healthcheck ────

	it("7. healthcheck: no interval → MISSING_FIELD", () => {
		const manifest = buildManifest("healthcheck", "val-hc-no-int", {
			timeout: 3,
			healthy_threshold: 2,
			unhealthy_threshold: 2,
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("interval"));
		expect(err).toBeDefined();
	});

	it("8. healthcheck: no timeout → MISSING_FIELD", () => {
		const manifest = buildManifest("healthcheck", "val-hc-no-to", {
			interval: 10,
			healthy_threshold: 2,
			unhealthy_threshold: 2,
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("timeout"));
		expect(err).toBeDefined();
	});

	it("9. healthcheck: no healthy_threshold → MISSING_FIELD", () => {
		const manifest = buildManifest("healthcheck", "val-hc-no-ht", {
			interval: 10,
			timeout: 3,
			unhealthy_threshold: 2,
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("healthy_threshold"));
		expect(err).toBeDefined();
	});

	it("10. healthcheck: no unhealthy_threshold → MISSING_FIELD", () => {
		const manifest = buildManifest("healthcheck", "val-hc-no-ut", {
			interval: 10,
			timeout: 3,
			healthy_threshold: 2,
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("unhealthy_threshold"));
		expect(err).toBeDefined();
	});

	// ──── tcp_loadbalancer ────

	it("11. tcp_loadbalancer: no origin_pools → MISSING_FIELD", () => {
		const manifest = buildManifest("tcp_loadbalancer", "val-tcp-no-pools", {});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("origin_pools"));
		expect(err).toBeDefined();
	});

	// ──── certificate ────

	it("12. certificate: no certificate_url → MISSING_FIELD", () => {
		const manifest = buildManifest("certificate", "val-cert-no-url", {});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("certificate_url"));
		expect(err).toBeDefined();
	});

	// ──── app_firewall (no required spec fields) ────

	it("13. app_firewall: empty spec → valid=true", () => {
		const manifest = buildManifest("app_firewall", "val-afw-empty", {});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(true);
	});

	// ──── service_policy (no required spec fields) ────

	it("14. service_policy: empty spec → valid=true", () => {
		const manifest = buildManifest("service_policy", "val-sp-empty", {});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(true);
	});

	// ──── unknown / bad kind ────

	it("15. unknown kind → UNKNOWN_KIND with suggestions", () => {
		const raw = {
			kind: "bogus_xyz_123",
			metadata: { name: "val-bogus", namespace: NAMESPACE },
			spec: {},
		};
		const manifest = {
			kind: "bogus_xyz_123",
			metadata: { name: "val-bogus", namespace: NAMESPACE },
			spec: {},
			rawObject: raw,
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "UNKNOWN_KIND");
		expect(err).toBeDefined();
	});

	it("16. typo kind 'http_loadbalanc' → UNKNOWN_KIND, suggestions include http_loadbalancer", () => {
		const raw = {
			kind: "http_loadbalanc",
			metadata: { name: "val-typo", namespace: NAMESPACE },
			spec: {},
		};
		const manifest = {
			kind: "http_loadbalanc",
			metadata: { name: "val-typo", namespace: NAMESPACE },
			spec: {},
			rawObject: raw,
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "UNKNOWN_KIND");
		expect(err).toBeDefined();
		expect(err!.message).toContain("http_loadbalancer");
	});

	it("17. empty kind → MISSING_FIELD for kind", () => {
		const raw = {
			kind: "",
			metadata: { name: "val-empty-kind", namespace: NAMESPACE },
			spec: {},
		};
		const manifest = {
			kind: "",
			metadata: { name: "val-empty-kind", namespace: NAMESPACE },
			spec: {},
			rawObject: raw,
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const err = result.errors.find(e => e.code === "MISSING_FIELD" && e.path === "kind");
		expect(err).toBeDefined();
	});

	// ──── all-valid http_loadbalancer ────

	it("18. http_loadbalancer: all required fields present → valid=true", () => {
		const manifest = buildManifest("http_loadbalancer", "val-lb-ok", {
			domains: ["good.example.com"],
			routes: [{ simple_route: {} }],
			origin_pools: [{ pool: { name: "some-pool" } }],
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(true);
	});

	// ──── extra unknown fields ────

	it("19. extra unknown spec fields → validation still passes", () => {
		const manifest = buildManifest("app_firewall", "val-extra-fields", {
			totally_unknown_field: "hello",
			another_random_thing: 42,
		});
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(true);
	});

	// ──── validateManifests: mixed results ────

	it("20. validateManifests: array of 3 manifests, one invalid → mixed results", () => {
		const m1 = buildManifest("app_firewall", "val-batch-1", {});
		const m2 = buildManifest("healthcheck", "val-batch-2", {}); // missing required fields
		const m3 = buildManifest("service_policy", "val-batch-3", {});

		const { results } = validateManifests([m1, m2, m3], NAMESPACE);
		expect(results).toHaveLength(3);
		expect(results[0].valid).toBe(true);
		expect(results[1].valid).toBe(false); // healthcheck missing interval, timeout, etc.
		expect(results[2].valid).toBe(true);
	});

	// ──── parseManifests error cases ────

	it("21. parseManifests: missing metadata entirely → ManifestParseError", () => {
		expect(() => {
			parseManifests([{ kind: "app_firewall", spec: {} }], "test-source");
		}).toThrow(ManifestParseError);
	});

	it("22. parseManifests: missing kind field entirely → ManifestParseError", () => {
		expect(() => {
			parseManifests([{ metadata: { name: "no-kind" }, spec: {} }], "test-source");
		}).toThrow(ManifestParseError);
	});
});
