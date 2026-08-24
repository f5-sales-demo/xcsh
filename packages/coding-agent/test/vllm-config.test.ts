import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "yaml";
import {
	normalizeVllmBaseUrl,
	probeVllmConnection,
	readVllmConfig,
	writeVllmModelsConfig,
} from "../src/config/vllm-config";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

function serveModels(handler: (request: Request) => Response | Promise<Response>): string {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
	servers.push(server);
	return `http://127.0.0.1:${server.port}/v1`;
}

describe("vLLM endpoint and model discovery", () => {
	it("normalizes HTTP(S) endpoints and rejects unsafe URL forms", () => {
		expect(normalizeVllmBaseUrl(" http://127.0.0.1:8000/v1/// ")).toBe("http://127.0.0.1:8000/v1");
		expect(normalizeVllmBaseUrl("https://vllm.example.com/v1/")).toBe("https://vllm.example.com/v1");
		for (const invalid of [
			"not-a-url",
			"file:///tmp/vllm.sock",
			"https://user:pass@vllm.example.com/v1",
			"https://vllm.example.com/v1?token=secret",
			"https://vllm.example.com/v1#fragment",
		]) {
			expect(() => normalizeVllmBaseUrl(invalid)).toThrow();
		}
	});

	it("uses /v1/models without Authorization for a keyless endpoint and parses context metadata", async () => {
		let observedPath = "";
		let observedAuthorization: string | null = "unseen";
		const baseUrl = serveModels(request => {
			observedPath = new URL(request.url).pathname;
			observedAuthorization = request.headers.get("authorization");
			return Response.json({
				object: "list",
				data: [
					{ id: "local-tool-model", object: "model", max_model_len: 32_768 },
					{ id: "compact-model", object: "model", context_length: "4096" },
				],
			});
		});

		const result = await probeVllmConnection(baseUrl, "");

		expect(observedPath).toBe("/v1/models");
		expect(observedAuthorization).toBeNull();
		expect(result.models).toEqual([
			{ id: "local-tool-model", contextWindow: 32_768 },
			{ id: "compact-model", contextWindow: 4096 },
		]);
	});

	it("sends a bearer key only for an authenticated endpoint", async () => {
		const observedAuthorization: Array<string | null> = [];
		const baseUrl = serveModels(request => {
			observedAuthorization.push(request.headers.get("authorization"));
			return Response.json({ data: [{ id: "remote-model", max_context_length: 65_536 }] });
		});

		await probeVllmConnection(baseUrl, "secret-key");

		expect(observedAuthorization).toEqual(["Bearer secret-key"]);
	});

	it("deduplicates model IDs, preserves absent metadata, and rejects malformed catalogs", async () => {
		const goodBaseUrl = serveModels(() =>
			Response.json({ data: [{ id: "model-b" }, { id: "model-a", context_window: 8192 }, { id: "model-b" }] }),
		);
		expect((await probeVllmConnection(goodBaseUrl, "")).models).toEqual([
			{ id: "model-b" },
			{ id: "model-a", contextWindow: 8192 },
		]);

		for (const payload of [{}, { data: {} }, { data: [] }, { data: [{ id: 7 }] }]) {
			await expect(
				probeVllmConnection("http://127.0.0.1:8000/v1", "", {
					fetch: async () => Response.json(payload),
				}),
			).rejects.toThrow(/malformed|no models/);
		}
	});

	it("distinguishes timeout, network, authentication, HTTP, and invalid JSON failures", async () => {
		const cases: Array<{ response: () => Promise<Response>; message: RegExp }> = [
			{ response: async () => Promise.reject(new TypeError("fetch failed")), message: /Could not connect/ },
			{
				response: async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
				message: /timed out/,
			},
			{ response: async () => new Response("unauthorized", { status: 401 }), message: /API key/ },
			{ response: async () => new Response("forbidden", { status: 403 }), message: /API key/ },
			{ response: async () => new Response("bad gateway", { status: 502 }), message: /HTTP 502/ },
			{ response: async () => new Response("{", { status: 200 }), message: /valid JSON/ },
		];
		for (const testCase of cases) {
			await expect(
				probeVllmConnection("http://127.0.0.1:8000/v1", "", {
					fetch: testCase.response,
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

	it("creates a keyless discoverable provider with owner-only permissions", async () => {
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

	it("preserves comments and unrelated providers while removing YAML credentials", async () => {
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
				"    apiKey: stale-secret",
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
		expect(content).not.toContain("stale-secret");
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
