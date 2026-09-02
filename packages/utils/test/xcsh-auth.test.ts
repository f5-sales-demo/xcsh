import { describe, expect, it } from "bun:test";
import {
	buildXcshAuthHeaders,
	normalizeXcshApiUrlInput,
	normalizeXcshCredentialInput,
	validateXcshApiCredentials,
} from "../src/xcsh-auth";
import { XCSH_API_TOKEN, XCSH_CONSOLE_PASSWORD } from "../src/xcsh-env-names";

describe("normalizeXcshCredentialInput", () => {
	it.each([
		["raw=token=", XCSH_API_TOKEN, "raw=token="],
		["XCSH_API_TOKEN=raw=token=", XCSH_API_TOKEN, "raw=token="],
		["export XCSH_API_TOKEN='quoted='", XCSH_API_TOKEN, "quoted="],
		["# XCSH_CONSOLE_PASSWORD=secret", XCSH_CONSOLE_PASSWORD, "secret"],
	])("normalizes %s", (input, key, expected) => {
		expect(normalizeXcshCredentialInput(input, key)).toBe(expected);
	});

	it.each([
		["XCSH_API_URL=https://wrong.example", XCSH_API_TOKEN],
		["export XCSH_API_URL=https://wrong.example", XCSH_API_TOKEN],
		["XCSH_API_TOKEN", XCSH_API_TOKEN],
		['XCSH_API_TOKEN="unterminated', XCSH_API_TOKEN],
		["one\ntwo", XCSH_API_TOKEN],
	])("rejects malformed or wrong-key input %s", (input, key) => {
		expect(normalizeXcshCredentialInput(input, key)).toBeNull();
	});
});

it("normalizes API URLs and builds APIToken headers", () => {
	expect(normalizeXcshApiUrlInput("XCSH_API_URL=https://tenant.example.test/web?q=1")).toBe(
		"https://tenant.example.test",
	);
	expect(normalizeXcshApiUrlInput("not a url")).toBeNull();
	expect(buildXcshAuthHeaders("opaque=")).toEqual({ Authorization: "APIToken opaque=", Accept: "application/json" });
});

describe("validateXcshApiCredentials", () => {
	const run = (response: Response | Promise<Response>) =>
		validateXcshApiCredentials({
			apiUrl: "https://tenant.example.test/path",
			apiToken: "secret=",
			fetch: (async (url, init) => {
				expect(url).toBe("https://tenant.example.test/api/web/namespaces");
				expect(init?.headers).toEqual({ Authorization: "APIToken secret=", Accept: "application/json" });
				expect(init?.redirect).toBe("manual");
				return response;
			}) as typeof fetch,
		});

	it("parses and sorts namespace names", async () => {
		const result = await run(
			new Response(JSON.stringify({ items: [{ name: "system" }, { name: "default" }] }), {
				status: 200,
				headers: { "content-type": "application/json; charset=utf-8" },
			}),
		);
		expect(result).toMatchObject({ status: "connected", httpStatus: 200, namespaces: ["default", "system"] });
	});

	it.each([
		[401, "auth_error", "unauthorized"],
		[403, "auth_error", "forbidden"],
		[302, "offline", "redirect"],
		[429, "offline", "rate_limited"],
		[500, "offline", "server"],
		[418, "offline", "network"],
	] as const)("classifies HTTP %d", async (status, expectedStatus, failureReason) => {
		const result = await run(new Response("safe", { status, headers: { location: "https://elsewhere.test" } }));
		expect(result).toMatchObject({ status: expectedStatus, httpStatus: status, failureReason });
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(JSON.stringify(result)).not.toContain("tenant");
	});

	it("classifies non-JSON content and malformed JSON", async () => {
		expect(await run(new Response("html", { status: 200, headers: { "content-type": "text/html" } }))).toMatchObject({
			failureReason: "non_json",
		});
		expect(
			await run(new Response("{", { status: 200, headers: { "content-type": "application/json" } })),
		).toMatchObject({
			failureReason: "non_json",
		});
	});

	it("classifies network failures", async () => {
		const result = await validateXcshApiCredentials({
			apiUrl: "https://tenant.example.test",
			apiToken: "secret",
			fetch: (() => Promise.reject(new Error("network contains secret"))) as unknown as typeof fetch,
		});
		expect(result.failureReason).toBe("network");
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("times out an in-flight request", async () => {
		const result = await validateXcshApiCredentials({
			apiUrl: "https://tenant.example.test",
			apiToken: "secret",
			timeoutMs: 1,
			fetch: ((_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				})) as typeof fetch,
		});
		expect(result.failureReason).toBe("timeout");
	});
});
