import { describe, expect, it } from "bun:test";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { ApiSpecIndex, OpenAPISpec } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

function parseUrl(value: string): InternalUrl {
	const url = new URL(value) as InternalUrl;
	const match = value.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

const route = {
	type: "array",
	description: "Ordered HTTP routes",
	"x-f5xc-constraints": { minItems: 1, maxItems: 256 },
	items: { type: "object", properties: { path: { type: "string", pattern: "^/" } } },
};
const spec: OpenAPISpec = {
	info: { title: "Virtual", version: "1" },
	paths: {
		"/api/config/namespaces/{namespace}/http_loadbalancers": {
			post: {
				operationId: "ves.io.schema.views.http_loadbalancer.API.Create",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									spec: {
										type: "object",
										required: ["routes"],
										properties: { routes: route, service: { type: "object", properties: { routes: route } } },
									},
								},
							},
						},
					},
				},
			},
		},
	},
};
const index: ApiSpecIndex = {
	version: "6.0.2",
	timestamp: "2026-09-22T00:00:00Z",
	domains: [
		{
			domain: "virtual",
			title: "Virtual",
			description: "Virtual services",
			descriptionShort: "Virtual services",
			category: "Networking",
			pathCount: 1,
			schemaCount: 1,
			complexity: "standard",
			resources: [
				{
					name: "http_loadbalancer",
					description: "HTTP load balancer",
					apiPaths: ["/api/config/namespaces/{namespace}/http_loadbalancers"],
				},
			],
		},
	],
};

describe("API spec field projection", () => {
	it("returns exact bounded metadata for spec.routes", async () => {
		const result = await createApiSpecResolver(index, { virtual: spec }).resolve(
			parseUrl("xcsh://api-spec/virtual?resource=http_loadbalancer&field=spec.routes"),
		);
		expect(result.content).toContain("| spec.routes | array | yes |");
		expect(result.content).toContain("maxItems: 256");
		expect(result.content).toContain("POST /api/config/namespaces/{namespace}/http_loadbalancers");
		expect(result.content).not.toContain("spec.routes[].path");
	});

	it("keeps ambiguous shorthand bounded and provides exact follow-up URLs", async () => {
		const result = await createApiSpecResolver(index, { virtual: spec }).resolve(
			parseUrl("xcsh://api-spec/virtual?resource=http_loadbalancer&field=routes"),
		);
		expect(result.content).toContain("Ambiguous field: routes");
		expect(result.content).toContain("field=spec.routes");
		expect(result.content).toContain("field=spec.service.routes");
		expect(result.content).not.toContain("### Request Body");
		expect(result.content.length).toBeLessThan(2_000);
	});
});
