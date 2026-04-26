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
			globalThis.fetch = (async (input: RequestInfo | URL) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}) as typeof globalThis.fetch;

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
			}) as typeof globalThis.fetch;

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
			}) as typeof globalThis.fetch;

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
			}) as typeof globalThis.fetch;

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
			}) as typeof globalThis.fetch;

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
			expect(fetchCount).toBe(3); // 1 initial + 2 retries
		});

		it("throws network error on fetch timeout", async () => {
			globalThis.fetch = (async () => {
				const err = new DOMException("The operation was aborted", "AbortError");
				throw err;
			}) as typeof globalThis.fetch;

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
	});
});
