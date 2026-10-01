/**
 * Generate session titles using a smol, fast model.
 */

import * as path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Api, Model } from "@f5-sales-demo/pi-ai";
import { completeSimple } from "@f5-sales-demo/pi-ai";
import { logger, prompt } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import titleSystemPrompt from "../prompts/system/title-system.md" with { type: "text" };
import type { AutomaticTitleState, SessionEntry } from "../session/session-manager";
import { toReasoningEffort } from "../thinking";

const TITLE_SYSTEM_PROMPT = prompt.render(titleSystemPrompt);

const DEFAULT_TERMINAL_TITLE = "π";
const TERMINAL_TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
export const RESERVED_PROVISIONAL_TITLE = "New Realtime Voice Chat";
export const MAX_TITLE_INPUT_BYTES = 960;
export const MAX_TITLE_CHARACTERS = 36;

export function truncateTitleSource(value: string, maxBytes = MAX_TITLE_INPUT_BYTES): string {
	let bytes = 0;
	let result = "";
	for (const character of value) {
		const size = Buffer.byteLength(character);
		if (bytes + size > maxBytes) break;
		result += character;
		bytes += size;
	}
	return result;
}

export function sanitizeGeneratedSessionTitle(value: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	if (Object.keys(record).some(key => key !== "title" && key !== "provisional") || typeof record.title !== "string")
		return null;
	if ("provisional" in record && typeof record.provisional !== "boolean") return null;
	const sanitized = record.title.replace(TERMINAL_TITLE_CONTROL_CHARS, "").replace(/\s+/gu, " ").trim();
	if (!sanitized) return null;
	return [...sanitized].slice(0, MAX_TITLE_CHARACTERS).join("").trim() || null;
}

function getTitleModels(
	registry: ModelRegistry,
	settings: Settings,
	currentModel?: Model<Api>,
): Array<{ model: Model<Api>; thinkingLevel?: ThinkingLevel }> {
	const availableModels = registry.getAvailable();
	const titleModel = resolveRoleSelection(["commit", "smol"], settings, availableModels, registry);
	const candidates: Array<{ model: Model<Api>; thinkingLevel?: ThinkingLevel }> = [];
	if (titleModel) candidates.push({ model: titleModel.model, thinkingLevel: titleModel.thinkingLevel });
	if (
		currentModel &&
		!candidates.some(
			candidate => candidate.model.provider === currentModel.provider && candidate.model.id === currentModel.id,
		)
	)
		candidates.push({ model: currentModel });
	return candidates;
}

const TITLE_TOOL_NAME = "submit_title";
const TITLE_TOOL = {
	name: TITLE_TOOL_NAME,
	description: "Return the generated session title as strict JSON.",
	strict: true,
	parameters: Type.Object(
		{ title: Type.String({ maxLength: MAX_TITLE_CHARACTERS }), provisional: Type.Boolean() },
		{ additionalProperties: false },
	),
} as const;

/**
 * Generate a session name and model-judged provisional status from completed conversation data.
 *
 * @param firstMessage Serialized completed exchanges
 * @param registry Model registry
 * @param settings Settings used to resolve the smol role, including per-role thinking
 * @param sessionId Optional session id for sticky API key selection
 */
async function generateSessionName(
	firstMessage: string,
	registry: ModelRegistry,
	settings: Settings,
	sessionId?: string,
	currentModel?: Model<Api>,
): Promise<GeneratedSessionName | null> {
	const candidates = getTitleModels(registry, settings, currentModel);
	if (candidates.length === 0) {
		logger.debug("title-generator: no title model found");
		return null;
	}

	const truncatedMessage = truncateTitleSource(firstMessage);
	const userMessage = `<user-message>
${truncatedMessage}
</user-message>`;

	for (const [attempt, candidate] of candidates.entries()) {
		const model = `${candidate.model.provider}/${candidate.model.id}`;
		logger.debug("title-generator: request", {
			model,
			attempt: attempt + 1,
			sourceBytes: Buffer.byteLength(truncatedMessage),
			sourceTruncated: truncatedMessage !== firstMessage,
		});
		try {
			const apiKey = await registry.getApiKey(candidate.model, sessionId);
			if (!apiKey) {
				logger.debug("title-generator: no API key for title model", {
					provider: candidate.model.provider,
					id: candidate.model.id,
					attempt: attempt + 1,
				});
				continue;
			}
			const response = await completeSimple(
				candidate.model,
				{
					systemPrompt: TITLE_SYSTEM_PROMPT,
					messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
					tools: [TITLE_TOOL],
				},
				{
					apiKey,
					maxTokens: 80,
					reasoning: toReasoningEffort(candidate.thinkingLevel),
					toolChoice: { type: "tool", name: TITLE_TOOL_NAME },
				},
			);

			if (response.stopReason === "error" || response.stopReason === "aborted") {
				logger.debug("title-generator: response error", {
					model,
					attempt: attempt + 1,
					stopReason: response.stopReason,
				});
				continue;
			}

			const toolCalls = response.content.filter(content => content.type === "toolCall");
			const payload =
				toolCalls.length === 1 && toolCalls[0]!.name === TITLE_TOOL_NAME
					? (JSON.stringify(toolCalls[0]!.arguments) ?? "")
					: toolCalls.length === 0
						? response.content
								.filter(content => content.type === "text")
								.map(content => content.text)
								.join("")
								.trim()
						: "";
			const title = sanitizeGeneratedSessionTitle(payload);
			const provisional = title ? (JSON.parse(payload) as { provisional?: boolean }).provisional : undefined;

			logger.debug("title-generator: response", {
				model,
				attempt: attempt + 1,
				title,
				titleAccepted: title !== null,
				titleCharacters: title ? [...title].length : 0,
				stopReason: response.stopReason,
			});
			if (title && typeof provisional === "boolean") return { title, provisional };
		} catch (err) {
			logger.debug("title-generator: error", {
				model,
				attempt: attempt + 1,
				errorType: err instanceof Error ? err.name : "unknown",
			});
		}
	}
	return null;
}

export interface GeneratedSessionName {
	title: string;
	provisional: boolean;
}

/** Compatibility helper for consumers needing only the generated string. */
export async function generateSessionTitle(...args: Parameters<typeof generateSessionName>): Promise<string | null> {
	return (await generateSessionName(...args))?.title ?? null;
}

interface SessionTitleManager {
	getSessionName?(): string | undefined;
	getBranch?(): SessionEntry[];
	getAutomaticTitleState?(): AutomaticTitleState | undefined;
	readonly titleSource?: "auto" | "user";
	readonly titleRevision?: number;
	setAutomaticSessionName?(
		name: string,
		state: AutomaticTitleState,
		sessionId: string,
		revision: number,
	): Promise<boolean>;
}
interface SessionTitleTarget {
	sessionId: string;
	sessionName?: string;
	messages?: AgentMessage[];
	model?: Model<Api>;
	modelRegistry: ModelRegistry;
	settings: Settings;
	sessionManager: SessionTitleManager;
	setSessionName(name: string, source: "auto" | "user"): Promise<boolean>;
}
export interface CompletedTitleExchange {
	id: string;
	user: string;
	assistant: string;
}

function messageText(message: { content?: unknown }): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter(part => part?.type === "text")
		.map(part => part.text)
		.join("\n");
}

/** Read finalized conversation records, never transport deltas, closure tails, or delegation wrappers. */
export function completedTitleExchanges(entries: SessionEntry[]): CompletedTitleExchange[] {
	const exchanges: CompletedTitleExchange[] = [];
	let user: { id: string; text: string } | undefined;
	let delegated = false;
	for (const entry of entries) {
		let role: string | undefined;
		let text = "";
		if (entry.type === "message") {
			const message = entry.message;
			role = message.role;
			if (message.role !== "user" && message.role !== "assistant") continue;
			if (message.role === "user" && message.attribution === "agent") continue;
			text = messageText(message);
			if (role === "user") delegated = text.trim().startsWith("<realtime_delegation>");
			if (delegated) continue;
			if (
				message.role === "assistant" &&
				(message.stopReason === "error" ||
					message.stopReason === "aborted" ||
					message.content.some(part => part.type === "toolCall"))
			) {
				if (
					(message.stopReason === "error" || message.stopReason === "aborted") &&
					exchanges.at(-1)?.id === user?.id
				)
					exchanges.pop();
				continue;
			}
		} else if (entry.type === "custom" && entry.customType === "remote-realtime") {
			const record = entry.data as Record<string, unknown> | undefined;
			if (record?.kind !== "transcript" || typeof record.text !== "string") continue;
			delegated = false;
			role = String(record.role);
			text = record.text;
		}
		if (!text.trim()) continue;
		if (role === "user") user = { id: entry.id, text };
		else if (role === "assistant" && user) {
			const exchange = { id: user.id, user: user.text, assistant: text };
			if (exchanges.at(-1)?.id === user.id) exchanges[exchanges.length - 1] = exchange;
			else exchanges.push(exchange);
		}
	}
	return exchanges;
}

function titleSource(exchanges: CompletedTitleExchange[], currentName?: string): string {
	// Bound the serialized payload, including escapes, while retaining both sides of the latest exchange.
	const recent = exchanges.slice(-3);
	for (let budget = 120; budget >= 0; budget -= 10) {
		const source = JSON.stringify({
			currentTitle: currentName,
			exchanges: recent.map(exchange => ({
				user: truncateTitleSource(exchange.user, budget),
				assistant: truncateTitleSource(exchange.assistant, budget),
			})),
		});
		if (Buffer.byteLength(source) <= MAX_TITLE_INPUT_BYTES) return source;
	}
	return JSON.stringify({ currentTitle: currentName });
}

type TitleGenerator = typeof generateSessionName;
interface TitleFlight {
	promise: Promise<string | null>;
}
interface TitleCoordinator {
	flights: Map<string, TitleFlight>;
	listeners: Set<(title: string) => void>;
}
const titleCoordinators = new WeakMap<object, TitleCoordinator>();
function titleCoordinator(manager: object): TitleCoordinator {
	let state = titleCoordinators.get(manager);
	if (!state) {
		state = { flights: new Map(), listeners: new Set() };
		titleCoordinators.set(manager, state);
	}
	return state;
}
export function subscribeSessionTitle(manager: object, listener: (title: string) => void): () => void {
	const state = titleCoordinator(manager);
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}

export function coordinateSessionTitle(
	target: SessionTitleTarget,
	generate: TitleGenerator = generateSessionName,
): Promise<string | null> {
	const manager = target.sessionManager;
	const state = titleCoordinator(manager as object);
	const sessionId = target.sessionId;
	const existing = state.flights.get(sessionId);
	if (existing) return existing.promise;
	const currentName = manager.getSessionName?.() ?? target.sessionName;
	const automatic = manager.getAutomaticTitleState?.();
	if (
		process.env.PI_NO_TITLE ||
		manager.titleSource === "user" ||
		(currentName && automatic?.status !== "provisional")
	)
		return Promise.resolve(null);
	const history = () =>
		manager.getBranch?.() ??
		(target.messages ?? []).map((message, index) => ({
			type: "message" as const,
			id: `${index}:${message.timestamp}`,
			parentId: null,
			timestamp: new Date(message.timestamp).toISOString(),
			message,
		}));
	const exchanges = completedTitleExchanges(history());
	const latest = exchanges.at(-1);
	if (!latest || automatic?.exchangeId === latest.id || !manager.setAutomaticSessionName) return Promise.resolve(null);
	const revision = manager.titleRevision ?? 0;
	const source = titleSource(exchanges, currentName);
	const pending = generate(source, target.modelRegistry, target.settings, sessionId, target.model)
		.then(async result => {
			if (!result || target.sessionId !== sessionId || manager.titleRevision !== revision) return null;
			// A still-generic refinement candidate must not replace the opening name or consume its one refinement.
			if (currentName && result.provisional) {
				await manager.setAutomaticSessionName!(
					currentName,
					{ status: "provisional", exchangeId: latest.id },
					sessionId,
					revision,
				);
				return null;
			}
			const title = sanitizeGeneratedSessionTitle(JSON.stringify({ title: result.title }));
			if (
				!title ||
				!(await manager.setAutomaticSessionName!(
					title,
					{
						status: result.provisional ? "provisional" : "refined",
						exchangeId: latest.id,
					},
					sessionId,
					revision,
				))
			)
				return null;
			if (target.sessionId !== sessionId || manager.titleRevision !== revision + 1) return null;
			for (const listener of state.listeners)
				try {
					listener(title);
				} catch {
					/* Presentation-only. */
				}
			return title;
		})
		.catch(() => null)
		.finally(() => {
			if (state.flights.get(sessionId)?.promise === pending) state.flights.delete(sessionId);
			// Another exchange may finish during inference. Retry only for new history, never for a failed request.
			if (target.sessionId === sessionId && completedTitleExchanges(history()).at(-1)?.id !== latest.id)
				void coordinateSessionTitle(target, generate);
		});
	state.flights.set(sessionId, { promise: pending });
	return pending;
}

/**
 * Remove control characters so model-generated titles cannot inject terminal escapes.
 */
function sanitizeTerminalTitlePart(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const sanitized = value.replace(TERMINAL_TITLE_CONTROL_CHARS, "").trim();
	return sanitized || undefined;
}

function getFallbackTerminalTitle(cwd: string | undefined): string | undefined {
	if (!cwd) return undefined;
	const resolvedCwd = path.resolve(cwd);
	const baseName = path.basename(resolvedCwd);
	if (!baseName || baseName === path.parse(resolvedCwd).root) return undefined;
	return sanitizeTerminalTitlePart(baseName);
}

export function formatSessionTerminalTitle(
	sessionName: string | undefined,
	cwd?: string,
	titleSource?: "auto" | "user" | undefined,
): string {
	const label =
		sanitizeTerminalTitlePart(titleSource === "auto" ? undefined : sessionName) ?? getFallbackTerminalTitle(cwd);
	return label ? `${DEFAULT_TERMINAL_TITLE}: ${label}` : DEFAULT_TERMINAL_TITLE;
}

/**
 * Set the terminal title using OSC 0 (sets both tab and window title). Unsupported terminals ignore it.
 */
export function setTerminalTitle(title: string): void {
	process.stdout.write(`\x1b]0;${sanitizeTerminalTitlePart(title) ?? DEFAULT_TERMINAL_TITLE}\x07`);
}

export function setSessionTerminalTitle(
	sessionName: string | undefined,
	cwd?: string,
	titleSource?: "auto" | "user" | undefined,
): void {
	setTerminalTitle(formatSessionTerminalTitle(sessionName, cwd, titleSource));
}

/**
 * Save the current terminal title on terminals that support xterm window ops.
 */
export function pushTerminalTitle(): void {
	process.stdout.write("\x1b[22;2t");
}

/**
 * Restore the previously saved terminal title on terminals that support xterm window ops.
 */
export function popTerminalTitle(): void {
	process.stdout.write("\x1b[23;2t");
}
