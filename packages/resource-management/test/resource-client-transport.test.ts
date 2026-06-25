import { describe, expect, test } from "bun:test";
import { ResourceClient } from "../src/resource-client";
import type { HttpTransport, HttpTransportRequest, HttpTransportResponse } from "../src/types";

class MockTransport implements HttpTransport {
	readonly calls: HttpTransportRequest[] = [];
	response: HttpTransportResponse = { httpStatus: 200, body: {} };

	async request(req: HttpTransportRequest): Promise<HttpTransportResponse> {
		this.calls.push(req);
		return this.response;
	}
}

const dummyResolvedKind = {
	kind: "http_loadbalancer",
	domain: "networking",
	resource: { name: "http_loadbalancer", description: "HTTP LB", apiPaths: [] },
	paths: {
		list: "/api/config/namespaces/{namespace}/http_loadbalancers",
		get: "/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
		create: "/api/config/namespaces/{namespace}/http_loadbalancers",
		update: "/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
		delete: "/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
	},
};

describe("ResourceClient with custom transport", () => {
	test("uses injected transport for GET requests", async () => {
		const transport = new MockTransport();
		transport.response = {
			httpStatus: 200,
			body: { items: [{ metadata: { name: "lb-1" }, spec: {} }] },
		};

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
			transport,
		});

		const result = await client.get(dummyResolvedKind);
		expect(result.items).toHaveLength(1);
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].method).toBe("GET");
		expect(transport.calls[0].url).toContain("/http_loadbalancers");
	});

	test("uses injected transport for exportOne", async () => {
		const transport = new MockTransport();
		transport.response = {
			httpStatus: 200,
			body: {
				metadata: { name: "my-lb", namespace: "default" },
				spec: { domains: ["example.com"] },
			},
		};

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
			transport,
		});

		const result = await client.exportOne("http_loadbalancer", dummyResolvedKind, "my-lb");
		expect(result.manifest).toBeDefined();
		expect(result.manifest!.kind).toBe("http_loadbalancer");
		expect(result.manifest!.metadata.name).toBe("my-lb");
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].url).toContain("my-lb");
	});

	test("handles 404 from transport", async () => {
		const transport = new MockTransport();
		transport.response = { httpStatus: 404, body: { message: "Not found" } };

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
			transport,
		});

		const result = await client.exportOne("http_loadbalancer", dummyResolvedKind, "nonexistent");
		expect(result.error).toBeDefined();
		expect(result.error!.kind).toBe("not_found");
	});

	test("handles auth error from transport", async () => {
		const transport = new MockTransport();
		transport.response = { httpStatus: 401, body: { message: "Unauthorized" } };

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "bad-token",
			namespace: "default",
			transport,
		});

		const result = await client.get(dummyResolvedKind, "my-lb");
		expect(result.error).toBeDefined();
		expect(result.error!.kind).toBe("auth");
	});

	test("passes POST body through transport for create", async () => {
		const transport = new MockTransport();
		transport.response = {
			httpStatus: 200,
			body: { metadata: { name: "new-lb" }, spec: {} },
		};

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
			transport,
		});

		const manifest = {
			kind: "http_loadbalancer",
			metadata: { name: "new-lb" },
			spec: { domains: ["new.example.com"] },
			rawObject: {
				kind: "http_loadbalancer",
				metadata: { name: "new-lb" },
				spec: { domains: ["new.example.com"] },
			},
		};

		const result = await client.create(manifest, dummyResolvedKind);
		expect(result.status).toBe("created");
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].method).toBe("POST");
		expect(transport.calls[0].body).toBeDefined();
	});

	test("falls back to FetchTransport when no transport provided", () => {
		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
		});
		// Just verify it constructs without error — actual fetch would hit network
		expect(client).toBeDefined();
	});

	test("apply detects resource as new when GET returns 404", async () => {
		const transport = new MockTransport();
		let callCount = 0;
		transport.request = async _req => {
			callCount++;
			if (callCount === 1) {
				// GET check returns 404
				return { httpStatus: 404, body: { message: "Not found" } };
			}
			// POST create returns success
			return { httpStatus: 200, body: { metadata: { name: "new-lb" }, spec: {} } };
		};

		const client = new ResourceClient({
			apiUrl: "https://test.xcsh.com/api",
			apiToken: "test-token",
			namespace: "default",
			transport,
		});

		const manifest = {
			kind: "http_loadbalancer",
			metadata: { name: "new-lb" },
			spec: {},
			rawObject: { kind: "http_loadbalancer", metadata: { name: "new-lb" }, spec: {} },
		};

		const result = await client.apply(manifest, dummyResolvedKind);
		expect(result.status).toBe("created");
	});
});
