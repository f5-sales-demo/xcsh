/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */
import type { AgentMessage } from "@f5xc-salesdemos/pi-agent-core";
import type {
	AssistantMessage,
	ImageContent,
	Message,
	MessageAttribution,
	ProviderPayload,
	TextContent,
	ToolCall,
	ToolResultMessage,
} from "@f5xc-salesdemos/pi-ai";
import { logger, prompt } from "@f5xc-salesdemos/pi-utils";
import branchSummaryContextPrompt from "../prompts/compaction/branch-summary-context.md" with { type: "text" };
import compactionSummaryContextPrompt from "../prompts/compaction/compaction-summary-context.md" with { type: "text" };
import type { OutputMeta } from "../tools/output-meta";
import { formatOutputNotice } from "../tools/output-meta";

const COMPACTION_SUMMARY_TEMPLATE = compactionSummaryContextPrompt;
const BRANCH_SUMMARY_TEMPLATE = branchSummaryContextPrompt;

export const SKILL_PROMPT_MESSAGE_TYPE = "skill-prompt";

export interface SkillPromptDetails {
	name: string;
	path: string;
	args?: string;
	lineCount: number;
}

function getPrunedToolResultContent(message: ToolResultMessage): (TextContent | ImageContent)[] {
	if (message.prunedAt === undefined) {
		return message.content;
	}
	const textBlocks = message.content.filter((content): content is TextContent => content.type === "text");
	const text = textBlocks.map(block => block.text).join("") || "[Output truncated]";
	return [{ type: "text", text }];
}

/**
 * Message type for bash executions via the ! command.
 */
export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	meta?: OutputMeta;
	timestamp: number;
	/** If true, this message is excluded from LLM context (!! prefix) */
	excludeFromContext?: boolean;
}

/**
 * Message type for user-initiated Python executions via the $ command.
 * Shares the same kernel session as the agent's Python tool.
 */
export interface PythonExecutionMessage {
	role: "pythonExecution";
	code: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	meta?: OutputMeta;
	timestamp: number;
	/** If true, this message is excluded from LLM context ($$ prefix) */
	excludeFromContext?: boolean;
}

/**
 * Message type for extension-injected messages via sendMessage().
 */
export interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	timestamp: number;
}

/**
 * Legacy hook message type (pre-extensions). Kept for session migration.
 */
export interface HookMessage<T = unknown> {
	role: "hookMessage";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	timestamp: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string;
	timestamp: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	shortSummary?: string;
	tokensBefore: number;
	providerPayload?: ProviderPayload;
	timestamp: number;
}

/**
 * Message type for auto-read file mentions via @filepath syntax.
 */
export interface FileMentionMessage {
	role: "fileMention";
	files: Array<{
		path: string;
		content: string;
		lineCount?: number;
		/** File size in bytes, if known. */
		byteSize?: number;
		/** Why the file contents were omitted from auto-read. */
		skippedReason?: "tooLarge";
		image?: ImageContent;
	}>;
	timestamp: number;
}

// Extend CustomAgentMessages via declaration merging
// Legacy hookMessage is kept for migration; new code should use custom.
declare module "@f5xc-salesdemos/pi-agent-core" {
	interface CustomAgentMessages {
		bashExecution: BashExecutionMessage;
		pythonExecution: PythonExecutionMessage;
		custom: CustomMessage;
		hookMessage: HookMessage;
		branchSummary: BranchSummaryMessage;
		compactionSummary: CompactionSummaryMessage;
		fileMention: FileMentionMessage;
	}
}

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
	let text = `Ran \`${msg.command}\`\n`;
	if (msg.output) {
		text += `\`\`\`\n${msg.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(command cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
		text += `\n\nCommand exited with code ${msg.exitCode}`;
	}
	text += formatOutputNotice(msg.meta);
	return text;
}

/**
 * Convert a PythonExecutionMessage to user message text for LLM context.
 */
export function pythonExecutionToText(msg: PythonExecutionMessage): string {
	let text = `Ran Python:\n\`\`\`python\n${msg.code}\n\`\`\`\n`;
	if (msg.output) {
		text += `Output:\n\`\`\`\n${msg.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(execution cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
		text += `\n\nExecution failed with code ${msg.exitCode}`;
	}
	text += formatOutputNotice(msg.meta);
	return text;
}

export function createBranchSummaryMessage(summary: string, fromId: string, timestamp: string): BranchSummaryMessage {
	return {
		role: "branchSummary",
		summary,
		fromId,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function createCompactionSummaryMessage(
	summary: string,
	tokensBefore: number,
	timestamp: string,
	shortSummary?: string,
	providerPayload?: ProviderPayload,
): CompactionSummaryMessage {
	return {
		role: "compactionSummary",
		summary,
		shortSummary,
		tokensBefore,
		providerPayload,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function sanitizeRehydratedOpenAIResponsesAssistantMessage(message: AssistantMessage): AssistantMessage {
	if (message.providerPayload?.type !== "openaiResponsesHistory") {
		return message;
	}

	let didSanitizeContent = false;
	const sanitizedContent = message.content.map(block => {
		if (block.type !== "thinking" || block.thinkingSignature === undefined) {
			return block;
		}

		didSanitizeContent = true;
		return { ...block, thinkingSignature: undefined };
	});

	// Strip the assistant-side native replay payload entirely.
	// After rehydration it belongs to a previous live provider connection and
	// replaying it on a warmed session causes 401 rejections from GitHub Copilot.
	// User/developer payloads are preserved separately by the caller.
	return {
		...message,
		...(didSanitizeContent ? { content: sanitizedContent } : {}),
		providerPayload: undefined,
	};
}

/** Convert CustomMessageEntry to AgentMessage format */
export function createCustomMessage(
	customType: string,
	content: string | (TextContent | ImageContent)[],
	display: boolean,
	details: unknown | undefined,
	timestamp: string,
	attribution?: MessageAttribution,
): CustomMessage {
	return {
		role: "custom",
		customType,
		content,
		display,
		details,
		attribution,
		timestamp: new Date(timestamp).getTime(),
	};
}

/**
 * Repair tool_use / tool_result ordering in converted LLM messages.
 *
 * The Claude API requires every assistant message containing tool_use blocks
 * to be immediately followed by the matching tool_result messages. Session
 * corruption (injected messages, compaction boundaries, crash during tool
 * execution) can break this invariant, producing a 400 error that bricks
 * the session.
 *
 * This function:
 * 1. Finds assistant messages with tool_use (toolCall) content
 * 2. Collects the required tool_result IDs
 * 3. If tool_results are elsewhere in the array, moves them to the correct position
 * 4. If tool_results are missing entirely, injects synthetic error tool_results
 * 5. Non-tool messages that got wedged between tool_use and tool_result are relocated
 *    to just before the assistant message
 */
function repairToolResultOrdering(messages: Message[]): Message[] {
	const result: Message[] = [];
	let repaired = false;

	// Index all toolResult messages by their toolCallId for O(1) lookup
	const toolResultsByCallId = new Map<string, { message: Message; originalIndex: number }>();
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "toolResult") {
			const trMsg = msg as ToolResultMessage;
			toolResultsByCallId.set(trMsg.toolCallId, { message: msg, originalIndex: i });
		}
	}

	// Track which message indices have been consumed (placed or displaced) by repair
	const consumedIndices = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		// Skip toolResult messages that were already consumed (placed elsewhere or displaced)
		if (msg.role === "toolResult" && consumedIndices.has(i)) {
			continue;
		}

		result.push(msg);

		// Not an assistant message with tool calls — nothing to repair
		if (msg.role !== "assistant") continue;
		const assistantMsg = msg as AssistantMessage;
		const toolCalls = assistantMsg.content.filter((c): c is ToolCall => c.type === "toolCall");
		if (toolCalls.length === 0) continue;

		// Collect required tool call IDs
		const requiredIds = new Set(toolCalls.map(tc => tc.id));

		// Check what immediately follows in the remaining messages
		// Consume consecutive toolResult messages that match, and relocate any
		// non-toolResult messages that got wedged between
		const displaced: Message[] = [];
		let j = i + 1;
		while (j < messages.length && requiredIds.size > 0) {
			const next = messages[j];
			if (next.role === "toolResult") {
				const trMsg = next as ToolResultMessage;
				if (requiredIds.has(trMsg.toolCallId)) {
					// This tool_result belongs here — place it
					result.push(next);
					consumedIndices.add(j);
					requiredIds.delete(trMsg.toolCallId);
					if (displaced.length > 0) repaired = true;
					j++;
					continue;
				}
			}
			// Non-matching message between tool_use and tool_result — displace it
			displaced.push(next);
			consumedIndices.add(j); // Mark original index as consumed
			j++;
		}

		// Advance main iterator past consumed messages
		i = j - 1;

		// Any remaining required IDs: find them later in the array or synthesize
		for (const id of requiredIds) {
			const found = toolResultsByCallId.get(id);
			if (found && !consumedIndices.has(found.originalIndex)) {
				result.push(found.message);
				consumedIndices.add(found.originalIndex);
				repaired = true;
			} else {
				// Missing tool_result entirely — inject synthetic error result
				const toolCall = toolCalls.find(tc => tc.id === id);
				result.push({
					role: "toolResult",
					toolCallId: id,
					toolName: toolCall?.name ?? "unknown",
					content: [{ type: "text", text: "Tool execution was interrupted (session recovery)." }],
					isError: true,
					timestamp: Date.now(),
				} as ToolResultMessage);
				repaired = true;
			}
		}

		// Re-insert displaced messages after the tool_results
		for (const d of displaced) {
			result.push(d);
		}
	}

	// Second pass: repair displaced assistant messages whose tool calls were never processed.
	// When an assistant-with-tool-calls gets displaced (wedged between another assistant's
	// tool_use and its tool_result), the first pass pushes it to result but the outer loop
	// jumps past it — so its own tool_results are never resolved.
	//
	// Uses a non-mutating rebuild to avoid index corruption from splice-during-iteration
	// (the prior splice approach corrupted indices in long conversations with 1000+ messages).
	const indicesToRemove = new Set<number>();
	const insertions: Array<{ afterIndex: number; messages: ToolResultMessage[] }> = [];

	for (let i = 0; i < result.length; i++) {
		const msg = result[i];
		if (msg.role !== "assistant") continue;
		const assistantMsg = msg as AssistantMessage;
		const toolCalls = assistantMsg.content.filter((c): c is ToolCall => c.type === "toolCall");
		if (toolCalls.length === 0) continue;

		const expectedIds = new Set(toolCalls.map(tc => tc.id));
		let j = i + 1;
		while (j < result.length && result[j].role === "toolResult") {
			expectedIds.delete((result[j] as ToolResultMessage).toolCallId);
			j++;
		}

		if (expectedIds.size === 0) continue;

		const toInsert: ToolResultMessage[] = [];
		for (const id of expectedIds) {
			const laterIndex = result.findIndex(
				(m, idx) =>
					idx > j &&
					!indicesToRemove.has(idx) &&
					m.role === "toolResult" &&
					(m as ToolResultMessage).toolCallId === id,
			);
			if (laterIndex !== -1) {
				toInsert.push(result[laterIndex] as ToolResultMessage);
				indicesToRemove.add(laterIndex);
			} else {
				const toolCall = toolCalls.find(tc => tc.id === id);
				toInsert.push({
					role: "toolResult",
					toolCallId: id,
					toolName: toolCall?.name ?? "unknown",
					content: [{ type: "text", text: "Tool execution was interrupted (session recovery)." }],
					isError: true,
					timestamp: Date.now(),
				} as ToolResultMessage);
			}
		}
		if (toInsert.length > 0) {
			insertions.push({ afterIndex: i, messages: toInsert });
			repaired = true;
		}
	}

	if (insertions.length > 0 || indicesToRemove.size > 0) {
		const rebuilt: Message[] = [];
		const insertionMap = new Map(insertions.map(ins => [ins.afterIndex, ins.messages]));
		for (let i = 0; i < result.length; i++) {
			if (!indicesToRemove.has(i)) {
				rebuilt.push(result[i]);
			}
			const ins = insertionMap.get(i);
			if (ins) {
				rebuilt.push(...ins);
			}
		}
		result.length = 0;
		result.push(...rebuilt);
	}

	if (repaired) {
		logger.warn("Repaired tool_use/tool_result ordering in conversation history");
	}

	return repaired ? result : messages;
}

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom extensions and tools
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
	const converted = messages
		.map((m): Message | undefined => {
			switch (m.role) {
				case "bashExecution":
					if (m.excludeFromContext) {
						return undefined;
					}
					return {
						role: "user",
						content: [{ type: "text", text: bashExecutionToText(m) }],
						attribution: "user",
						timestamp: m.timestamp,
					};
				case "pythonExecution":
					if (m.excludeFromContext) {
						return undefined;
					}
					return {
						role: "user",
						content: [{ type: "text", text: pythonExecutionToText(m) }],
						attribution: "user",
						timestamp: m.timestamp,
					};
				case "custom":
				case "hookMessage": {
					const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
					const role = "user";
					const attribution = m.attribution;
					return {
						role,
						content,
						attribution,
						timestamp: m.timestamp,
					};
				}
				case "branchSummary":
					return {
						role: "user",
						content: [
							{
								type: "text" as const,
								text: prompt.render(BRANCH_SUMMARY_TEMPLATE, { summary: m.summary }),
							},
						],
						attribution: "agent",
						timestamp: m.timestamp,
					};
				case "compactionSummary":
					return {
						role: "user",
						content: [
							{
								type: "text" as const,
								text: prompt.render(COMPACTION_SUMMARY_TEMPLATE, { summary: m.summary }),
							},
						],
						attribution: "agent",
						providerPayload: m.providerPayload,
						timestamp: m.timestamp,
					};
				case "fileMention": {
					const fileContents = m.files
						.map(file => {
							const inner = file.content ? `\n${file.content}\n` : "\n";
							return `<file path="${file.path}">${inner}</file>`;
						})
						.join("\n\n");
					const content: (TextContent | ImageContent)[] = [
						{ type: "text" as const, text: `<system-reminder>\n${fileContents}\n</system-reminder>` },
					];
					for (const file of m.files) {
						if (file.image) {
							content.push(file.image);
						}
					}
					return {
						role: "user",
						content,
						attribution: "user",
						timestamp: m.timestamp,
					};
				}
				case "user":
					return { ...m, attribution: m.attribution ?? "user" };
				case "developer":
					return { ...m, attribution: m.attribution ?? "agent" };
				case "assistant":
					return m;
				case "toolResult":
					return {
						...m,
						content: getPrunedToolResultContent(m as ToolResultMessage),
						attribution: m.attribution ?? "agent",
					};
				default:
					// biome-ignore lint/correctness/noSwitchDeclarations: fine
					const _exhaustiveCheck: never = m;
					return undefined;
			}
		})
		.filter(m => m !== undefined);
	const repaired = repairToolResultOrdering(converted);
	return mergeConsecutiveUserTextMessages(repaired);
}

/**
 * Merge consecutive user messages that contain only text into single messages.
 * The Claude API internally merges consecutive same-role messages before validation,
 * which shifts message indices. Pre-merging here keeps xcsh's indices aligned with
 * the API's view, preventing phantom index mismatches in error reports.
 */
function mergeConsecutiveUserTextMessages(messages: Message[]): Message[] {
	if (messages.length < 2) return messages;

	const result: Message[] = [messages[0]];
	for (let i = 1; i < messages.length; i++) {
		const prev = result[result.length - 1];
		const curr = messages[i];

		if (
			prev.role === "user" &&
			curr.role === "user" &&
			Array.isArray(prev.content) &&
			Array.isArray(curr.content) &&
			prev.content.every(c => c.type === "text") &&
			curr.content.every(c => c.type === "text")
		) {
			result[result.length - 1] = {
				...prev,
				content: [...prev.content, ...curr.content],
			};
		} else {
			result.push(curr);
		}
	}
	return result;
}
