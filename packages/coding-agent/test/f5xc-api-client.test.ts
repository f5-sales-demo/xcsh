import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { F5XCApiClient, F5XCApiError } from "@f5xc-salesdemos/xcsh/services/f5xc-api-client";

const TEST_API_URL = "https://test-tenant.console.ves.volterra.io";
const TEST_API_TOKEN = "FAKE-TOKEN-FOR-UNIT-TESTS";

describe("F5XCApiError", () => {
	it("carries kind and status", () => {
		const err = new F5XCApiError("unauthorized", "auth", 401);
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(F5XCApiError);
		expect(err.message).toBe("unauthorized");
		expect(err.name).toBe("F5XCApiError");
		expect(err.kind).toBe("auth");
		expect(err.status).toBe(401);
	});

	it("status is optional", () => {
		const err = new F5XCApiError("timeout", "network");
		expect(err.kind).toBe("network");
		expect(err.status).toBeUndefined();
	});
});

describe("F5XCApiClient", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("URL normalization", () => {
		it("strips trailing slashes from apiUrl", async () => {
			let capturedUrl = "";
			globalThis.fetch = (async (input: string | URL | Request) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
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
			globalThis.fetch = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 3,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				const apiErr = err as F5XCApiError;
				expect(apiErr.kind).toBe("auth");
				expect(apiErr.status).toBe(401);
			}
			expect(fetchCount).toBe(1);
		});

		it("throws auth error on 403 without retrying", async () => {
			let fetchCount = 0;
			globalThis.fetch = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 3,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				const apiErr = err as F5XCApiError;
				expect(apiErr.kind).toBe("auth");
				expect(apiErr.status).toBe(403);
			}
			expect(fetchCount).toBe(1);
		});

		it("retries on 503 then returns data on success", async () => {
			let fetchCount = 0;
			globalThis.fetch = (async () => {
				fetchCount++;
				if (fetchCount <= 2) {
					return new Response(JSON.stringify({}), { status: 503 });
				}
				return new Response(JSON.stringify({ items: [{ name: "ns1" }, { name: "ns2" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
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
			globalThis.fetch = (async () => {
				fetchCount++;
				return new Response(JSON.stringify({}), { status: 503 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
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
				expect(err).toBeInstanceOf(F5XCApiError);
				const apiErr = err as F5XCApiError;
				expect(apiErr.kind).toBe("server");
				expect(apiErr.status).toBe(503);
			}
			expect(fetchCount).toBe(3);
		});

		it("throws network error on fetch timeout", async () => {
			globalThis.fetch = (async () => {
				const err = new DOMException("The operation was aborted", "AbortError");
				throw err;
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.listNamespaces();
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				const apiErr = err as F5XCApiError;
				expect(apiErr.kind).toBe("network");
				expect(apiErr.status).toBeUndefined();
			}
		});

		it("respects Retry-After header on 429", async () => {
			let fetchCount = 0;
			globalThis.fetch = (async () => {
				fetchCount++;
				if (fetchCount === 1) {
					return new Response(JSON.stringify({}), {
						status: 429,
						headers: { "Retry-After": "1" },
					});
				}
				return new Response(JSON.stringify({ items: [{ name: "ns1" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
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

		it("silently filters items missing name field", async () => {
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [{ notName: "x" }, { name: "valid" }, { name: 42 }, null] }), {
					status: 200,
				});
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([{ name: "valid" }]);
		});

		it("returns empty array when response has no items array", async () => {
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ something: "else" }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.listNamespaces();
			expect(result).toEqual([]);
		});

		it("returns parsed namespaces on 200", async () => {
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ items: [{ name: "ns1" }, { name: "ns2" }] }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
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
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ name: "production", phase: "Active" }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			const result = await client.getNamespaceStatus("production");
			expect(result).toEqual({ name: "production", phase: "Active" });
		});

		it("throws auth error on 401", async () => {
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({}), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.getNamespaceStatus("production");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				expect((err as F5XCApiError).kind).toBe("auth");
			}
		});

		it("throws server error when required fields are missing", async () => {
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ unrelated: true }), { status: 200 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.getNamespaceStatus("production");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				expect((err as F5XCApiError).kind).toBe("server");
			}
		});
	});

	describe("listObjects", () => {
		it("returns parsed objects on 200", async () => {
			let capturedUrl = "";
			globalThis.fetch = (async (input: string | URL | Request) => {
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

			const client = new F5XCApiClient({
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
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({}), { status: 401 });
			}) as unknown as typeof globalThis.fetch;

			const client = new F5XCApiClient({
				apiUrl: TEST_API_URL,
				apiToken: TEST_API_TOKEN,
				maxRetries: 0,
			});

			try {
				await client.listObjects("ns1", "http_loadbalancers");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(F5XCApiError);
				expect((err as F5XCApiError).kind).toBe("auth");
			}
		});
	});
});
