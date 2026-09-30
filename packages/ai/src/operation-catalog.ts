import { cancelDeferred, type DeferredRequestOptions, fetchDeferred, requestDeferred } from "./deferred";
import { readOperationModelCache, writeOperationModelCache } from "./model-cache";
import { type GeneratedProvider, getBundledModels } from "./models";
import { classify, generateImages, getBundledClassifierModels, getBundledImageModels } from "./operations";
import type {
	AnyModel,
	ClassifierContext,
	ClassifierModel,
	ClassifierOptions,
	ImageModel,
	ImagesContext,
	ImagesOptions,
	Model,
} from "./types";
import {
	deduplicateOperationModels,
	discoverOperationModels,
	type OperationDiscoveryOptions,
} from "./utils/discovery/operations";
export interface OperationCatalogOptions {
	cacheDbPath?: string;
	fetch?: OperationDiscoveryOptions["fetch"];
	models?: readonly AnyModel[];
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
}
export function createOperationCatalog(options: OperationCatalogOptions = {}) {
	const models = options.models ?? [];
	const discovered = new Map<string, AnyModel[]>();
	const revisions = new Map<string, number>();
	const all = (provider: string): AnyModel[] => {
		if (!discovered.has(provider) && options.cacheDbPath) {
			const cached = readOperationModelCache(provider, options.cacheDbPath);
			if (cached) discovered.set(provider, cached);
		}
		return deduplicateOperationModels([
			...getBundledModels(provider as GeneratedProvider),
			...(discovered.get(provider) ?? [...getBundledImageModels(provider), ...getBundledClassifierModels(provider)]),
			...models.filter(model => model.provider === provider),
		]);
	};
	return {
		requestDeferred: async (model: Model, context: import("./types").Context, request?: DeferredRequestOptions) =>
			requestDeferred(model, context, {
				...request,
				fetch: request?.fetch ?? options.fetch,
				apiKey: request?.apiKey ?? (await options.getApiKey?.(model.provider)),
			}),
		fetchDeferred: async (
			model: Model,
			handle: import("./types").DeferredHandle,
			request?: import("./types").OperationOptions,
		) =>
			fetchDeferred(model, handle, {
				...request,
				fetch: request?.fetch ?? options.fetch,
				apiKey: request?.apiKey ?? (await options.getApiKey?.(model.provider)),
			}),
		cancelDeferred: async (
			model: Model,
			handle: import("./types").DeferredHandle,
			request?: import("./types").OperationOptions,
		) =>
			cancelDeferred(model, handle, {
				...request,
				fetch: request?.fetch ?? options.fetch,
				apiKey: request?.apiKey ?? (await options.getApiKey?.(model.provider)),
			}),
		refresh: async (provider: string, request: OperationDiscoveryOptions = {}) => {
			request.signal?.throwIfAborted();
			const revision = (revisions.get(provider) ?? 0) + 1;
			revisions.set(provider, revision);
			const next = await discoverOperationModels(provider, {
				...request,
				fetch: request.fetch ?? options.fetch,
				apiKey: request.apiKey ?? (await options.getApiKey?.(provider)),
			});
			request.signal?.throwIfAborted();
			if (revisions.get(provider) === revision) {
				if (options.cacheDbPath) writeOperationModelCache(provider, next, options.cacheDbPath);
				discovered.set(provider, next);
			}
		},
		getChatModels: (provider: string): Model[] =>
			all(provider).filter((model): model is Model => model.type === undefined || model.type === "chat"),
		getImageModels: (provider: string): ImageModel[] =>
			all(provider).filter((model): model is ImageModel => model.type === "image"),
		getClassifierModels: (provider: string): ClassifierModel[] =>
			all(provider).filter((model): model is ClassifierModel => model.type === "classifier"),
		getAnyModels: all,
		generateImages: async (model: ImageModel, context: ImagesContext, request?: ImagesOptions) =>
			generateImages(model, context, {
				...request,
				fetch: request?.fetch ?? options.fetch,
				apiKey: request?.apiKey ?? (await options.getApiKey?.(model.provider)),
			}),
		classify: async (model: ClassifierModel, context: ClassifierContext, request?: ClassifierOptions) =>
			classify(model, context, {
				...request,
				fetch: request?.fetch ?? options.fetch,
				apiKey: request?.apiKey ?? (await options.getApiKey?.(model.provider)),
			}),
	};
}
