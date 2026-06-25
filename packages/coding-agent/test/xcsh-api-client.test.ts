import { describe, expect, it } from "bun:test";
import { XCSHApiClient, XCSHApiError } from "@f5xc-salesdemos/xcsh/services/xcsh-api-client";

const TEST_API_URL = "https://test-tenant.console.ves.volterra.io";
const TEST_API_TOKEN = "FAKE-TOKEN-FOR-UNIT-TESTS";

describe("XCSHApiError", () => {
	it("carries kind and status", () => {
		const err = new XCSHApiError("unauthorized", "auth", 401);
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(XCSHApiError);
		expect(err.message).toBe("unauthorized");
		expect(err.name).toBe("XCSHApiError");
		expect(err.kind).toBe("auth");
		expect(err.status).toBe(401);
	});

	it("status is optional", () => {
		const err = new XCSHApiError("timeout", "network");
		expect(err.kind).toBe("network");
		expect(err.status).toBeUndefined();
	});
});

describe("XCSHApiClient", () => {
	describe("URL normalization", () => {
		it("strips trailing slashes from apiUrl", async () => {
			let capturedUrl = "";
			const fetchMock = (async (input: string | URL | Request) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: "https://test.example.io///",
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});
			await client.listNamespaces();
			expect(capturedUrl).toBe("https://test.example.io/api/web/namespaces");
		});
	});

	describe("listNamespaces", () => {
		it("throws auth error on 401 without retrying", async () => {
			let fetchCount = 0;
			const fetchMock = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 3,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				const apiErr = err as XCSHApiError;
				expect(apiErr.kind).toBe("auth");
				expect(apiErr.status).toBe(401);
			}
			expect(fetchCount).toBe(1);
		});

		it("throws auth error on 403 without retrying", async () => {
			let fetchCount = 0;
			const fetchMock = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 3,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				const apiErr = err as XCSHApiError;
				expect(apiErr.kind).toBe("auth");
				expect(apiErr.status).toBe(403);
			}
			expect(fetchCount).toBe(1);
		});

		it("retries on 503 then returns data on success", async () => {
			let fetchCount = 0;
			const fetchMock = (async () => {
				fetchCount++;
				if (fetchCount <= 2) {
					return new Response(JSON.stringify({}), { status: 503 });
				}
				return new Response(JSON.stringify({ items: [{ name: "ns1" }, { name: "ns2" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 3,
				baseDelayMs: 1,
				maxDelayMs: 1,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([{ name: "ns1" }, { name: "ns2" }]);
			expect(fetchCount).toBe(3);
		});

		it("throws server error after exhausting retries on 503", async () => {
			let fetchCount = 0;
			const fetchMock = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({}), { status: 503 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 2,
				baseDelayMs: 1,
				maxDelayMs: 1,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				const apiErr = err as XCSHApiError;
				expect(apiErr.kind).toBe("server");
				expect(apiErr.status).toBe(503);
			}
			expect(fetchCount).toBe(3);
		});

		it("throws network error on fetch timeout", async () => {
			const fetchMock = (async () => {
				const err = new DOMException("The operation was aborted", "AbortError");
				throw err;
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				const apiErr = err as XCSHApiError;
				expect(apiErr.kind).toBe("network");
				expect(apiErr.status).toBeUndefined();
			}
		});

		it("respects Retry-After header on 429", async () => {
			let fetchCount = 0;
			const fetchMock = (async () => {
				fetchCount++;
				if (fetchCount === 1) {
					return new Response(JSON.stringify({}), {
						status: 429,
						headers: { "Retry-After": "1" },
					});
				}
				return new Response(JSON.stringify({ items: [{ name: "ns1" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 1,
				baseDelayMs: 1,
				maxDelayMs: 5000,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([{ name: "ns1" }]);
			expect(fetchCount).toBe(2);
		});

		it("uses the captured fetch even if globalThis.fetch is reassigned mid-request", async () => {
			// Regression for cross-file flakiness: with `bun test --max-concurrency`,
			// another test file can reassign globalThis.fetch while this client is mid-retry.
			// The client must keep using its injected/captured fetch and never read the global.
			const saved = globalThis.fetch;
			let injectedCalls = 0;
			let globalCalls = 0;
			const injected = (async () => {
				injectedCalls++;
				if (injectedCalls === 1) {
					return new Response(JSON.stringify({}), { status: 429, headers: { "Retry-After": "1" } });
				}
				return new Response(JSON.stringify({ items: [{ name: "ns1" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: injected,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 1,
				baseDelayMs: 1,
				maxDelayMs: 1,
			});

			try {
				const pending = client.listNamespaces();
				// Clobber the global the way a concurrently-running test file would.
				globalThis.fetch = (async () => {
					globalCalls++;
					return new Response(JSON.stringify({ items: [{ name: "WRONG" }] }), { status: 200 });
				}) as unknown as typeof globalThis.fetch;
				const result = await pending;
				expect(result).toEqual([{ name: "ns1" }]);
				expect(injectedCalls).toBe(2);
				expect(globalCalls).toBe(0);
			} finally {
				globalThis.fetch = saved;
			}
		});

		it("silently filters items missing name field", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({ items: [{ notName: "x" }, { name: "valid" }, { name: 42 }, null] }), {
					status: 200,
				});
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([{ name: "valid" }]);
		});

		it("returns empty array when response has no items array", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({ something: "else" }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([]);
		});

		it("returns parsed namespaces on 200", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({ items: [{ name: "ns1" }, { name: "ns2" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([{ name: "ns1" }, { name: "ns2" }]);
		});
	});

	describe("getNamespaceStatus", () => {
		it("returns parsed status on 200", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({ name: "production", phase: "Active" }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.getNamespaceStatus("production");
			expect(result).toEqual({ name: "production", phase: "Active" });
		});

		it("throws auth error on 401", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({}), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.getNamespaceStatus("production");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				expect((err as XCSHApiError).kind).toBe("auth");
			}
		});

		it("throws server error when required fields are missing", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({ unrelated: true }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.getNamespaceStatus("production");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				expect((err as XCSHApiError).kind).toBe("server");
			}
		});
	});

	describe("listObjects", () => {
		it("returns parsed objects on 200", async () => {
			let capturedUrl = "";
			const fetchMock = (async (input: string | URL | Request) => {
				capturedUrl = String(input);
				return new Response(
					JSON.stringify({
						items: [
							{ name: "obj1", namespace: "ns1", kind: "http_loadbalancer" },
							{ name: "obj2", namespace: "ns1", kind: "origin_pool" },
						],
					}),
					{ status: 200 },
				);
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listObjects("ns1", "http_loadbalancers");
			expect(result).toEqual([
				{ name: "obj1", namespace: "ns1", kind: "http_loadbalancer" },
				{ name: "obj2", namespace: "ns1", kind: "origin_pool" },
			]);
			expect(capturedUrl).toBe(`${TEST_API_URL}/api/web/namespaces/ns1/http_loadbalancers`);
		});

		it("throws auth error on 401", async () => {
			const fetchMock = (async () => {
				return new Response(JSON.stringify({}), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new XCSHApiClient({
				fetch: fetchMock,
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.listObjects("ns1", "http_loadbalancers");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(XCSHApiError);
				expect((err as XCSHApiError).kind).toBe("auth");
			}
		});
	});
});
