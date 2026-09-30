import type { AnyModel, ClassifierModel, ImageModel, ModelCost, OperationOptions } from "../../types";

export interface OperationDiscoveryOptions extends OperationOptions {
	baseUrl?: string;
	modelIds?: readonly string[];
}

const zeroCost = (): ModelCost => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const modalities = (value: unknown): ("text" | "image")[] => {
	const values = Array.isArray(value) ? value.filter(item => item === "text" || item === "image") : [];
	return values.length ? [...new Set(values)] : ["text"];
};
const positive = (value: unknown, fallback: number) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
const rate = (value: unknown) => {
	const parsed = Number(value ?? 0);
	if (parsed === -1) return 0;
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Malformed operation pricing");
	return Number((parsed * 1_000_000).toFixed(6));
};

export async function discoverOperationModels(
	provider: string,
	options: OperationDiscoveryOptions = {},
): Promise<(ImageModel | ClassifierModel)[]> {
	options.signal?.throwIfAborted();
	const request = async (url: string): Promise<any> => {
		const response = await (options.fetch ?? globalThis.fetch)(url, {
			signal: options.signal,
			headers: {
				Accept: "application/json",
				...options.headers,
				...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
			},
		});
		if (!response.ok) throw new Error(`${provider} operation discovery HTTP ${response.status}`);
		const body = await response.json();
		options.signal?.throwIfAborted();
		return body;
	};
	if (provider === "openrouter") {
		const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
		const results = await Promise.all(
			["image", "decisions"].map(async operation => {
				const body = await request(`${baseUrl}/models?output_modalities=${operation}`);
				if (!Array.isArray(body?.data)) throw new Error("Malformed OpenRouter operation catalog");
				return body.data.flatMap((entry: any): (ImageModel | ClassifierModel)[] => {
					if (typeof entry?.id !== "string" || !entry.id) throw new Error("Malformed operation model identifier");
					if (!entry.architecture?.output_modalities?.includes(operation)) return [];
					const common = {
						id: entry.id,
						name: typeof entry.name === "string" ? entry.name : entry.id,
						provider,
						baseUrl,
						input: modalities(entry.architecture.input_modalities),
						cost: {
							...(Object.values(entry.pricing ?? {}).includes("-1") ? { pricingKnown: false } : {}),
							input: rate(entry.pricing?.prompt),
							output: rate(entry.pricing?.completion),
							cacheRead: rate(entry.pricing?.input_cache_read),
							cacheWrite: rate(entry.pricing?.input_cache_write),
						},
					};
					return operation === "image"
						? [
								{
									...common,
									type: "image",
									api: "openrouter-images",
									output: modalities(entry.architecture.output_modalities),
								},
							]
						: [
								{
									...common,
									type: "classifier",
									api: "typesafe-system-one",
									contextWindow: positive(entry.top_provider?.context_length ?? entry.context_length, 4096),
								},
							];
				});
			}),
		);
		return deduplicateOperationModels(results.flat());
	}
	if (provider === "typesafe") {
		const body = await request("https://models.dev/models.json?type=decision");
		const entry = body?.["typesafe/jev-latest"];
		if (entry?.type !== "decision" || typeof entry.name !== "string")
			throw new Error("Malformed TypeSafe operation catalog");
		return [
			{
				type: "classifier",
				id: "jev-latest",
				name: entry.name,
				api: "typesafe-system-one",
				provider,
				baseUrl: options.baseUrl ?? "https://api.typesafe.ai/v1",
				input: modalities(entry.modalities?.input),
				contextWindow: positive(entry.limit?.context, 64000),
				cost: zeroCost(),
			},
		];
	}
	if (provider === "vercel-ai-gateway") {
		const body = await request(`${options.baseUrl ?? "https://ai-gateway.vercel.sh/v1"}/models`);
		if (!Array.isArray(body?.data)) throw new Error("Malformed Vercel operation catalog");
		return body.data
			.filter((entry: any) => entry.type === "evaluation")
			.map((entry: any) => ({
				type: "classifier",
				id: entry.id,
				name: entry.name ?? entry.id,
				api: "typesafe-system-one",
				provider,
				baseUrl: "https://ai-gateway.vercel.sh/typesafe/v1",
				input: ["text"],
				contextWindow: positive(entry.context_window, 4096),
				cost: {
					input: rate(entry.pricing?.input),
					output: rate(entry.pricing?.output),
					cacheRead: 0,
					cacheWrite: 0,
				},
			}));
	}
	if (provider === "llama.cpp") {
		if (!options.baseUrl) throw new Error("llama.cpp discovery requires baseUrl");
		return (options.modelIds ?? []).map(id => ({
			type: "classifier",
			id,
			name: id,
			api: "llama-cpp-classify",
			provider,
			baseUrl: options.baseUrl!,
			input: ["text"],
			contextWindow: 32000,
			cost: zeroCost(),
		}));
	}
	return [];
}

export function deduplicateOperationModels<T extends AnyModel>(models: readonly T[]): T[] {
	return [
		...new Map(
			models.map(model => [JSON.stringify([model.provider, model.type ?? "chat", model.id]), model]),
		).values(),
	];
}
