import { describe, expect, it } from "bun:test";
import { XcshApiTool } from "../src/tools/xcsh-api";

describe("XcshApiTool", () => {
	const mockSession = {} as any;

	it("has correct name and label", () => {
		const tool = new XcshApiTool(mockSession);
		expect(tool.name).toBe("xcsh_api");
		expect(tool.label).toBe("API");
	});

	it("rejects when F5XC_API_URL is missing", async () => {
		const originalUrl = process.env.F5XC_API_URL;
		const originalToken = process.env.F5XC_API_TOKEN;
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;
		try {
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
			const tool = new XcshApiTool(mockSession);
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
});
