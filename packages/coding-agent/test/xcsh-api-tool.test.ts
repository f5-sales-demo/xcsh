import { describe, expect, it } from "bun:test";
import { XcshApiTool } from "../src/tools/xcsh-api";

function mockSession(bashEnv?: Record<string, string>): any {
	return { settings: { get: (key: string) => (key === "bash.environment" ? (bashEnv ?? {}) : undefined) } };
}

describe("XcshApiTool", () => {
	it("has correct name and label", () => {
		const tool = new XcshApiTool(mockSession());
		expect(tool.name).toBe("xcsh_api");
		expect(tool.label).toBe("API");
	});

	it("rejects when F5XC_API_URL is missing", async () => {
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-1", {
				method: "GET",
				path: "/api/config/namespaces/default/http_loadbalancers",
			});
			expect(result.isError).toBe(true);
			const text = result.content.find(c => c.type === "text")?.text ?? "";
			expect(text).toContain("F5XC_API_URL");
		} finally {
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("rejects when F5XC_API_TOKEN is missing", async () => {
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		delete process.env.F5XC_API_TOKEN;
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-2", {
				method: "GET",
				path: "/api/config/namespaces/default/http_loadbalancers",
			});
			expect(result.isError).toBe(true);
			const text = result.content.find(c => c.type === "text")?.text ?? "";
			expect(text).toContain("F5XC_API_TOKEN");
		} finally {
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("substitutes all path params via params map", async () => {
		let capturedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, _init?: any) => {
			capturedUrl = typeof input === "string" ? input : input.url;
			return new Response(JSON.stringify({ metadata: { name: "test" } }), { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			await tool.execute("call-3", {
				method: "POST",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers",
				params: { namespace: "example-ns" },
				payload: { metadata: { name: "example-lb" } },
			});
			expect(capturedUrl).toBe(
				"https://test.console.ves.volterra.io/api/config/namespaces/example-ns/http_loadbalancers",
			);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("substitutes extra path params like vh_name", async () => {
		let capturedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, _init?: any) => {
			capturedUrl = typeof input === "string" ? input : input.url;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			await tool.execute("call-4", {
				method: "GET",
				path: "/api/config/namespaces/{namespace}/virtual_hosts/{vh_name}/active_staged_signatures",
				params: { namespace: "default", vh_name: "example-vh" },
			});
			expect(capturedUrl).toBe(
				"https://test.console.ves.volterra.io/api/config/namespaces/default/virtual_hosts/example-vh/active_staged_signatures",
			);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("sends body for DELETE when payload is provided", async () => {
		let capturedBody: string | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, init?: any) => {
			capturedBody = init?.body ?? null;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			await tool.execute("call-5", {
				method: "DELETE",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
				params: { namespace: "default", name: "example-lb" },
				payload: { fail_if_referred: true },
			});
			expect(capturedBody).not.toBeNull();
			expect(JSON.parse(capturedBody as unknown as string)).toEqual({ fail_if_referred: true });
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("returns compact JSON (not pretty-printed)", async () => {
		const originalFetch = globalThis.fetch;
		const compactJson = '{"metadata":{"name":"test"},"spec":{"timeout":30}}';
		globalThis.fetch = (async (_input: any, _init?: any) => {
			return new Response(compactJson, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-6", {
				method: "GET",
				path: "/api/config/namespaces/default/healthchecks",
			});
			const text = result.content.find(c => c.type === "text")?.text ?? "";
			expect(text).toContain(compactJson);
			expect(text).not.toContain("  ");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("includes X-Request-ID header and requestId in details", async () => {
		let capturedHeaders: Record<string, string> = {};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, init?: any) => {
			capturedHeaders = init?.headers ?? {};
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-7", {
				method: "GET",
				path: "/api/config/namespaces/default/healthchecks",
			});
			expect(capturedHeaders["X-Request-ID"]).toBeDefined();
			expect(capturedHeaders["X-Request-ID"].length).toBeGreaterThan(0);
			const details = (result as any).details;
			expect(details?.requestId).toBe(capturedHeaders["X-Request-ID"]);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("includes AbortSignal timeout on fetch", async () => {
		let capturedSignal: AbortSignal | undefined;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, init?: any) => {
			capturedSignal = init?.signal;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			await tool.execute("call-8", {
				method: "GET",
				path: "/api/config/namespaces/default/healthchecks",
			});
			expect(capturedSignal).toBeDefined();
			expect(capturedSignal).toBeInstanceOf(AbortSignal);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("auto-resolves {namespace} from bash.environment when not in params", async () => {
		let capturedUrl = "";
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, _init?: any) => {
			capturedUrl = typeof input === "string" ? input : input.url;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession({ F5XC_NAMESPACE: "auto-ns" }));
			await tool.execute("call-9", {
				method: "GET",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers",
			});
			expect(capturedUrl).toContain("auto-ns");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("expands $F5XC_NAMESPACE in payload", async () => {
		let capturedBody: string | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, init?: any) => {
			capturedBody = init?.body ?? null;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession({ F5XC_NAMESPACE: "example-namespace" }));
			await tool.execute("call-10", {
				method: "POST",
				path: "/api/config/namespaces/example-namespace/http_loadbalancers",
				payload: { metadata: { namespace: "$F5XC_NAMESPACE" } },
			});
			expect(capturedBody).not.toBeNull();
			const parsed = JSON.parse(capturedBody as unknown as string);
			expect(parsed.metadata.namespace).toBe("example-namespace");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("includes resolvedPayload in details for POST with payload", async () => {
		let _capturedBody: string | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, init?: any) => {
			_capturedBody = init?.body ?? null;
			return new Response(JSON.stringify({ metadata: { name: "test" } }), { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession({ F5XC_NAMESPACE: "resolved-ns" }));
			const result = await tool.execute("call-resolved", {
				method: "POST",
				path: "/api/config/namespaces/resolved-ns/healthchecks",
				payload: { metadata: { name: "test", namespace: "$F5XC_NAMESPACE" } },
			});
			const details = (result as any).details;
			expect(details?.resolvedPayload).toBeDefined();
			const parsed = JSON.parse(details.resolvedPayload);
			expect(parsed.metadata.namespace).toBe("resolved-ns");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("resolves credentials from bash.environment when process.env is empty", async () => {
		let capturedUrl = "";
		let capturedHeaders: Record<string, string> = {};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: any, init?: any) => {
			capturedUrl = typeof input === "string" ? input : input.url;
			capturedHeaders = init?.headers ?? {};
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;
		try {
			const tool = new XcshApiTool(
				mockSession({
					F5XC_API_URL: "https://context.console.ves.volterra.io",
					F5XC_API_TOKEN: "context-token",
					F5XC_NAMESPACE: "context-ns",
				}),
			);
			await tool.execute("call-ctx", {
				method: "GET",
				path: "/api/config/namespaces/{namespace}/healthchecks",
			});
			expect(capturedUrl).toBe(
				"https://context.console.ves.volterra.io/api/config/namespaces/context-ns/healthchecks",
			);
			expect(capturedHeaders.Authorization).toBe("APIToken context-token");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("returns raw text when server declares JSON but body is unparseable", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, _init?: any) => {
			return new Response("not-valid-json", {
				status: 200,
				statusText: "OK",
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-json-fallback", {
				method: "GET",
				path: "/api/config/namespaces/default/healthchecks",
			});
			const text = result.content.find(c => c.type === "text")?.text ?? "";
			// Should fall back to raw text, not throw into catch block
			expect(text).toContain("200 OK");
			expect(text).toContain("not-valid-json");
			// Should NOT be an error — HTTP 200 with unparseable body is still a success
			expect(result.isError).toBeUndefined();
			// Details should be preserved (requestId, status)
			const details = (result as any).details;
			expect(details?.status).toBe(200);
			expect(details?.requestId).toBeDefined();
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});

	it("includes requestId in network error details", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: any, _init?: any) => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		process.env.F5XC_API_URL = "https://test.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "test-token";
		try {
			const tool = new XcshApiTool(mockSession());
			const result = await tool.execute("call-net-err", {
				method: "GET",
				path: "/api/config/namespaces/default/healthchecks",
			});
			expect(result.isError).toBe(true);
			const text = result.content.find(c => c.type === "text")?.text ?? "";
			expect(text).toContain("Failed to fetch");
			// requestId should be present in details even on network error
			const details = (result as any).details;
			expect(details).toBeDefined();
			expect(details?.requestId).toBeDefined();
			expect(details?.status).toBe(0);
			expect(details?.method).toBe("GET");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalUrl) process.env.F5XC_API_URL = originalUrl;
			else delete process.env.F5XC_API_URL;
			if (originalToken) process.env.F5XC_API_TOKEN = originalToken;
			else delete process.env.F5XC_API_TOKEN;
		}
	});
});
