import OPERATION_MODELS from "./operation-models.json" with { type: "json" };
import { classify as classifyCloudflare } from "./providers/cloudflare-workers-ai-system-one";
import { classify as classifyLlama } from "./providers/llama-cpp-classify";
import { generateImages as generateOpenRouterImages } from "./providers/openrouter-images";
import { classify as classifySystemOne } from "./providers/typesafe-system-one";
import { getEnvApiKey } from "./stream";
import type {
	AnyModel,
	AssistantImages,
	ClassifierContext,
	ClassifierModel,
	ClassifierOptions,
	ClassifierResult,
	ImageModel,
	ImagesContext,
	ImagesOptions,
} from "./types";

const catalog = OPERATION_MODELS as AnyModel[];
export function getBundledImageModels(provider: string): ImageModel[] {
	return catalog.filter((model): model is ImageModel => model.type === "image" && model.provider === provider);
}
export function getBundledClassifierModels(provider: string): ClassifierModel[] {
	return catalog.filter(
		(model): model is ClassifierModel => model.type === "classifier" && model.provider === provider,
	);
}
export function getBundledImageModel(provider: string, id: string): ImageModel | undefined {
	return getBundledImageModels(provider).find(model => model.id === id);
}
export function getBundledClassifierModel(provider: string, id: string): ClassifierModel | undefined {
	return getBundledClassifierModels(provider).find(model => model.id === id);
}
export async function generateImages(
	model: ImageModel,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<AssistantImages> {
	if (model.type !== "image") throw new Error("generateImages requires an image model");
	if (model.api !== "openrouter-images") throw new Error(`Unsupported image API: ${model.api}`);
	return generateOpenRouterImages(model, context, {
		...options,
		apiKey: options?.apiKey ?? getEnvApiKey(model.provider),
	});
}
export async function classify(
	model: ClassifierModel,
	context: ClassifierContext,
	options?: ClassifierOptions,
): Promise<ClassifierResult> {
	if (model.type !== "classifier") throw new Error("classify requires a classifier model");
	if (model.provider === "cloudflare-workers-ai" && /\{(?:account|CLOUDFLARE_ACCOUNT_ID)\}/.test(model.baseUrl)) {
		const account = options?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
		if (!account) throw new Error("Cloudflare classifier requires accountId");
		model = {
			...model,
			baseUrl: model.baseUrl.replace(/\{(?:account|CLOUDFLARE_ACCOUNT_ID)\}/g, encodeURIComponent(account)),
		};
	}
	const resolved = { ...options, apiKey: options?.apiKey ?? getEnvApiKey(model.provider) };
	switch (model.api) {
		case "typesafe-system-one":
			return classifySystemOne(model, context, resolved);
		case "cloudflare-workers-ai-system-one":
			return classifyCloudflare(model, context, resolved);
		case "llama-cpp-classify":
			return classifyLlama(model, context, resolved);
		default:
			throw new Error(`Unsupported classifier API: ${model.api}`);
	}
}
