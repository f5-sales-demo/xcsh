import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Document, isMap, parseDocument } from "yaml";

const CONFIG_DIR_MODE = 0o700;
const MODELS_FILE_MODE = 0o600;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const CONTEXT_FIELDS = [
	"max_model_len",
	"max_model_length",
	"max_context_length",
	"context_length",
	"context_window",
	"max_sequence_length",
] as const;

export const DEFAULT_VLLM_BASE_URL = "http://127.0.0.1:8000/v1";

export interface VllmConfig {
	baseUrl: string;
}

export interface VllmDiscoveredModel {
	id: string;
	contextWindow?: number;
}

export interface VllmProbeResult {
	models: VllmDiscoveredModel[];
}

export interface VllmProbeOptions {
	fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface WriteVllmModelsConfigOptions {
	authenticated: boolean;
}

export function normalizeVllmBaseUrl(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("vLLM Base URL must be a valid HTTP or HTTPS URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("vLLM Base URL must use HTTP or HTTPS");
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error("vLLM Base URL must not contain credentials, query parameters, or a fragment");
	}
	return parsed.toString().replace(/\/+$/, "");
}

function parseModelsDocument(content: string, filePath: string): ReturnType<typeof parseDocument> {
	const document = parseDocument(content, { prettyErrors: false });
	if (document.errors.length > 0) {
		throw new Error(`Cannot update ${filePath}: invalid YAML (${document.errors[0]?.message ?? "parse error"})`);
	}
	if (document.contents !== null && !isMap(document.contents)) {
		throw new Error(`Cannot update ${filePath}: the YAML root must be a map`);
	}
	const providers = document.get("providers", true);
	if (providers !== undefined && providers !== null && !isMap(providers)) {
		throw new Error(`Cannot update ${filePath}: providers must be a map`);
	}
	const vllm = document.getIn(["providers", "vllm"], true);
	if (vllm !== undefined && vllm !== null && !isMap(vllm)) {
		throw new Error(`Cannot update ${filePath}: providers.vllm must be a map`);
	}
	return document;
}

export function readVllmConfig(modelsPath: string): VllmConfig | undefined {
	let content: string;
	try {
		content = fs.readFileSync(modelsPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const document = parseModelsDocument(content, modelsPath);
	const baseUrl = document.getIn(["providers", "vllm", "baseUrl"]);
	if (typeof baseUrl !== "string" || !baseUrl.trim()) return undefined;
	return { baseUrl: normalizeVllmBaseUrl(baseUrl) };
}

function positiveInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
	}
	return undefined;
}

function discoveredContextWindow(entry: Record<string, unknown>): number | undefined {
	for (const field of CONTEXT_FIELDS) {
		const value = positiveInteger(entry[field]);
		if (value !== undefined) return value;
	}
	return undefined;
}

export function parseVllmModelsPayload(payload: unknown): VllmDiscoveredModel[] {
	if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
		throw new Error("vLLM returned a malformed model catalog");
	}

	const models: VllmDiscoveredModel[] = [];
	const seen = new Set<string>();
	for (const rawEntry of (payload as { data: unknown[] }).data) {
		if (typeof rawEntry !== "object" || rawEntry === null || typeof (rawEntry as { id?: unknown }).id !== "string") {
			throw new Error("vLLM returned a malformed model catalog");
		}
		const entry = rawEntry as Record<string, unknown> & { id: string };
		const id = entry.id.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const contextWindow = discoveredContextWindow(entry);
		models.push(contextWindow === undefined ? { id } : { id, contextWindow });
	}
	if (models.length === 0) throw new Error("vLLM returned no models");
	return models;
}

export async function probeVllmConnection(
	baseUrl: string,
	apiKey: string,
	options: VllmProbeOptions = {},
): Promise<VllmProbeResult> {
	const normalizedBaseUrl = normalizeVllmBaseUrl(baseUrl);
	const modelsUrl = `${normalizedBaseUrl}/models`;
	const headers = new Headers({ Accept: "application/json" });
	const trimmedApiKey = apiKey.trim();
	if (trimmedApiKey) headers.set("Authorization", `Bearer ${trimmedApiKey}`);

	const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
	let response: Response;
	try {
		response = await (options.fetch ?? globalThis.fetch)(modelsUrl, { headers, signal });
	} catch (error) {
		const name = error instanceof Error ? error.name : "";
		if (name === "TimeoutError" || name === "AbortError") {
			throw new Error(`vLLM connection timed out at ${modelsUrl}`, { cause: error });
		}
		throw new Error(`Could not connect to vLLM at ${modelsUrl}`, { cause: error });
	}

	if (response.status === 401 || response.status === 403) {
		throw new Error(`vLLM rejected the API key (HTTP ${response.status})`);
	}
	if (!response.ok) throw new Error(`vLLM model discovery failed with HTTP ${response.status}`);

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new Error("vLLM /models did not return valid JSON", { cause: error });
	}
	return { models: parseVllmModelsPayload(payload) };
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	const directory = path.dirname(filePath);
	await fs.promises.mkdir(directory, { recursive: true, mode: CONFIG_DIR_MODE });
	await fs.promises.chmod(directory, CONFIG_DIR_MODE);

	const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
	let handle: fs.promises.FileHandle | undefined;
	try {
		handle = await fs.promises.open(tempPath, "wx", MODELS_FILE_MODE);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await fs.promises.rename(tempPath, filePath);
		await fs.promises.chmod(filePath, MODELS_FILE_MODE);
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await fs.promises.unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

export async function writeVllmModelsConfig(
	modelsPath: string,
	baseUrl: string,
	options: WriteVllmModelsConfigOptions,
): Promise<void> {
	let document: ReturnType<typeof parseDocument> | Document;
	try {
		document = parseModelsDocument(await fs.promises.readFile(modelsPath, "utf8"), modelsPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		document = new Document({});
	}

	document.setIn(["providers", "vllm", "baseUrl"], normalizeVllmBaseUrl(baseUrl));
	document.setIn(["providers", "vllm", "api"], "openai-completions");
	document.setIn(["providers", "vllm", "discovery", "type"], "openai-compat");
	if (options.authenticated) document.deleteIn(["providers", "vllm", "auth"]);
	else document.setIn(["providers", "vllm", "auth"], "none");
	document.deleteIn(["providers", "vllm", "apiKey"]);

	await atomicWrite(modelsPath, document.toString({ lineWidth: 0 }));
}
