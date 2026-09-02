import { z } from "zod";
import { REASONING_EFFORTS, type ReasoningEffort } from "../../model-thinking";
import { CODEX_BASE_URL, OPENAI_HEADER_VALUES, OPENAI_HEADERS } from "../../providers/openai-codex/constants";
import type { Model, ThinkingConfig } from "../../types";
import { isRecord } from "../../utils";

const DEFAULT_MODEL_LIST_PATHS = ["/codex/models", "/models"] as const;
const DEFAULT_CONTEXT_WINDOW = 272_000;
const DEFAULT_MAX_TOKENS = 128_000;
const DEFAULT_CODEX_CLIENT_VERSION = "0.99.0";
const NPM_CODEX_LATEST_URL = "https://registry.npmjs.org/@openai%2Fcodex/latest";

const codexReasoningPresetSchema = z
	.object({
		effort: z.unknown().optional(),
		description: z.unknown().optional(),
	})
	.loose();

const codexModelEntrySchema = z
	.object({
		slug: z.unknown().optional(),
		id: z.unknown().optional(),
		display_name: z.unknown().optional(),
		description: z.unknown().optional(),
		visibility: z.unknown().optional(),
		publisher: z.unknown().optional(),
		family: z.unknown().optional(),
		tier: z.unknown().optional(),
		context_window: z.unknown().optional(),
		default_reasoning_level: z.unknown().optional(),
		supported_reasoning_levels: z.unknown().optional(),
		input_modalities: z.unknown().optional(),
		supported_in_api: z.unknown().optional(),
		priority: z.unknown().optional(),
		prefer_websockets: z.unknown().optional(),
	})
	.loose();

const codexModelsResponseSchema = z
	.object({
		models: z.array(z.unknown()).optional(),
		data: z.array(z.unknown()).optional(),
	})
	.loose();

type CodexModelEntry = z.infer<typeof codexModelEntrySchema>;

interface NormalizedCodexModel {
	model: Model<"openai-codex-responses">;
	priority: number;
}

/**
 * Fetch options for OpenAI Codex model discovery.
 */
export interface CodexModelDiscoveryOptions {
	/** OAuth access token used for `Authorization: Bearer ...`. */
	accessToken: string;
	/** ChatGPT account id value used for `chatgpt-account-id` header. */
	accountId?: string;
	/** Base URL for Codex backend. Defaults to `https://chatgpt.com/backend-api`. */
	baseUrl?: string;
	/** Optional client version attached as `client_version` query parameter. */
	clientVersion?: string;
	/** Optional endpoint path candidates. Defaults to `/codex/models`, then `/models`. */
	paths?: readonly string[];
	/** Additional headers merged on top of required Codex headers. */
	headers?: Record<string, string>;
	/** Abort signal for network request cancellation. */
	signal?: AbortSignal;
	/** Optional fetch implementation override for tests. */
	fetchFn?: typeof fetch;
	/** Optional registry fetch implementation override for client version lookup. */
	registryFetchFn?: typeof fetch;
}

/**
 * Normalized Codex discovery response.
 */
export interface CodexModelDiscoveryResult {
	models: Model<"openai-codex-responses">[];
	etag?: string;
}

/**
 * Fetches model metadata from Codex backend and normalizes it for pi model management.
 *
 * Returns `null` when no supported model-list route can be fetched/parsed.
 * Returns `{ models: [] }` when a route succeeds but yields no usable models.
 */
export async function fetchCodexModels(options: CodexModelDiscoveryOptions): Promise<CodexModelDiscoveryResult | null> {
	const fetchFn = options.fetchFn ?? fetch;
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const paths = normalizePaths(options.paths);
	const headers = buildCodexHeaders(options);
	const clientVersion = await resolveCodexClientVersion(
		options.clientVersion,
		options.registryFetchFn ?? fetchFn,
		options.signal,
	);

	let sawSuccessfulResponse = false;
	for (const path of paths) {
		const requestUrl = buildModelsUrl(baseUrl, path, clientVersion);
		let response: Response;
		try {
			response = await fetchFn(requestUrl, {
				method: "GET",
				headers,
				signal: options.signal,
			});
		} catch {
			continue;
		}

		if (!response.ok) {
			continue;
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			continue;
		}

		const models = normalizeCodexModels(payload, baseUrl);
		if (models === null) {
			continue;
		}
		sawSuccessfulResponse = true;
		const etag = getResponseEtag(response.headers);
		return etag ? { models, etag } : { models };
	}
	return sawSuccessfulResponse ? { models: [] } : null;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
	const raw = (baseUrl ?? CODEX_BASE_URL).trim();
	if (!raw) {
		return CODEX_BASE_URL;
	}
	return raw.replace(/\/+$/, "");
}

function normalizePaths(paths: readonly string[] | undefined): string[] {
	if (!paths || paths.length === 0) {
		return [...DEFAULT_MODEL_LIST_PATHS];
	}
	const normalized = paths
		.map(path => path.trim())
		.filter(path => path.length > 0)
		.map(path => (path.startsWith("/") ? path : `/${path}`));
	return normalized.length > 0 ? normalized : [...DEFAULT_MODEL_LIST_PATHS];
}

function buildModelsUrl(baseUrl: string, path: string, clientVersion: string | undefined): string {
	const url = new URL(`${baseUrl}${path}`);
	if (clientVersion && clientVersion.trim().length > 0) {
		url.searchParams.set("client_version", clientVersion.trim());
	}
	return url.toString();
}

function buildCodexHeaders(options: CodexModelDiscoveryOptions): Headers {
	const headers = new Headers(options.headers);
	headers.set("Authorization", `Bearer ${options.accessToken}`);
	if (options.accountId && options.accountId.trim().length > 0) {
		headers.set(OPENAI_HEADERS.ACCOUNT_ID_HEADER, options.accountId);
	}
	headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
	headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
	headers.set("accept", "application/json");
	return headers;
}

async function resolveCodexClientVersion(
	clientVersion: string | undefined,
	fetchFn: typeof fetch,
	signal: AbortSignal | undefined,
): Promise<string> {
	const normalizedClientVersion = normalizeClientVersion(clientVersion);
	if (normalizedClientVersion) {
		return normalizedClientVersion;
	}
	try {
		const response = await fetchFn(NPM_CODEX_LATEST_URL, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal,
		});
		if (!response.ok) {
			return DEFAULT_CODEX_CLIENT_VERSION;
		}
		const payload: unknown = await response.json();
		if (!isRecord(payload)) {
			return DEFAULT_CODEX_CLIENT_VERSION;
		}
		const npmVersion = normalizeClientVersion(payload.version);
		return npmVersion ?? DEFAULT_CODEX_CLIENT_VERSION;
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
		return DEFAULT_CODEX_CLIENT_VERSION;
	}
}

function normalizeClientVersion(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
		return undefined;
	}
	return trimmed;
}

function isAbortError(error: unknown): error is Error {
	return error instanceof Error && error.name === "AbortError";
}

function normalizeCodexModels(payload: unknown, baseUrl: string): Model<"openai-codex-responses">[] | null {
	const parsedResponse = codexModelsResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		return null;
	}

	const entries = parsedResponse.data.models ?? parsedResponse.data.data ?? [];
	const normalized: NormalizedCodexModel[] = [];
	for (const entry of entries) {
		const model = normalizeCodexModelEntry(entry, baseUrl);
		if (model) {
			normalized.push(model);
		}
	}

	normalized.sort((left, right) => {
		if (left.priority !== right.priority) {
			return left.priority - right.priority;
		}
		return left.model.id.localeCompare(right.model.id);
	});

	return normalized.map(item => item.model);
}

function normalizeCodexModelEntry(entry: unknown, baseUrl: string): NormalizedCodexModel | null {
	const parsedEntry = codexModelEntrySchema.safeParse(entry);
	if (!parsedEntry.success) {
		return null;
	}

	const payload: CodexModelEntry = parsedEntry.data;
	const slug = toNonEmptyString(payload.slug) ?? toNonEmptyString(payload.id);
	if (!slug) {
		return null;
	}

	const supportedInApi = toBoolean(payload.supported_in_api);
	if (supportedInApi === false) {
		return null;
	}

	const name = toNonEmptyString(payload.display_name) ?? slug;
	const contextWindow = toPositiveInt(payload.context_window) ?? DEFAULT_CONTEXT_WINDOW;
	const maxTokens = Math.min(DEFAULT_MAX_TOKENS, contextWindow);
	const thinking = normalizeReasoningConfig(payload.default_reasoning_level, payload.supported_reasoning_levels);
	const reasoning = Boolean(thinking?.supportedLevels.some(level => level.effort !== "none"));
	const input = normalizeInputModalities(payload.input_modalities);
	const preferWebsockets = toBoolean(payload.prefer_websockets) === true;
	const priority = toFiniteNumber(payload.priority) ?? Number.MAX_SAFE_INTEGER;
	const visibility = normalizeVisibility(payload.visibility);
	const presentation = inferPresentationMetadata(slug, name, payload);

	return {
		priority,
		model: {
			id: slug,
			name,
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl,
			reasoning,
			input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow,
			maxTokens,
			...(toNonEmptyString(payload.description) ? { description: toNonEmptyString(payload.description)! } : {}),
			...(visibility ? { visibility } : {}),
			...presentation,
			...(thinking ? { thinking } : {}),
			...(preferWebsockets ? { preferWebsockets: true } : {}),
			...(priority !== Number.MAX_SAFE_INTEGER ? { priority } : {}),
		},
	};
}

function normalizeReasoningConfig(
	defaultReasoningLevel: unknown,
	supportedReasoningLevels: unknown,
): ThinkingConfig | undefined {
	if (!Array.isArray(supportedReasoningLevels)) return undefined;
	const supportedLevels = supportedReasoningLevels.flatMap(level => {
		const parsed = codexReasoningPresetSchema.safeParse(level);
		if (!parsed.success) return [];
		const effort = toNonEmptyString(parsed.data.effort)?.toLowerCase() as ReasoningEffort | undefined;
		if (!effort || !REASONING_EFFORTS.includes(effort)) return [];
		return [{ effort, description: toNonEmptyString(parsed.data.description) ?? effort }];
	});
	const defaultLevel = toNonEmptyString(defaultReasoningLevel)?.toLowerCase() as ReasoningEffort | undefined;
	if (!defaultLevel || !supportedLevels.some(level => level.effort === defaultLevel)) return undefined;
	return { mode: "effort", defaultLevel, supportedLevels };
}

function normalizeVisibility(value: unknown): Model["visibility"] {
	const visibility = toNonEmptyString(value)?.toLowerCase();
	return visibility === "list" || visibility === "hide" || visibility === "none" ? visibility : undefined;
}

function inferPresentationMetadata(
	slug: string,
	_name: string,
	payload: CodexModelEntry,
): Pick<Model, "publisher" | "family" | "tier"> {
	const suppliedPublisher = toNonEmptyString(payload.publisher);
	const suppliedFamily = toNonEmptyString(payload.family);
	const suppliedTier = toNonEmptyString(payload.tier);
	const match = /^gpt-(\d+(?:\.\d+)?)-(sol|terra|luna)$/i.exec(slug);
	return {
		publisher: suppliedPublisher ?? (slug.toLowerCase().startsWith("gpt-") ? "OpenAI" : undefined),
		family: suppliedFamily ?? (match ? `GPT-${match[1]}` : undefined),
		tier: suppliedTier ?? (match?.[2] ? match[2][0]!.toUpperCase() + match[2].slice(1).toLowerCase() : undefined),
	};
}

function normalizeInputModalities(inputModalities: unknown): ("text" | "image")[] {
	if (!Array.isArray(inputModalities)) {
		return ["text", "image"];
	}

	const set = new Set<"text" | "image">();
	for (const modality of inputModalities) {
		const normalized = toNonEmptyString(modality)?.toLowerCase();
		if (normalized === "text" || normalized === "image") {
			set.add(normalized);
		}
	}

	if (set.size === 0) {
		return ["text", "image"];
	}

	const canonical: ("text" | "image")[] = ["text", "image"];
	return canonical.filter(modality => set.has(modality));
}

function getResponseEtag(headers: Headers): string | undefined {
	const etag = headers.get("etag");
	if (!etag) {
		return undefined;
	}
	const trimmed = etag.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function toPositiveInt(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	if (value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

function toBoolean(value: unknown): boolean | null {
	if (typeof value !== "boolean") {
		return null;
	}
	return value;
}
