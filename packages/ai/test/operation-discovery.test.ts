import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperationCatalog } from "../src/operation-catalog";

describe("operation catalog discovery", () => {
	it("maps Vercel evaluation entries to its native System One endpoint", async () => {
		const catalog = createOperationCatalog({
			fetch: async () =>
				Response.json({
					data: [
						{
							id: "typesafe-ai/jev",
							name: "Jev",
							type: "evaluation",
							pricing: { input: "0.000000042", output: "0" },
							context_window: 32000,
						},
					],
				}),
		});
		await catalog.refresh("vercel-ai-gateway");
		expect(catalog.getClassifierModels("vercel-ai-gateway")).toMatchObject([
			{ api: "typesafe-system-one", baseUrl: "https://ai-gateway.vercel.sh/typesafe/v1", cost: { input: 0.042 } },
		]);
	});
	it("persists successful operation catalogs and restores them across restart", async () => {
		const cacheDbPath = join(mkdtempSync(join(tmpdir(), "synthetic-operation-cache-")), "models.db");
		const catalog = createOperationCatalog({
			cacheDbPath,
			fetch: async () =>
				Response.json({
					data: [{ id: "synthetic-durable", name: "Durable", architecture: { output_modalities: ["image"] } }],
				}),
		});
		await catalog.refresh("openrouter");
		const restarted = createOperationCatalog({ cacheDbPath });
		expect(restarted.getImageModels("openrouter")).toMatchObject([{ id: "synthetic-durable" }]);
	});
	it("loads distinct OpenRouter operation listings with prices and route prefixes", async () => {
		const urls: string[] = [];
		const catalog = createOperationCatalog({
			fetch: async url => {
				urls.push(String(url));
				const image = String(url).includes("=image");
				return Response.json({
					data: [
						{
							id: "synthetic/model",
							name: "Synthetic",
							architecture: {
								input_modalities: ["text", "image"],
								output_modalities: [image ? "image" : "decisions", "text"],
							},
							context_length: 12345,
							pricing: {
								prompt: "0.000002",
								completion: "0.00001",
								input_cache_read: "0.0000001",
								input_cache_write: "0.0000025",
							},
						},
					],
				});
			},
		});
		await catalog.refresh("openrouter", { baseUrl: "https://gateway.example.com/prefix/v1" });
		expect(urls.sort()).toEqual([
			"https://gateway.example.com/prefix/v1/models?output_modalities=decisions",
			"https://gateway.example.com/prefix/v1/models?output_modalities=image",
		]);
		expect(catalog.getImageModels("openrouter")).toMatchObject([
			{
				type: "image",
				id: "synthetic/model",
				baseUrl: "https://gateway.example.com/prefix/v1",
				cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
			},
		]);
		expect(catalog.getClassifierModels("openrouter")).toMatchObject([
			{ type: "classifier", id: "synthetic/model", contextWindow: 12345 },
		]);
	});
	it("does not publish aborted or failed refreshes and fences superseded work", async () => {
		const pending = Promise.withResolvers<Awaited<ReturnType<typeof fetch>>>();
		let calls = 0;
		const catalog = createOperationCatalog({
			fetch: async () =>
				++calls <= 2 ? pending.promise.then(response => response.clone() as Response) : Response.json({ data: [] }),
		});
		const first = catalog.refresh("openrouter");
		await catalog.refresh("openrouter");
		pending.resolve(
			Response.json({ data: [{ id: "stale", name: "Stale", architecture: { output_modalities: ["image"] } }] }),
		);
		await first;
		expect(catalog.getImageModels("openrouter")).toEqual([]);
		await expect(catalog.refresh("openrouter", { signal: AbortSignal.abort() })).rejects.toThrow();
	});
	it("loads TypeSafe metadata and exposes explicit llama.cpp classifier models", async () => {
		const catalog = createOperationCatalog({
			fetch: async () =>
				Response.json({
					"typesafe/jev-latest": { type: "decision", name: "Jev current", limit: { context: 64000 } },
				}),
		});
		await catalog.refresh("typesafe");
		expect(catalog.getClassifierModels("typesafe")).toMatchObject([
			{ id: "jev-latest", name: "Jev current", contextWindow: 64000 },
		]);
		await catalog.refresh("llama.cpp", { baseUrl: "http://127.0.0.1:8080", modelIds: ["synthetic"] });
		expect(catalog.getClassifierModels("llama.cpp")).toMatchObject([
			{ id: "synthetic", api: "llama-cpp-classify", baseUrl: "http://127.0.0.1:8080" },
		]);
	});
});
