import { describe, expect, it } from "bun:test";
import { KindResolutionError } from "@f5xc-salesdemos/pi-resource-management";
import { kindResolver } from "../../src/resource-management/index";

const { resolveKind, getAllKnownKinds, getKindsWithApiPaths } = kindResolver;

describe("resolveKind", () => {
	it("resolves http_loadbalancer", () => {
		const result = resolveKind("http_loadbalancer");
		expect(result.kind).toBe("http_loadbalancer");
		expect(result.paths.list).toContain("{namespace}");
		expect(result.paths.list).not.toContain("{name}");
		expect(result.paths.get).toContain("{namespace}");
		expect(result.paths.get).toContain("{name}");
		expect(result.paths.create).toBe(result.paths.list);
		expect(result.paths.update).toBe(result.paths.get);
		expect(result.paths.delete).toBe(result.paths.get);
	});

	it("resolves origin_pool", () => {
		const result = resolveKind("origin_pool");
		expect(result.kind).toBe("origin_pool");
		expect(result.paths.list).toBeDefined();
	});

	it("resolves app_firewall", () => {
		const result = resolveKind("app_firewall");
		expect(result.kind).toBe("app_firewall");
	});

	it("throws KindResolutionError for unknown kind", () => {
		expect(() => resolveKind("nonexistent_resource_xyz")).toThrow(KindResolutionError);
	});

	it("provides suggestions for unknown kind", () => {
		try {
			resolveKind("http_loadbalanc");
			expect(true).toBe(false);
		} catch (err) {
			expect(err).toBeInstanceOf(KindResolutionError);
			const kre = err as KindResolutionError;
			expect(kre.suggestions.length).toBeGreaterThan(0);
			expect(kre.suggestions).toContain("http_loadbalancer");
		}
	});

	it("normalizes metadata.namespace to namespace in paths", () => {
		const result = resolveKind("http_loadbalancer");
		expect(result.paths.list).not.toContain("{metadata.namespace}");
		expect(result.paths.get).not.toContain("{metadata.name}");
	});

	it("includes validation data when available", () => {
		const result = resolveKind("http_loadbalancer");
		expect(result.validation).toBeDefined();
		expect(result.validation?.create).toBeInstanceOf(Array);
	});
});

describe("getAllKnownKinds", () => {
	it("returns a non-empty sorted array", () => {
		const kinds = getAllKnownKinds();
		expect(kinds.length).toBeGreaterThan(10);
		for (let i = 1; i < kinds.length; i++) {
			expect(kinds[i].localeCompare(kinds[i - 1])).toBeGreaterThanOrEqual(0);
		}
	});

	it("includes common resource types", () => {
		const kinds = getAllKnownKinds();
		expect(kinds).toContain("http_loadbalancer");
		expect(kinds).toContain("origin_pool");
	});
});

describe("getKindsWithApiPaths", () => {
	it("returns a non-empty list of kinds", () => {
		const kinds = getKindsWithApiPaths();
		expect(kinds.length).toBeGreaterThan(0);
		expect(kinds).toContain("http_loadbalancer");
	});

	it("includes kinds resolvable to CRUD paths", () => {
		const resolved = resolveKind("http_loadbalancer");
		expect(resolved.paths.list).toBeDefined();
		expect(resolved.paths.get).toBeDefined();
	});
});
