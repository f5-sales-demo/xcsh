import { describe, expect, it } from "bun:test";
import { classify, generateImages, getBundledClassifierModels, getBundledImageModels } from "../src/operations";
import { stream } from "../src/stream";
import type { ClassifierModel, ImageModel, Model } from "../src/types";

const classifier: ClassifierModel = {
	id: "jev",
	name: "Jev",
	provider: "typesafe",
	api: "typesafe-system-one",
	type: "classifier",
	baseUrl: "https://classify.example.com/v1",
	input: ["text"],
	contextWindow: 32000,
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
};
const image: ImageModel = {
	...classifier,
	id: "image",
	api: "openrouter-images",
	provider: "openrouter",
	type: "image",
	output: ["image", "text"],
};
const context = {
	state: { synthetic: true },
	questions: {
		safe: { type: "bool" as const, instructions: "Is synthetic?", criteria: { true: "Synthetic", false: "Real" } },
	},
};

describe("operation-specific interfaces", () => {
	it("validates operation before any transport", async () => {
		expect(() => stream(image as unknown as Model, { messages: [] })).toThrow("chat");
		await expect(generateImages(classifier as unknown as ImageModel, { input: [] })).rejects.toThrow("image");
		await expect(classify(image as unknown as ClassifierModel, context)).rejects.toThrow("classifier");
	});
	it("exposes image and classifier catalogs separately", () => {
		expect(getBundledImageModels("openrouter").length).toBeGreaterThan(0);
		for (const provider of ["typesafe", "openrouter", "cloudflare-workers-ai"])
			expect(getBundledClassifierModels(provider).length).toBeGreaterThan(0);
	});
	it("transports typed System One bool and usage with authentication", async () => {
		let sent: any;
		const result = await classify(classifier, context, {
			apiKey: "synthetic",
			fetch: async (_url, init) => {
				sent = JSON.parse(String(init?.body));
				return Response.json({
					answers: { safe: { type: "noul", noul: 0.9 } },
					usage: { input_tokens: 10, output_tokens: 1 },
				});
			},
		});
		expect(sent.questions.safe.type).toBe("noul");
		expect(result.answers.safe).toEqual({ type: "bool", probability: 0.9 });
		expect(result.usage?.input).toBe(10);
	});
	it("fails missing auth, malformed answers and aborts without fabricating results", async () => {
		expect((await classify(classifier, context)).stopReason).toBe("error");
		expect(
			(
				await classify(classifier, context, {
					apiKey: "synthetic",
					fetch: async () => Response.json({ answers: {} }),
				})
			).stopReason,
		).toBe("error");
		expect(
			(
				await classify(classifier, context, {
					apiKey: "synthetic",
					signal: AbortSignal.abort(),
					fetch: async () => {
						throw new DOMException("Aborted", "AbortError");
					},
				})
			).stopReason,
		).toBe("aborted");
	});
	it("returns OpenRouter image content with its text and rejects missing images", async () => {
		const result = await generateImages(
			image,
			{ input: [{ type: "text", text: "Synthetic square" }] },
			{
				apiKey: "synthetic",
				fetch: async () =>
					Response.json({
						id: "synthetic",
						choices: [
							{
								message: {
									content: "Square",
									images: [{ image_url: { url: "data:image/png;base64,aGVsbG8=" } }],
								},
							},
						],
					}),
			},
		);
		expect(result.output.map(item => item.type)).toEqual(["text", "image"]);
		expect(
			(
				await generateImages(
					image,
					{ input: [] },
					{ apiKey: "synthetic", fetch: async () => Response.json({ choices: [] }) },
				)
			).stopReason,
		).toBe("error");
	});
});
