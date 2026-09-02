import type { Model, Usage } from "@f5-sales-demo/pi-ai";

export type ContextLoadingMode = "eager" | "progressive";

export type ContextComponentCategory =
	| "system_prompt"
	| "context_file"
	| "skill"
	| "plugin_catalog"
	| "rule"
	| "tool_description"
	| "tool_schema"
	| "message"
	| "tool_result";

export interface ContextComponentProfile {
	category: ContextComponentCategory;
	label: string;
	bytes: number;
	estimatedTokens: number;
}

export interface ContextToolProfile {
	name: string;
	descriptionBytes: number;
	schemaBytes: number;
	estimatedTokens: number;
}

export interface ContextMessageProfile {
	role: string;
	bytes: number;
	estimatedTokens: number;
}

export interface ProviderCallProfile {
	call: number;
	provider: string;
	model: string;
	api: string;
	payloadBytes: number;
	estimatedPayloadTokens: number;
	categoryBytes: Record<"system_prompt" | "tools" | "messages" | "tool_results" | "other", number>;
	toolCount: number;
	messageCount: number;
	tools: ContextToolProfile[];
	messages: ContextMessageProfile[];
	contextWindow: number;
	providerInputTokens?: number;
	providerCacheReadTokens?: number;
	providerCacheWriteTokens?: number;
	providerPromptTokens?: number;
	providerOutputTokens?: number;
	windowPercentage?: number;
}

export interface ContextProfile {
	loadingMode: ContextLoadingMode;
	systemPromptBytes: number;
	estimatedSystemPromptTokens: number;
	initialToolBytes: number;
	deferredToolBytes: number;
	components: ContextComponentProfile[];
	tools: ContextToolProfile[];
	providerCalls: ProviderCallProfile[];
}

export function estimateContextTokens(bytes: number): number {
	return bytes <= 0 ? 0 : Math.ceil(bytes / 4);
}

function jsonBytes(value: unknown): number {
	if (value === undefined) return 0;
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return 0;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
	for (const key of keys) {
		if (record[key] !== undefined) return record[key];
	}
	return undefined;
}

function safeRole(value: unknown): string {
	if (!isRecord(value) || typeof value.role !== "string") return "unknown";
	return ["system", "developer", "user", "assistant", "tool", "toolResult", "model"].includes(value.role)
		? value.role
		: "other";
}

function isToolResultMessage(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.role === "tool" || value.role === "toolResult" || value.type === "function_call_output") return true;
	const content = Array.isArray(value.content) ? value.content : [];
	if (content.some(block => isRecord(block) && block.type === "tool_result")) return true;
	const parts = Array.isArray(value.parts) ? value.parts : [];
	return parts.some(part => isRecord(part) && ("functionResponse" in part || "function_response" in part));
}

function toolName(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.name === "string") return value.name;
	if (isRecord(value.function) && typeof value.function.name === "string") return value.function.name;
	return undefined;
}

function flattenProviderTools(tools: unknown[]): unknown[] {
	const flattened: unknown[] = [];
	for (const tool of tools) {
		if (isRecord(tool) && Array.isArray(tool.functionDeclarations)) {
			flattened.push(...tool.functionDeclarations);
		} else {
			flattened.push(tool);
		}
	}
	return flattened;
}

function profilePayloadTool(value: unknown, index: number): ContextToolProfile {
	const record = isRecord(value) ? value : {};
	const definition = isRecord(record.function) ? record.function : record;
	const descriptionBytes = jsonBytes(definition.description);
	const schemaBytes = jsonBytes(definition.parameters ?? definition.input_schema ?? definition.schema);
	return {
		name: toolName(value) ?? `tool_${index + 1}`,
		descriptionBytes,
		schemaBytes,
		estimatedTokens: estimateContextTokens(descriptionBytes + schemaBytes),
	};
}

export function profileProviderPayload(payload: unknown, model: Model, call: number): ProviderCallProfile {
	const record = isRecord(payload) ? payload : {};
	const body = isRecord(record.request) ? record.request : record;
	const system = firstDefined(body, ["systemInstruction", "system_instruction", "system", "instructions"]);
	const rawTools = firstArray(body, ["tools", "functions"]);
	const rawMessages = firstArray(body, ["contents", "messages", "input"]);
	const tools = flattenProviderTools(rawTools);
	const payloadBytes = jsonBytes(payload);
	const systemBytes = jsonBytes(system);
	const toolsBytes = jsonBytes(rawTools);
	const toolResultBytes = rawMessages
		.filter(isToolResultMessage)
		.reduce<number>((sum, message) => sum + jsonBytes(message), 0);
	const messagesBytes = rawMessages
		.filter(message => !isToolResultMessage(message))
		.reduce<number>((sum, message) => sum + jsonBytes(message), 0);
	return {
		call,
		provider: model.provider,
		model: model.id,
		api: model.api,
		payloadBytes,
		estimatedPayloadTokens: estimateContextTokens(payloadBytes),
		categoryBytes: {
			system_prompt: systemBytes,
			tools: toolsBytes,
			messages: messagesBytes,
			tool_results: toolResultBytes,
			other: Math.max(0, payloadBytes - systemBytes - toolsBytes - messagesBytes - toolResultBytes),
		},
		toolCount: tools.length,
		messageCount: rawMessages.length,
		tools: tools.map(profilePayloadTool),
		messages: rawMessages.map(message => {
			const bytes = jsonBytes(message);
			return { role: safeRole(message), bytes, estimatedTokens: estimateContextTokens(bytes) };
		}),
		contextWindow: model.contextWindow,
	};
}

export class ContextProfileCollector {
	readonly #profile: ContextProfile;
	#attributedComponents: ContextComponentProfile[] = [];

	constructor(loadingMode: ContextLoadingMode) {
		this.#profile = {
			loadingMode,
			systemPromptBytes: 0,
			estimatedSystemPromptTokens: 0,
			initialToolBytes: 0,
			deferredToolBytes: 0,
			components: [],
			tools: [],
			providerCalls: [],
		};
	}

	setPrompt(
		systemPrompt: string,
		tools: Iterable<{ name: string; description?: string; parameters?: unknown }>,
	): void {
		const systemPromptBytes = Buffer.byteLength(systemPrompt, "utf8");
		const toolProfiles = Array.from(tools, tool => {
			const descriptionBytes = Buffer.byteLength(tool.description ?? "", "utf8");
			const schemaBytes = jsonBytes(tool.parameters);
			return {
				name: tool.name,
				descriptionBytes,
				schemaBytes,
				estimatedTokens: estimateContextTokens(descriptionBytes + schemaBytes),
			};
		});
		this.#profile.systemPromptBytes = systemPromptBytes;
		this.#profile.estimatedSystemPromptTokens = estimateContextTokens(systemPromptBytes);
		this.#profile.tools = toolProfiles;
		this.#profile.initialToolBytes = toolProfiles.reduce(
			(sum, tool) => sum + tool.descriptionBytes + tool.schemaBytes,
			0,
		);
		this.#profile.components = [
			{
				category: "system_prompt",
				label: "rendered",
				bytes: systemPromptBytes,
				estimatedTokens: estimateContextTokens(systemPromptBytes),
			},
			...toolProfiles.flatMap(tool => [
				{
					category: "tool_description" as const,
					label: tool.name,
					bytes: tool.descriptionBytes,
					estimatedTokens: estimateContextTokens(tool.descriptionBytes),
				},
				{
					category: "tool_schema" as const,
					label: tool.name,
					bytes: tool.schemaBytes,
					estimatedTokens: estimateContextTokens(tool.schemaBytes),
				},
			]),
			...this.#attributedComponents,
		];
	}

	setAttributedComponents(components: ContextComponentProfile[]): void {
		this.#attributedComponents = components.map(component => ({ ...component }));
	}

	setDeferredTools(tools: Iterable<{ description?: string; parameters?: unknown }>): void {
		this.#profile.deferredToolBytes = Array.from(tools).reduce(
			(sum, tool) => sum + Buffer.byteLength(tool.description ?? "", "utf8") + jsonBytes(tool.parameters),
			0,
		);
	}

	captureProviderPayload(payload: unknown, model: Model): void {
		this.#profile.providerCalls.push(profileProviderPayload(payload, model, this.#profile.providerCalls.length + 1));
	}

	recordProviderUsage(model: Model, usage: Usage): void {
		const call = [...this.#profile.providerCalls]
			.reverse()
			.find(candidate => candidate.model === model.id && candidate.providerPromptTokens === undefined);
		if (!call) return;
		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		call.providerInputTokens = usage.input;
		call.providerCacheReadTokens = usage.cacheRead;
		call.providerCacheWriteTokens = usage.cacheWrite;
		call.providerPromptTokens = promptTokens;
		call.providerOutputTokens = usage.output;
		call.windowPercentage = call.contextWindow > 0 ? (promptTokens / call.contextWindow) * 100 : 0;
	}

	snapshot(): ContextProfile {
		return structuredClone(this.#profile);
	}
}
