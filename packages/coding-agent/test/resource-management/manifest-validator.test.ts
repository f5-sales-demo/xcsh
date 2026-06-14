import { describe, expect, it } from "bun:test";
import { formatValidationErrors, validateManifest } from "../../src/resource-management/manifest-validator";
import type { ResourceManifest } from "../../src/resource-management/types";

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
		const { result } = validateManifest(makeManifest());
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("fails when kind is empty", () => {
		const { result } = validateManifest(makeManifest({ kind: "" }));
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "kind")).toBe(true);
	});

	it("fails when metadata.name is empty", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "" } }));
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "metadata.name")).toBe(true);
	});

	it("fails when namespace is missing and no override", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "test" } }));
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.path === "metadata.namespace")).toBe(true);
	});

	it("passes when namespace override is provided", () => {
		const { result } = validateManifest(makeManifest({ metadata: { name: "test" } }), "production");
		expect(result.errors.some(e => e.path === "metadata.namespace")).toBe(false);
	});

	it("fails for unknown kind", () => {
		const { result } = validateManifest(makeManifest({ kind: "nonexistent_xyz" }));
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.code === "UNKNOWN_KIND")).toBe(true);
	});

	it("resolves kind when valid", () => {
		const { resolved } = validateManifest(makeManifest());
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
		const { result } = validateManifest(manifest);
		const specErrors = result.errors.filter(e => e.path.startsWith("spec."));
		expect(specErrors.length).toBeGreaterThan(0);
	});
});

describe("formatValidationErrors", () => {
	it("formats errors with resource identity", () => {
		const manifest = makeManifest({ kind: "nonexistent" });
		const { result } = validateManifest(manifest);
		const output = formatValidationErrors(manifest, result);
		expect(output).toContain("nonexistent");
		expect(output).toContain("test-lb");
	});

	it("formats multiple errors", () => {
		const manifest = makeManifest({
			kind: "",
			metadata: { name: "" },
		});
		const { result } = validateManifest(manifest);
		const output = formatValidationErrors(manifest, result);
		const lines = output.split("\n").filter(l => l.startsWith("  -"));
		expect(lines.length).toBeGreaterThan(1);
	});
});
