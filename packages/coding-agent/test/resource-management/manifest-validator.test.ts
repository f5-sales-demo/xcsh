import { describe, expect, it } from "bun:test";
import type { ResourceManifest } from "@f5xc-salesdemos/pi-resource-management";
import { formatValidationErrors, validateManifest } from "@f5xc-salesdemos/pi-resource-management";
import { kindResolver } from "../../src/resource-management/index";

function makeManifest(overrides: Partial<ResourceManifest> = {}): ResourceManifest {
	return {
		kind: "http_loadbalancer",
		metadata: { name: "test-lb", namespace: "default" },
		spec: {
			domains: ["example.com"],
			routes: [],
			origin_pools: [],
		},
		rawObject: {
			kind: "http_loadbalancer",
			metadata: { name: "test-lb", namespace: "default" },
			spec: {
				domains: ["example.com"],
				routes: [],
				origin_pools: [],
			},
		},
		...overrides,
	};
}

describe("validateManifest", () => {
	it("passes for a valid manifest with namespace", () => {
		const { result } = validateManifest(makeManifest(), kindResolver);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("fails when kind is empty", () => {
		const { result } = validateManifest(makeManifest({ kind: "" }), kindResolver);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "kind")).toBe(true);
	});

	it("fails when metadata.name is empty", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "" } }), kindResolver);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "metadata.name")).toBe(true);
	});

	it("fails when namespace is missing and no override", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "test" } }), kindResolver);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "metadata.namespace")).toBe(true);
	});

	it("passes when namespace override is provided", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "test" } }), kindResolver, "production");
		expect(result.errors.some(e => e.path === "metadata.namespace")).toBe(false);
	});

	it("fails for unknown kind", () => {
		const { result } = validateManifest(makeManifest({ kind: "nonexistent_xyz" }), kindResolver);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.code === "UNKNOWN_KIND")).toBe(true);
	});

	it("resolves kind when valid", () => {
		const { resolved } = validateManifest(makeManifest(), kindResolver);
		expect(resolved).toBeDefined();
		expect(resolved?.kind).toBe("http_loadbalancer");
		expect(resolved?.paths.list).toBeDefined();
	});

	it("checks required spec fields from validation data", () => {
		const manifest = makeManifest({
			rawObject: {
				kind: "http_loadbalancer",
				metadata: { name: "test", namespace: "default" },
				spec: {},
			},
		});
		const { result } = validateManifest(manifest, kindResolver);
		const specErrors = result.errors.filter(e => e.path.startsWith("spec."));
		expect(specErrors.length).toBeGreaterThan(0);
	});
});

describe("formatValidationErrors", () => {
	it("formats errors with resource identity", () => {
		const manifest = makeManifest({ kind: "nonexistent" });
		const { result } = validateManifest(manifest, kindResolver);
		const output = formatValidationErrors(manifest, result);
		expect(output).toContain("nonexistent");
		expect(output).toContain("test-lb");
	});

	it("formats multiple errors", () => {
		const manifest = makeManifest({
			kind: "",
			metadata: { name: "" },
		});
		const { result } = validateManifest(manifest, kindResolver);
		const output = formatValidationErrors(manifest, result);
		const lines = output.split("\n").filter(l => l.startsWith("  -"));
		expect(lines.length).toBeGreaterThan(1);
	});
});
