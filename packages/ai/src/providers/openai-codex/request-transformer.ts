import {
	type ReasoningSummary,
	resolveCodexWireReasoningEffort,
	resolveWireReasoningSummary,
	type WireReasoningSummary,
} from "../../codex-model-interaction";
import type { ReasoningEffort } from "../../model-thinking";
import { requireSupportedReasoningEffort } from "../../model-thinking";
import type { Api, Model } from "../../types";

export interface ReasoningConfig {
	effort: ReasoningEffort;
	summary?: WireReasoningSummary;
}

export interface CodexRequestOptions {
	reasoningEffort?: ReasoningConfig["effort"];
	reasoningSummary?: ReasoningSummary | null;
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
	metadata?: Record<string, unknown>;
}

export interface InputItem {
	id?: string | null;
	type?: string | null;
	role?: string;
	content?: unknown;
	call_id?: string | null;
	name?: string | null;
	output?: unknown;
	arguments?: unknown;
}

export interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: InputItem[];
	tools?: unknown;
	tool_choice?: unknown;
	parallel_tool_calls?: boolean;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	min_p?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
	reasoning?: Partial<ReasoningConfig>;
	text?: {
		verbosity?: "low" | "medium" | "high";
	};
	include?: string[];
	prompt_cache_key?: string;
	prompt_cache_retention?: "in_memory" | "24h";
	service_tier?: string;
	client_metadata?: Record<string, string>;
	max_output_tokens?: number;
	max_completion_tokens?: number;
	[key: string]: unknown;
}

function getReasoningConfig(model: Model<Api>, options: CodexRequestOptions): ReasoningConfig {
	const summary = resolveWireReasoningSummary(options.reasoningSummary ?? model.defaultReasoningSummary ?? "none");
	return {
		effort: resolveCodexWireReasoningEffort(
			model.id,
			requireSupportedReasoningEffort(
				model,
				(options.reasoningEffort ?? model.thinking?.defaultLevel) as ReasoningEffort,
			),
		),
		...(summary ? { summary } : {}),
	};
}

export function normalizeClientMetadata(
	metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
	if (!metadata) return undefined;
	const entries = Object.entries(metadata).flatMap(([key, value]) => {
		if (typeof value === "string") return [[key, value] as const];
		if (typeof value === "number" || typeof value === "boolean") return [[key, String(value)] as const];
		return [];
	});
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function truncateMiddle(value: string, policy: NonNullable<Model<Api>["truncationPolicy"]>): string {
	const maxBytes = policy.mode === "tokens" ? policy.limit * 4 : policy.limit;
	const totalBytes = utf8Length(value);
	if (value.length === 0 || (maxBytes > 0 && totalBytes <= maxBytes)) return value;

	const characters = Array.from(value);
	const leftBudget = Math.floor(Math.max(0, maxBytes) / 2);
	const rightBudget = Math.max(0, maxBytes) - leftBudget;
	let leftBytes = 0;
	let leftCount = 0;
	while (leftCount < characters.length) {
		const nextBytes = utf8Length(characters[leftCount]!);
		if (leftBytes + nextBytes > leftBudget) break;
		leftBytes += nextBytes;
		leftCount += 1;
	}

	let rightBytes = 0;
	let rightStart = characters.length;
	while (rightStart > leftCount) {
		const nextBytes = utf8Length(characters[rightStart - 1]!);
		if (rightBytes + nextBytes > rightBudget) break;
		rightBytes += nextBytes;
		rightStart -= 1;
	}

	const removed =
		policy.mode === "tokens"
			? Math.ceil(Math.max(0, totalBytes - Math.max(0, maxBytes)) / 4)
			: Math.max(0, characters.length - leftCount - (characters.length - rightStart));
	const unit = policy.mode === "tokens" ? "tokens" : "chars";
	return `${characters.slice(0, leftCount).join("")}…${removed} ${unit} truncated…${characters.slice(rightStart).join("")}`;
}

export function truncateFunctionCallOutputs(
	input: InputItem[] | undefined,
	policy: Model<Api>["truncationPolicy"],
): InputItem[] | undefined {
	if (!input || !policy) return input;
	return input.map(item => {
		if (item.type !== "function_call_output" || typeof item.output !== "string") return item;
		return { ...item, output: truncateMiddle(item.output, policy) };
	});
}

function filterInput(input: InputItem[] | undefined): InputItem[] | undefined {
	if (!Array.isArray(input)) return input;

	return input
		.filter(item => item.type !== "item_reference")
		.map(item => {
			if (item.id != null) {
				const { id: _id, ...rest } = item;
				return rest as InputItem;
			}
			return item;
		});
}

export async function transformRequestBody(
	body: RequestBody,
	model: Model<Api>,
	options: CodexRequestOptions = {},
	prompt?: { instructions: string; developerMessages: string[] },
): Promise<RequestBody> {
	body.store = false;
	body.stream = true;
	body.tool_choice = "auto";
	body.parallel_tool_calls = model.supportsParallelToolCalls ?? false;
	// The ChatGPT Codex backend rejects sampling controls with `Unsupported parameter`.
	// Generic stream options may supply defaults, so remove them at the provider boundary.
	delete body.temperature;
	delete body.top_p;
	delete body.top_k;
	delete body.min_p;
	delete body.presence_penalty;
	delete body.repetition_penalty;

	if (body.input && Array.isArray(body.input)) {
		body.input = truncateFunctionCallOutputs(filterInput(body.input), model.truncationPolicy);

		if (body.input) {
			const functionCallIds = new Set(
				body.input
					.filter(item => item.type === "function_call" && typeof item.call_id === "string")
					.map(item => item.call_id as string),
			);

			body.input = body.input.map(item => {
				if (item.type === "function_call_output" && typeof item.call_id === "string") {
					const callId = item.call_id as string;
					if (!functionCallIds.has(callId)) {
						const itemRecord = item as unknown as Record<string, unknown>;
						const toolName = typeof itemRecord.name === "string" ? itemRecord.name : "tool";
						let text = "";
						try {
							const output = itemRecord.output;
							text = typeof output === "string" ? output : JSON.stringify(output);
						} catch {
							text = String(itemRecord.output ?? "");
						}
						if (text.length > 16000) {
							text = `${text.slice(0, 16000)}\n...[truncated]`;
						}
						return {
							type: "message",
							role: "assistant",
							content: `[Previous ${toolName} result; call_id=${callId}]: ${text}`,
						} as InputItem;
					}
				}
				return item;
			});
		}
	}

	if (prompt?.developerMessages && prompt.developerMessages.length > 0 && Array.isArray(body.input)) {
		const developerMessages = prompt.developerMessages.map(
			text =>
				({
					type: "message",
					role: "developer",
					content: [{ type: "input_text", text }],
				}) as InputItem,
		);
		body.input = [...developerMessages, ...body.input];
	}

	if (model.reasoning && (model.thinking || options.reasoningEffort !== undefined)) {
		const reasoningConfig = getReasoningConfig(model, options);
		const { summary: _summary, ...existingReasoning } = body.reasoning ?? {};
		body.reasoning = {
			...existingReasoning,
			...reasoningConfig,
		};
	} else {
		delete body.reasoning;
	}

	body.text = {
		...body.text,
		verbosity: options.textVerbosity ?? model.defaultVerbosity ?? "low",
	};

	const requestedServiceTier = body.service_tier ?? model.defaultServiceTier;
	if (requestedServiceTier) {
		if (model.serviceTiers && !model.serviceTiers.includes(requestedServiceTier as never)) {
			throw new Error(
				`Service tier "${requestedServiceTier}" is unavailable for ${model.provider}/${model.id}. Supported tiers: ${model.serviceTiers.join(", ")}`,
			);
		}
		body.service_tier = requestedServiceTier;
	}
	body.client_metadata = normalizeClientMetadata(options.metadata);

	const include = Array.isArray(options.include) ? [...options.include] : [];
	include.push("reasoning.encrypted_content");
	body.include = Array.from(new Set(include));

	delete body.max_output_tokens;
	delete body.max_completion_tokens;

	return body;
}
