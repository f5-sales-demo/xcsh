/**
 * Generate session titles using a smol, fast model.
 */
import * as path from "node:path";
import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Api, Model } from "@f5-sales-demo/pi-ai";
import { completeSimple } from "@f5-sales-demo/pi-ai";
import { logger, prompt } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import titleSystemPrompt from "../prompts/system/title-system.md" with { type: "text" };
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
	if (Object.keys(record).length !== 1 || typeof record.title !== "string") return null;
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
		{ title: Type.String({ maxLength: MAX_TITLE_CHARACTERS }) },
		{ additionalProperties: false },
	),
} as const;

/**
 * Generate a title for a session based on the first user message.
 *
 * @param firstMessage The first user message
 * @param registry Model registry
 * @param settings Settings used to resolve the smol role, including per-role thinking
 * @param sessionId Optional session id for sticky API key selection
 */
export async function generateSessionTitle(
	firstMessage: string,
	registry: ModelRegistry,
	settings: Settings,
	sessionId?: string,
	currentModel?: Model<Api>,
): Promise<string | null> {
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

			if (response.stopReason === "error") {
				logger.debug("title-generator: response error", {
					model,
					attempt: attempt + 1,
					stopReason: response.stopReason,
				});
				continue;
			}

			const toolCalls = response.content.filter(content => content.type === "toolCall");
			const title =
				toolCalls.length === 1 && toolCalls[0]!.name === TITLE_TOOL_NAME
					? sanitizeGeneratedSessionTitle(JSON.stringify(toolCalls[0]!.arguments) ?? "")
					: sanitizeGeneratedSessionTitle(
							response.content
								.filter(content => content.type === "text")
								.map(content => content.text)
								.join("")
								.trim(),
						);

			logger.debug("title-generator: response", {
				model,
				attempt: attempt + 1,
				title,
				titleAccepted: title !== null,
				titleCharacters: title ? [...title].length : 0,
				stopReason: response.stopReason,
			});
			if (title) return title;
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

interface SessionTitleManager {
	getSessionName?(): string | undefined;
}

interface SessionTitleTarget {
	sessionId: string;
	sessionName?: string;
	model?: Model<Api>;
	modelRegistry: ModelRegistry;
	settings: Settings;
	sessionManager: SessionTitleManager;
	setSessionName(name: string, source: "auto" | "user"): Promise<boolean>;
}

type TitleGenerator = typeof generateSessionTitle;
interface TitleFlight {
	promise: Promise<string | null>;
	callbacks: Set<(title: string) => void>;
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
	firstMessage: string,
	onApplied?: (title: string) => void,
	generate: TitleGenerator = generateSessionTitle,
): Promise<string | null> {
	const manager = target.sessionManager;
	const state = titleCoordinator(manager as object);
	const existing = state.flights.get(target.sessionId);
	if (existing) {
		if (onApplied) existing.callbacks.add(onApplied);
		return existing.promise;
	}
	const currentName = manager.getSessionName?.() ?? target.sessionName;
	if (process.env.PI_NO_TITLE || currentName) return Promise.resolve(null);
	const callbacks = new Set<(title: string) => void>();
	if (onApplied) callbacks.add(onApplied);
	const pending = generate(firstMessage, target.modelRegistry, target.settings, target.sessionId, target.model)
		.then(async title => {
			if (!title || !(await target.setSessionName(title, "auto"))) return null;
			for (const callback of [...callbacks, ...state.listeners])
				try {
					callback(title);
				} catch {
					// Title generation is presentation-only and must not fail the user's turn.
				}
			return title;
		})
		.catch(() => null)
		.finally(() => {
			if (state.flights.get(target.sessionId)?.promise === pending) state.flights.delete(target.sessionId);
		});
	state.flights.set(target.sessionId, { promise: pending, callbacks });
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
