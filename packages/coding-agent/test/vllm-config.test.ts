import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "yaml";
import { probeVllmConnection, readVllmConfig, writeVllmModelsConfig } from "../src/config/vllm-config";

describe("probeVllmConnection", () => {
	it("returns unique model IDs and sends auth only when configured", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(input), init });
			return Response.json({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-b" }] });
		}) as typeof fetch;

		const authenticated = await probeVllmConnection("https://vllm.example.com/v1/", "secret", {
			fetch: fakeFetch,
		});
		const unauthenticated = await probeVllmConnection("http://127.0.0.1:8000/v1", "", {
			fetch: fakeFetch,
		});

		expect(authenticated.models).toEqual(["model-b", "model-a"]);
		expect(unauthenticated.models).toEqual(["model-b", "model-a"]);
		expect(requests[0]?.url).toBe("https://vllm.example.com/v1/models");
		expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer secret");
		expect(new Headers(requests[1]?.init?.headers).has("Authorization")).toBe(false);
	});

	it("distinguishes network, timeout, authentication, HTTP, malformed, and empty failures", async () => {
		const cases: Array<{ response: () => Promise<Response>; message: string }> = [
			{ response: async () => Promise.reject(new TypeError("fetch failed")), message: "connect" },
			{
				response: async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
				message: "timed out",
			},
			{ response: async () => new Response("unauthorized", { status: 401 }), message: "API key" },
			{ response: async () => new Response("forbidden", { status: 403 }), message: "API key" },
			{ response: async () => new Response("bad gateway", { status: 502 }), message: "HTTP 502" },
			{ response: async () => new Response("{", { status: 200 }), message: "valid JSON" },
			{ response: async () => Response.json({ data: {} }), message: "malformed" },
			{ response: async () => Response.json({ data: [] }), message: "no models" },
		];

		for (const testCase of cases) {
			await expect(
				probeVllmConnection("http://127.0.0.1:8000/v1", "", {
					fetch: testCase.response as unknown as typeof fetch,
				}),
			).rejects.toThrow(testCase.message);
		}
	});
});

describe("vLLM models.yml persistence", () => {
	let tempDir: string;
	let modelsPath: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-vllm-config-"));
		modelsPath = path.join(tempDir, "agent", "models.yml");
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates a keyless discoverable vLLM provider with owner-only permissions", async () => {
		await writeVllmModelsConfig(modelsPath, "http://127.0.0.1:8000/v1", { authenticated: false });

		const parsed = parse(fs.readFileSync(modelsPath, "utf8")) as Record<string, any>;
		expect(parsed.providers.vllm).toEqual({
			baseUrl: "http://127.0.0.1:8000/v1",
			api: "openai-completions",
			auth: "none",
			discovery: { type: "openai-compat" },
		});
		expect(fs.statSync(path.dirname(modelsPath)).mode & 0o777).toBe(0o700);
		expect(fs.statSync(modelsPath).mode & 0o777).toBe(0o600);
	});

	it("preserves comments and unrelated providers while updating vLLM", async () => {
		fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
		fs.writeFileSync(
			modelsPath,
			[
				"# keep this header",
				"providers:",
				"  # keep this provider",
				"  custom:",
				"    baseUrl: https://custom.example.com/v1",
				"    apiKey: CUSTOM_API_KEY",
				"  vllm:",
				"    baseUrl: http://old.example.com/v1",
				"    auth: none",
				"",
			].join("\n"),
		);

		await writeVllmModelsConfig(modelsPath, "https://new.example.com/v1", { authenticated: true });

		const content = fs.readFileSync(modelsPath, "utf8");
		const parsed = parse(content) as Record<string, any>;
		expect(content).toContain("# keep this header");
		expect(content).toContain("# keep this provider");
		expect(parsed.providers.custom).toEqual({
			baseUrl: "https://custom.example.com/v1",
			apiKey: "CUSTOM_API_KEY",
		});
		expect(parsed.providers.vllm.baseUrl).toBe("https://new.example.com/v1");
		expect(parsed.providers.vllm.auth).toBeUndefined();
		expect(parsed.providers.vllm.apiKey).toBeUndefined();
		expect(readVllmConfig(modelsPath)).toEqual({ baseUrl: "https://new.example.com/v1" });
	});

	it("refuses malformed or non-map YAML without overwriting it", async () => {
		fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
		for (const original of ["providers: [\n", "- not\n- a\n- map\n"]) {
			fs.writeFileSync(modelsPath, original);
			await expect(
				writeVllmModelsConfig(modelsPath, "http://127.0.0.1:8000/v1", { authenticated: false }),
			).rejects.toThrow();
			expect(fs.readFileSync(modelsPath, "utf8")).toBe(original);
		}
	});
});
