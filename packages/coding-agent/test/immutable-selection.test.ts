import { describe, expect, it } from "bun:test";
import {
	API_CATALOG_CATEGORY_SUMMARIES,
	API_CATALOG_DATA,
	API_CATALOG_INDEX,
} from "../src/internal-urls/api-catalog-index.generated";
import { createApiCatalogResolver } from "../src/internal-urls/api-catalog-resolve";
import { API_SPEC_DATA, API_SPEC_INDEX } from "../src/internal-urls/api-spec-index.generated";
import { createApiSpecResolver } from "../src/internal-urls/api-spec-resolve";
import { createBody, immutableGroups, selectedMember, validateBody } from "../src/internal-urls/immutable-selection";

const spec: any = {
	info: {},
	paths: {},
	components: {
		schemas: {
			S: {
				type: "object",
				properties: {
					http: { type: "object" },
					https: { type: "object" },
					https_auto_cert: { type: "object" },
					domains: { type: "array", items: { type: "string" } },
					state: { type: "string", readOnly: true },
				},
				required: ["domains"],
				"x-f5xc-immutable-oneof-groups": { loadbalancer_type: ["http", "https", "https_auto_cert"] },
			},
		},
	},
};
const schema = {
	type: "object",
	properties: {
		metadata: {
			type: "object",
			properties: { name: { type: "string" }, namespace: { type: "string" }, labels: { type: "object" } },
		},
		spec: { $ref: "#/components/schemas/S" },
	},
};
describe("immutable selection contract", () => {
	it("extracts nested referenced groups", () =>
		expect(immutableGroups(schema, spec)).toEqual([
			{ path: ["spec"], name: "loadbalancer_type", members: ["http", "https", "https_auto_cert"] },
		]));
	for (const from of ["http", "https", "https_auto_cert"])
		for (const to of ["http", "https", "https_auto_cert"])
			it(`${from} to ${to} compares member only`, () => {
				const g = immutableGroups(schema, spec)[0]!;
				expect(selectedMember({ spec: { [from]: { port: 80 } } }, g)).toBe(from);
				expect(selectedMember({ spec: { [to]: { port: 443 } } }, g)).toBe(to);
			});
	it("rejects missing and ambiguous selections", () => {
		const g = immutableGroups(schema, spec)[0]!;
		expect(() => selectedMember({ spec: {} }, g)).toThrow();
		expect(() => selectedMember({ spec: { http: {}, https: {} } }, g)).toThrow();
	});
	it("projects writable config and keeps unrelated labels and routes", () =>
		expect(
			createBody(
				{
					metadata: { name: "lb", namespace: "demo-app", labels: { team: "demo" }, uid: "old" },
					system_metadata: { uid: "old" },
					spec: { http: {}, domains: ["example.test"], state: "ACTIVE" },
				},
				schema,
				spec,
			),
		).toEqual({
			metadata: { name: "lb", namespace: "demo-app", labels: { team: "demo" } },
			spec: { http: {}, domains: ["example.test"] },
		}));
	it("validates required fields and field types before deletion", () => {
		expect(validateBody({ spec: { http: {}, domains: 42 } }, schema, spec).join()).toContain("domains");
		expect(validateBody({ spec: { http: {} } }, schema, spec).join()).toContain("required");
	});
});

it("shows immutable conversion rules in both reference views", async () => {
	const parse = (value: string) => {
		const url: any = new URL(value);
		url.rawHost = url.hostname;
		url.rawPathname = url.pathname;
		return url;
	};
	const schema = await createApiSpecResolver(API_SPEC_INDEX, API_SPEC_DATA as any).resolve(
		parse("xcsh://api-spec/virtual?resource=http_loadbalancer&crud=true"),
	);
	expect(schema.content).toContain("Immutable selection");
	expect(schema.content).toContain("DELETE then POST");
	const catalog = await createApiCatalogResolver(
		API_CATALOG_INDEX,
		API_CATALOG_CATEGORY_SUMMARIES,
		API_CATALOG_DATA,
		API_SPEC_INDEX,
	).resolve(parse("xcsh://api-catalog/?resource=http_loadbalancer&compact=true"));
	expect(catalog.content).toContain("Immutable selection");
	expect(catalog.content).toContain("DELETE then POST");
});

it("preserves a decoded route response using the create schema encoded field", () => {
	const schema: any = {
		type: "object",
		properties: { response_body_encoded: { type: "string" }, response_code: { type: "integer" } },
	};
	expect(
		createBody({ response_body: "accepted", response_body_encoded: "", response_code: 200 }, schema, spec),
	).toEqual({ response_body_encoded: "string:///YWNjZXB0ZWQ=", response_code: 200 });
});
