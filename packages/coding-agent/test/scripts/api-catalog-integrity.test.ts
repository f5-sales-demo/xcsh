import { describe, expect, it } from "bun:test";
import {
	assertCanonicalCrudMapped,
	assertCatalogIntegrity,
	buildPathToCatalogCategories,
	deriveCanonicalCrudOperations,
	normalizeApiPath,
} from "../../scripts/api-catalog-integrity";

const createOperation = {
	operationId: "ves.io.schema.widget.API.Create",
	requestBody: {
		content: {
			"application/json": { schema: { $ref: "#/components/schemas/widgetCreateRequest" } },
		},
	},
};

const spec = {
	paths: {
		"/api/config/namespaces/{metadata.namespace}/widgets": { post: createOperation },
		"/api/config/namespaces/{namespace}/widgets": {
			get: { operationId: "ves.io.schema.widget.API.List" },
		},
	},
	components: {
		schemas: {
			widgetCreateRequest: {
				allOf: [
					{ type: "object", required: ["name"], properties: { name: { type: "string" } } },
					{ type: "object", properties: { enabled: { type: "boolean" } } },
				],
			},
		},
	},
};

describe("API catalog integrity", () => {
	it("normalizes dotted metadata placeholders", () => {
		expect(normalizeApiPath("/namespaces/{metadata.namespace}/widgets/{system_metadata.name}")).toBe(
			"/namespaces/{namespace}/widgets/{name}",
		);
	});

	it("maps normalized paths to unique, lexically sorted categories", () => {
		const mapped = buildPathToCatalogCategories([
			{ name: "zeta", operations: [{ path: "/namespaces/{namespace}/widgets" }] },
			{ name: "alpha", operations: [{ path: "/namespaces/{metadata.namespace}/widgets" }] },
		]);
		expect(mapped.get("/namespaces/{namespace}/widgets")).toEqual(["alpha", "zeta"]);
	});

	it("derives canonical CRUD tuples in stable order", () => {
		expect(
			deriveCanonicalCrudOperations(spec, [
				"/api/config/namespaces/{namespace}/widgets",
				"/api/config/namespaces/{metadata.namespace}/widgets",
			]),
		).toEqual([
			{
				method: "GET",
				path: "/api/config/namespaces/{namespace}/widgets",
				operationId: "ves.io.schema.widget.API.List",
			},
			{
				method: "POST",
				path: "/api/config/namespaces/{namespace}/widgets",
				operationId: "ves.io.schema.widget.API.Create",
			},
		]);
	});

	it("rejects canonical CRUD that is absent from a resource's mapped categories", () => {
		const canonical = deriveCanonicalCrudOperations(spec, ["/api/config/namespaces/{namespace}/widgets"]);
		expect(() =>
			assertCanonicalCrudMapped(
				"test/widget",
				canonical,
				["widgets"],
				[
					{
						name: "widgets",
						operations: [
							{
								operationId: "ves.io.schema.widget.CustomAPI.Action",
								method: "POST",
								path: "/api/config/namespaces/{namespace}/widgets",
							},
						],
					},
				],
			),
		).toThrow("Canonical CRUD operation");
	});

	it("accepts an exact inventory and schema-shaped payload", () => {
		expect(() =>
			assertCatalogIntegrity(
				[
					{
						name: "widgets",
						operations: [
							{
								operationId: "ves.io.schema.widget.API.Create",
								method: "POST",
								path: "/api/config/namespaces/{namespace}/widgets",
								minimumPayload: { json: { name: "example", enabled: true } },
							},
							{
								operationId: "ves.io.schema.widget.API.List",
								method: "GET",
								path: "/api/config/namespaces/{namespace}/widgets",
							},
						],
					},
				],
				[spec],
			),
		).not.toThrow();
	});

	it("rejects inventory loss, duplicates, and undeclared payload properties", () => {
		expect(() => assertCatalogIntegrity([], [spec])).toThrow("inventory differs");
		const operation = {
			operationId: "ves.io.schema.widget.API.Create",
			method: "POST",
			path: "/api/config/namespaces/{namespace}/widgets",
		};
		expect(() =>
			assertCatalogIntegrity(
				[{ name: "widgets", operations: [operation, operation] }],
				[
					{
						paths: { "/api/config/namespaces/{namespace}/widgets": { post: createOperation } },
						components: spec.components,
					},
				],
			),
		).toThrow("duplicate");
		expect(() =>
			assertCatalogIntegrity(
				[
					{
						name: "widgets",
						operations: [{ ...operation, minimumPayload: { json: { metadata: {}, spec: {} } } }],
					},
				],
				[
					{
						paths: { "/api/config/namespaces/{namespace}/widgets": { post: createOperation } },
						components: spec.components,
					},
				],
			),
		).toThrow("property is not declared");
	});
});
