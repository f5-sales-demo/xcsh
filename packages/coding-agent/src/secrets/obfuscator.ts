import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage, Context, Message, Tool } from "@f5-sales-demo/pi-ai";
import type { SessionContext } from "../session/session-manager";
import { compileSecretRegex } from "./regex";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SecretEntry {
	type: "plain" | "regex";
	content: string;
	mode?: "obfuscate" | "replace";
	replacement?: string;
	flags?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic replacement generation
// ═══════════════════════════════════════════════════════════════════════════

const REPLACEMENT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a deterministic same-length replacement string from a secret value. */
function generateDeterministicReplacement(secret: string): string {
	// Simple hash: use Bun.hash for speed, seed from the secret bytes
	const hash = BigInt(Bun.hash(secret));
	const chars: string[] = [];
	let h = hash;
	for (let i = 0; i < secret.length; i++) {
		// Mix the hash for each character position
		h = h ^ (BigInt(i + 1) * 0x9e3779b97f4a7c15n);
		const idx = Number((h < 0n ? -h : h) % BigInt(REPLACEMENT_CHARS.length));
		chars.push(REPLACEMENT_CHARS[idx]);
	}
	return chars.join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder format
// ═══════════════════════════════════════════════════════════════════════════

const HASH_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HASH_LEN = 4;

/** Build an obfuscation placeholder for secret index N. Deterministic `#HASH#` token. */
function buildPlaceholder(index: number): string {
	let v = Bun.hash.xxHash32(String(index), 0x5345_4352);
	let tag = "#";
	for (let i = 0; i < HASH_LEN; i++) {
		tag += HASH_CHARS[v % HASH_CHARS.length];
		v = Math.floor(v / HASH_CHARS.length);
	}
	return `${tag}#`;
}

/** Regex to match obfuscation placeholders: #HASH# */
const PLACEHOLDER_RE = /#[A-Z0-9]{4}#/g;

// ═══════════════════════════════════════════════════════════════════════════
// SecretObfuscator
// ═══════════════════════════════════════════════════════════════════════════

export class SecretObfuscator {
	/** Plain secrets: secret → index (known at construction) */
	#plainMappings = new Map<string, number>();

	/** Regex entries (patterns compiled at construction) */
	#regexEntries: Array<{ regex: RegExp; mode: "obfuscate" | "replace"; replacement?: string }> = [];

	/** All obfuscate-mode mappings: index → { secret, placeholder } */
	#obfuscateMappings = new Map<number, { secret: string; placeholder: string }>();

	/** Replace-mode plain mappings: secret → replacement */
	#replaceMappings = new Map<string, string>();

	/** Reverse lookup for deobfuscation: placeholder → secret */
	#deobfuscateMap = new Map<string, string>();

	/** Next available index for regex match discoveries */
	#nextIndex: number;

	/** Whether any secrets were configured */
	#hasAny: boolean;

	constructor(entries: SecretEntry[]) {
		let index = 0;
		for (const entry of entries) {
			const mode = entry.mode ?? "obfuscate";

			if (entry.type === "plain") {
				if (mode === "obfuscate") {
					const placeholder = buildPlaceholder(index);
					this.#plainMappings.set(entry.content, index);
					this.#obfuscateMappings.set(index, { secret: entry.content, placeholder });
					this.#deobfuscateMap.set(placeholder, entry.content);
					index++;
				} else {
					// replace mode
					const replacement = entry.replacement ?? generateDeterministicReplacement(entry.content);
					this.#replaceMappings.set(entry.content, replacement);
				}
			} else {
				// regex type — compiled here, matches discovered during obfuscate()
				try {
					const regex = compileSecretRegex(entry.content, entry.flags);
					this.#regexEntries.push({ regex, mode, replacement: entry.replacement });
				} catch {
					// Invalid regex — skip silently (validation happens at load time)
				}
			}
		}

		this.#nextIndex = index;
		this.#hasAny = entries.length > 0;
	}

	hasSecrets(): boolean {
		return this.#hasAny;
	}

	/** Register additional plain secrets after construction (e.g. after profile switch). */
	addPlainSecrets(values: string[]): void {
		for (const value of values) {
			if (!value || this.#plainMappings.has(value)) continue;
			const index = this.#nextIndex++;
			const placeholder = buildPlaceholder(index);
			this.#plainMappings.set(value, index);
			this.#obfuscateMappings.set(index, { secret: value, placeholder });
			this.#deobfuscateMap.set(placeholder, value);
			this.#hasAny = true;
		}
	}

	/** Obfuscate all secrets in text. Bidirectional placeholders for obfuscate mode, one-way for replace. */
	obfuscate(text: string): string {
		if (!this.#hasAny) return text;
		let result = text;

		// 1. Process replace-mode plain secrets
		for (const [secret, replacement] of [...this.#replaceMappings].sort((a, b) => b[0].length - a[0].length)) {
			result = replaceAll(result, secret, replacement);
		}

		// 2. Process obfuscate-mode plain secrets
		for (const [secret, index] of [...this.#plainMappings].sort((a, b) => b[0].length - a[0].length)) {
			const mapping = this.#obfuscateMappings.get(index)!;
			result = replaceAll(result, secret, mapping.placeholder);
		}

		// 3. Process regex entries — discover new matches
		for (const entry of this.#regexEntries) {
			entry.regex.lastIndex = 0;
			const matches = new Set<string>();
			for (;;) {
				const match = entry.regex.exec(result);
				if (match === null) break;
				if (match[0].length === 0) {
					entry.regex.lastIndex++;
					continue;
				}
				matches.add(match[0]);
			}

			for (const matchValue of matches) {
				if (entry.mode === "replace") {
					const replacement = entry.replacement ?? generateDeterministicReplacement(matchValue);
					result = replaceAll(result, matchValue, replacement);
				} else {
					// obfuscate mode — get or create stable index
					let index = this.#findObfuscateIndex(matchValue);
					if (index === undefined) {
						index = this.#nextIndex++;
						const placeholder = buildPlaceholder(index);
						this.#obfuscateMappings.set(index, { secret: matchValue, placeholder });
						this.#deobfuscateMap.set(placeholder, matchValue);
					}
					const mapping = this.#obfuscateMappings.get(index)!;
					result = replaceAll(result, matchValue, mapping.placeholder);
				}
			}
		}

		return result;
	}

	/** Deobfuscate obfuscate-mode placeholders back to original secrets. Replace-mode is NOT reversed. */
	deobfuscate(text: string): string {
		if (!this.#hasAny || !text.includes("#")) return text;
		return text.replace(PLACEHOLDER_RE, match => {
			return this.#deobfuscateMap.get(match) ?? match;
		});
	}

	/** Deep-walk an object, deobfuscating all string values. */
	deobfuscateObject<T>(obj: T): T {
		if (!this.#hasAny) return obj;
		return deepWalkStrings(obj, s => this.deobfuscate(s));
	}

	/** Deep-walk an object, obfuscating every string value. */
	obfuscateObject<T>(obj: T): T {
		if (!this.#hasAny) return obj;
		return deepWalkStrings(obj, s => this.obfuscate(s));
	}

	/** Find the obfuscate index for a known secret value. */
	#findObfuscateIndex(secret: string): number | undefined {
		// Check plain mappings first
		const plainIndex = this.#plainMappings.get(secret);
		if (plainIndex !== undefined) return plainIndex;

		// Check regex-discovered mappings
		for (const [index, mapping] of this.#obfuscateMappings) {
			if (mapping.secret === secret) return index;
		}
		return undefined;
	}
}

export function deobfuscateSessionContext(
	sessionContext: SessionContext,
	obfuscator: SecretObfuscator | undefined,
): SessionContext {
	if (!obfuscator?.hasSecrets()) return sessionContext;
	const messages = deobfuscateAgentMessages(obfuscator, sessionContext.messages);
	return messages === sessionContext.messages ? sessionContext : { ...sessionContext, messages };
}

export function deobfuscateAgentMessages(obfuscator: SecretObfuscator, messages: AgentMessage[]): AgentMessage[] {
	let changed = false;
	const result = messages.map((message): AgentMessage => {
		if (message.role === "assistant") {
			const content = deobfuscateAssistantContent(obfuscator, message.content);
			if (content === message.content) return message;
			changed = true;
			return { ...message, content };
		}
		if (message.role === "branchSummary") {
			const summary = obfuscator.deobfuscate(message.summary);
			if (summary === message.summary) return message;
			changed = true;
			return { ...message, summary };
		}
		if (message.role === "compactionSummary") {
			const summary = obfuscator.deobfuscate(message.summary);
			const shortSummary = message.shortSummary && obfuscator.deobfuscate(message.shortSummary);
			if (summary === message.summary && shortSummary === message.shortSummary) return message;
			changed = true;
			return { ...message, summary, shortSummary };
		}
		return message;
	});
	return changed ? result : messages;
}

/** Restore local-display fields while preserving opaque provider reasoning byte-for-byte. */
export function deobfuscateAssistantContent(
	obfuscator: SecretObfuscator,
	content: AssistantMessage["content"],
): AssistantMessage["content"] {
	if (!obfuscator.hasSecrets()) return content;
	let changed = false;
	const result = content.map((block): AssistantMessage["content"][number] => {
		if (block.type === "text") {
			const text = obfuscator.deobfuscate(block.text);
			if (text === block.text) return block;
			changed = true;
			return { ...block, text };
		}
		if (block.type === "toolCall") {
			const args = obfuscator.deobfuscateObject(block.arguments);
			const intent = block.intent === undefined ? undefined : obfuscator.deobfuscate(block.intent);
			if (args === block.arguments && intent === block.intent) return block;
			changed = true;
			return { ...block, arguments: args, intent };
		}
		return block;
	});
	return changed ? result : content;
}

// ═══════════════════════════════════════════════════════════════════════════
// Message obfuscation (outbound to LLM)
// ═══════════════════════════════════════════════════════════════════════════

/** Obfuscate every provider-visible string in outbound messages. */
export function obfuscateMessages(obfuscator: SecretObfuscator, messages: Message[]): Message[] {
	return obfuscator.obfuscateObject(messages);
}

/** Obfuscate the final provider context without mutating live agent state. */
export function obfuscateProviderContext(obfuscator: SecretObfuscator | undefined, context: Context): Context {
	if (!obfuscator?.hasSecrets()) return context;
	return {
		...context,
		systemPrompt: context.systemPrompt === undefined ? undefined : obfuscator.obfuscate(context.systemPrompt),
		messages: obfuscateMessages(obfuscator, context.messages),
		tools: obfuscateProviderTools(obfuscator, context.tools),
	};
}

/** Clone provider tool definitions and obfuscate descriptions and JSON schemas. */
export function obfuscateProviderTools(
	obfuscator: SecretObfuscator | undefined,
	tools: Tool[] | undefined,
): Tool[] | undefined {
	if (!tools || !obfuscator?.hasSecrets()) return tools;
	return tools.map(tool => ({
		...tool,
		description: obfuscator.obfuscate(tool.description),
		parameters: obfuscator.obfuscateObject(tool.parameters),
	}));
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Replace all occurrences of `search` in `text` with `replacement`. */
function replaceAll(text: string, search: string, replacement: string): string {
	if (search.length === 0) return text;
	let result = text;
	let idx = result.indexOf(search);
	while (idx !== -1) {
		result = result.slice(0, idx) + replacement + result.slice(idx + search.length);
		idx = result.indexOf(search, idx + replacement.length);
	}
	return result;
}

/** Deep-walk an object, transforming all string values. */
function deepWalkStrings<T>(obj: T, transform: (s: string) => string): T {
	if (typeof obj === "string") {
		return transform(obj) as unknown as T;
	}
	if (Array.isArray(obj)) {
		let changed = false;
		const result = obj.map(item => {
			const transformed = deepWalkStrings(item, transform);
			if (transformed !== item) changed = true;
			return transformed;
		});
		return (changed ? result : obj) as unknown as T;
	}
	if (obj !== null && typeof obj === "object") {
		let changed = false;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(obj)) {
			const value = (obj as Record<string, unknown>)[key];
			const transformed = deepWalkStrings(value, transform);
			if (transformed !== value) changed = true;
			result[key] = transformed;
		}
		return (changed ? result : obj) as T;
	}
	return obj;
}
