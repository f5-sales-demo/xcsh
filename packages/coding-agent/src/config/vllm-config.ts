import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeVllmBaseUrl } from "@f5-sales-demo/pi-ai";
import { Document, isMap, parseDocument } from "yaml";

const CONFIG_DIR_MODE = 0o700;
const MODELS_FILE_MODE = 0o600;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Local vLLM models have materially smaller context windows than hosted models.
 * Keep the zero-configuration tool set useful while leaving room for the
 * system prompt and tool results. Explicit --tools selections remain authoritative.
 */
export const VLLM_DEFAULT_TOOL_NAMES = ["bash", "read", "grep", "find", "edit", "write", "calc"] as const;

export interface VllmConfig {
	baseUrl: string;
}

export interface VllmProbeResult {
	models: string[];
}

export interface VllmProbeOptions {
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface WriteVllmModelsConfigOptions {
	authenticated: boolean;
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

function createModelsDocument(): Document {
	return new Document({});
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

export async function probeVllmConnection(
	baseUrl: string,
	apiKey: string,
	options: VllmProbeOptions = {},
): Promise<VllmProbeResult> {
	const normalizedBaseUrl = normalizeVllmBaseUrl(baseUrl);
	const modelsUrl = `${normalizedBaseUrl}/models`;
	const headers = new Headers({ Accept: "application/json" });
	const trimmedApiKey = apiKey.trim();
	if (trimmedApiKey) {
		headers.set("Authorization", `Bearer ${trimmedApiKey}`);
	}

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
	if (!response.ok) {
		throw new Error(`vLLM model discovery failed with HTTP ${response.status}`);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new Error("vLLM /models did not return valid JSON", { cause: error });
	}
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("data" in payload) ||
		!Array.isArray((payload as { data?: unknown }).data)
	) {
		throw new Error("vLLM returned a malformed model catalog");
	}

	const models: string[] = [];
	const seen = new Set<string>();
	for (const entry of (payload as { data: unknown[] }).data) {
		if (typeof entry !== "object" || entry === null || typeof (entry as { id?: unknown }).id !== "string") {
			throw new Error("vLLM returned a malformed model catalog");
		}
		const id = (entry as { id: string }).id.trim();
		if (id && !seen.has(id)) {
			seen.add(id);
			models.push(id);
		}
	}
	if (models.length === 0) {
		throw new Error("vLLM returned no models");
	}
	return { models };
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
		const existing = await fs.promises.readFile(modelsPath, "utf8");
		document = parseModelsDocument(existing, modelsPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		document = createModelsDocument();
	}

	const normalizedBaseUrl = normalizeVllmBaseUrl(baseUrl);
	document.setIn(["providers", "vllm", "baseUrl"], normalizedBaseUrl);
	document.setIn(["providers", "vllm", "api"], "openai-completions");
	document.setIn(["providers", "vllm", "discovery", "type"], "openai-compat");
	if (options.authenticated) {
		document.deleteIn(["providers", "vllm", "auth"]);
	} else {
		document.setIn(["providers", "vllm", "auth"], "none");
	}
	document.deleteIn(["providers", "vllm", "apiKey"]);

	await atomicWrite(modelsPath, document.toString({ lineWidth: 0 }));
}
