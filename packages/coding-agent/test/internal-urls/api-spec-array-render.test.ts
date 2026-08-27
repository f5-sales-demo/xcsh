import { describe, expect, it } from "bun:test";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { ApiSpecIndex, OpenAPISpec } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

function url(value: string): InternalUrl {
	const parsed = new URL(value) as InternalUrl;
	parsed.rawHost = "api-spec";
	parsed.rawPathname = "/test";
	return parsed;
}

const index = {
	version: "1.0.0",
	timestamp: "2026-08-27T00:00:00Z",
	criticalResources: [],
	domains: [
		{
			domain: "test",
			title: "Test",
			description: "Test schemas",
			descriptionShort: "Test schemas",
			category: "Test",
			pathCount: 1,
			schemaCount: 1,
			complexity: "simple",
			resources: [{ name: "widget", description: "Widget", apiPaths: ["/widgets"] }],
		},
	],
} as ApiSpecIndex;

const spec = {
	info: { title: "Test", version: "1.0.0" },
	paths: {
		"/widgets": {
			post: {
				summary: "Create widget",
				operationId: "widget.API.Create",
				requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Root" } } } },
				responses: {},
			},
		},
	},
	components: {
		schemas: {
			Root: {
				type: "object",
				properties: {
					direct: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
					referenced: { $ref: "#/components/schemas/ReferencedArray" },
					nested: { type: "array", items: { type: "array", items: { $ref: "#/components/schemas/Item" } } },
					choice: { oneOf: [{ $ref: "#/components/schemas/ChoiceA" }, { $ref: "#/components/schemas/ChoiceB" }] },
					status: {
						type: "string",
						description: "Lifecycle state",
						"x-ves-example": "ready",
						"x-f5xc-constraints": { enum: ["ready", "paused"] },
					},
					cycle: { $ref: "#/components/schemas/Cycle" },
					depth: { $ref: "#/components/schemas/DepthOne" },
				},
			},
			ReferencedArray: { type: "array", items: { $ref: "#/components/schemas/Item" } },
			Item: { type: "object", properties: { itemName: { type: "string" } } },
			ChoiceA: { type: "object", properties: { alpha: { type: "string" } } },
			ChoiceB: { type: "object", properties: { beta: { type: "string" } } },
			Cycle: {
				type: "object",
				properties: { label: { type: "string" }, self: { $ref: "#/components/schemas/Cycle" } },
			},
			DepthOne: { type: "object", properties: { two: { $ref: "#/components/schemas/DepthTwo" } } },
			DepthTwo: { type: "object", properties: { three: { $ref: "#/components/schemas/DepthThree" } } },
			DepthThree: { type: "object", properties: { four: { $ref: "#/components/schemas/DepthFour" } } },
			DepthFour: { type: "object", properties: { five: { type: "string" } } },
		},
	},
} as OpenAPISpec;

describe("API specification schema rendering", () => {
	it("renders arrays from raw references with bounded oneOf and cycle traversal", async () => {
		const result = await createApiSpecResolver(index, { test: spec }).resolve(
			url("xcsh://api-spec/test?resource=widget"),
		);
		expect(result.content).toContain("direct[].name");
		expect(result.content).toContain("referenced[].itemName");
		expect(result.content).toContain("nested[][].itemName");
		expect(result.content).toContain("choice.oneOf[0].alpha");
		expect(result.content).toContain("choice.oneOf[1].beta");
		expect(result.content).toContain("enum: ready, paused");
		expect(result.content).toContain("Lifecycle state");
		expect(result.content).toContain("ready");
		expect(result.content).toContain("cycle.label");
		expect(result.content).toContain("depth.two.three.four");
		expect(result.content).not.toContain("depth.two.three.four.five");
		expect(result.content.length).toBeLessThan(20_000);
	});
});
