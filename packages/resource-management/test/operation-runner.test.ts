import { describe, expect, test } from "bun:test";
import { createKindResolver } from "../src/kind-resolver";
import { formatResourceOperationReport, runResourceOperation } from "../src/operation-runner";
import { ResourceClient } from "../src/resource-client";
import type {
	ApiSpecIndex,
	HttpTransport,
	HttpTransportRequest,
	HttpTransportResponse,
	ResourceManifest,
} from "../src/types";

class QueueTransport implements HttpTransport {
	readonly calls: HttpTransportRequest[] = [];
	readonly responses: HttpTransportResponse[];

	constructor(responses: HttpTransportResponse[]) {
		this.responses = [...responses];
	}

	async request(req: HttpTransportRequest): Promise<HttpTransportResponse> {
		this.calls.push(req);
		return this.responses.shift() ?? { httpStatus: 500, body: { message: "Missing test response" } };
	}
}

const specIndex: ApiSpecIndex = {
	version: "1",
	timestamp: "2026-08-04T00:00:00Z",
	domains: [
		{
			domain: "networking",
			title: "Networking",
			description: "Networking",
			descriptionShort: "Networking",
			category: "networking",
			pathCount: 2,
			schemaCount: 1,
			complexity: "low",
			resources: [
				{
					name: "http_loadbalancer",
					description: "HTTP load balancer",
					apiPaths: [
						"/api/config/namespaces/{namespace}/http_loadbalancers",
						"/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
					],
				},
			],
		},
	],
};

function manifest(name: string, namespace = "demo"): ResourceManifest {
	const rawObject = { kind: "http_loadbalancer", metadata: { name, namespace }, spec: {} };
	return { kind: "http_loadbalancer", metadata: { name, namespace }, spec: {}, rawObject };
}

describe("runResourceOperation", () => {
	test("prevalidates the whole batch before making mutations", async () => {
		const transport = new QueueTransport([{ httpStatus: 200, body: {} }]);
		const client = new ResourceClient({ apiUrl: "https://example.com", apiToken: "token", namespace: "", transport });
		const invalid = manifest("invalid", "");
		const report = await runResourceOperation({
			operation: "create",
			inputs: [
				{ index: 0, sourcePath: "valid.yaml", manifest: manifest("valid") },
				{ index: 1, sourcePath: "invalid.yaml", manifest: invalid },
			],
			kindResolver: createKindResolver(specIndex),
			client,
		});

		expect(report.success).toBe(false);
		expect(report.results.map(result => result.status)).toEqual(["skipped", "error"]);
		expect(transport.calls).toHaveLength(0);
	});

	test("preserves source order and reports partial API failures", async () => {
		const transport = new QueueTransport([
			{ httpStatus: 200, body: { metadata: { name: "one" }, spec: {} } },
			{ httpStatus: 503, body: { message: "Unavailable" } },
		]);
		const client = new ResourceClient({
			apiUrl: "https://example.com",
			apiToken: "token",
			namespace: "demo",
			transport,
		});
		const report = await runResourceOperation({
			operation: "create",
			inputs: [
				{ index: 0, sourcePath: "one.yaml", manifest: manifest("one") },
				{ index: 1, sourcePath: "two.yaml", manifest: manifest("two") },
			],
			kindResolver: createKindResolver(specIndex),
			client,
		});

		expect(report.success).toBe(false);
		expect(report.results.map(result => result.name)).toEqual(["one", "two"]);
		expect(report.results.map(result => result.status)).toEqual(["created", "error"]);
		expect(report.counts).toEqual({ total: 2, succeeded: 1, failed: 1, created: 1, error: 1 });
	});

	test("validates without a client or API calls", async () => {
		const report = await runResourceOperation({
			operation: "validate",
			inputs: [{ index: 0, sourcePath: "manifest.yaml", manifest: manifest("valid") }],
			kindResolver: createKindResolver(specIndex),
		});

		expect(report.success).toBe(true);
		expect(report.results[0]?.status).toBe("valid");
	});

	test("formats a multi-resource batch as one valid aggregate JSON document", async () => {
		const report = await runResourceOperation({
			operation: "validate",
			inputs: [
				{ index: 0, sourcePath: "one.yaml", manifest: manifest("one") },
				{ index: 1, sourcePath: "two.yaml", manifest: manifest("two") },
			],
			kindResolver: createKindResolver(specIndex),
		});

		const parsed = JSON.parse(formatResourceOperationReport(report, "json")) as { results: unknown[] };
		expect(parsed.results).toHaveLength(2);
	});

	test("gets every resource identified by manifest without mutation", async () => {
		const transport = new QueueTransport([
			{ httpStatus: 200, body: { metadata: { name: "one" }, spec: {} } },
			{ httpStatus: 200, body: { metadata: { name: "two" }, spec: {} } },
		]);
		const client = new ResourceClient({
			apiUrl: "https://example.com",
			apiToken: "token",
			namespace: "demo-app",
			transport,
		});
		const report = await runResourceOperation({
			operation: "get",
			inputs: [
				{ index: 0, sourcePath: "one.yaml", manifest: manifest("one", "demo-app") },
				{ index: 1, sourcePath: "two.yaml", manifest: manifest("two", "shared") },
			],
			kindResolver: createKindResolver(specIndex),
			client,
			namespaceOverride: "system",
		});

		expect(report.success).toBe(true);
		expect(report.results.map(result => result.status)).toEqual(["found", "found"]);
		expect(report.results.map(result => result.name)).toEqual(["one", "two"]);
		expect(transport.calls.map(call => call.method)).toEqual(["GET", "GET"]);
		expect(transport.calls.every(call => call.url.includes("/namespaces/system/"))).toBe(true);
	});

	test("performs delete client dry-run without sending API requests", async () => {
		const transport = new QueueTransport([]);
		const client = new ResourceClient({
			apiUrl: "https://example.com",
			apiToken: "token",
			namespace: "demo",
			transport,
		});
		const report = await runResourceOperation({
			operation: "delete",
			inputs: [{ index: 0, sourcePath: "manifest.yaml", manifest: manifest("example") }],
			kindResolver: createKindResolver(specIndex),
			client,
			dryRun: "client",
		});

		expect(report.success).toBe(true);
		expect(report.results[0]).toMatchObject({ status: "dry-run", action: "delete" });
		expect(transport.calls).toHaveLength(0);
	});
});
