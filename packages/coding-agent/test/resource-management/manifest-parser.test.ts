import { describe, expect, it } from "bun:test";
import { ManifestParseError, parseManifests } from "../../src/resource-management/manifest-parser";

describe("parseManifests", () => {
	it("parses a valid manifest", () => {
		const objects = [
			{
				kind: "http_loadbalancer",
				metadata: { name: "my-lb", namespace: "production" },
				spec: { domains: ["example.com"] },
			},
		];
		const result = parseManifests(objects, "test.json");
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe("http_loadbalancer");
		expect(result[0].metadata.name).toBe("my-lb");
		expect(result[0].metadata.namespace).toBe("production");
		expect(result[0].spec.domains).toEqual(["example.com"]);
	});

	it("preserves rawObject", () => {
		const obj = {
			kind: "origin_pool",
			metadata: { name: "pool-1" },
			spec: { port: 8080 },
			extra_field: "preserved",
		};
		const result = parseManifests([obj], "test.json");
		expect(result[0].rawObject).toBe(obj);
		expect(result[0].rawObject.extra_field).toBe("preserved");
	});

	it("throws on missing kind", () => {
		const objects = [{ metadata: { name: "test" }, spec: {} }];
		expect(() => parseManifests(objects as any, "test.json")).toThrow(ManifestParseError);
	});

	it("throws on missing metadata", () => {
		const objects = [{ kind: "test", spec: {} }];
		expect(() => parseManifests(objects as any, "test.json")).toThrow(ManifestParseError);
	});

	it("throws on missing metadata.name", () => {
		const objects = [{ kind: "test", metadata: {}, spec: {} }];
		expect(() => parseManifests(objects as any, "test.json")).toThrow(ManifestParseError);
	});

	it("handles spec being undefined", () => {
		const objects = [{ kind: "test", metadata: { name: "t" } }];
		const result = parseManifests(objects as any, "test.json");
		expect(result[0].spec).toEqual({});
	});

	it("parses labels and annotations", () => {
		const objects = [
			{
				kind: "test",
				metadata: {
					name: "t",
					labels: { app: "frontend", env: "prod" },
					annotations: { note: "test" },
				},
				spec: {},
			},
		];
		const result = parseManifests(objects, "test.json");
		expect(result[0].metadata.labels).toEqual({ app: "frontend", env: "prod" });
		expect(result[0].metadata.annotations).toEqual({ note: "test" });
	});

	it("parses multiple manifests", () => {
		const objects = [
			{ kind: "type_a", metadata: { name: "a" }, spec: {} },
			{ kind: "type_b", metadata: { name: "b" }, spec: {} },
		];
		const result = parseManifests(objects, "test.json");
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe("type_a");
		expect(result[1].kind).toBe("type_b");
	});

	it("includes manifestIndex in error", () => {
		const objects = [
			{ kind: "ok", metadata: { name: "a" }, spec: {} },
			{ kind: "", metadata: { name: "b" }, spec: {} },
		];
		try {
			parseManifests(objects, "test.json");
			expect(true).toBe(false);
		} catch (err) {
			expect(err).toBeInstanceOf(ManifestParseError);
			expect((err as ManifestParseError).manifestIndex).toBe(1);
		}
	});

	it("parses description and disable fields", () => {
		const objects = [
			{
				kind: "test",
				metadata: { name: "t", description: "A test resource", disable: true },
				spec: {},
			},
		];
		const result = parseManifests(objects, "test.json");
		expect(result[0].metadata.description).toBe("A test resource");
		expect(result[0].metadata.disable).toBe(true);
	});
});
