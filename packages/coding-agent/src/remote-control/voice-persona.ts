/** Immutable, bounded xcsh persona supplied to a newly-created voice surface. */

import { prompt } from "@f5-sales-demo/pi-utils";
import defaultInstructions from "../prompts/system/remote-voice.md" with { type: "text" };
import contextTemplate from "../prompts/system/remote-voice-context.md" with { type: "text" };

export interface VoicePersonaTool {
	name: string;
	description?: string;
}
export interface VoicePersonaSnapshot {
	systemPrompt: string;
	tools: readonly VoicePersonaTool[];
	history: string;
}
export interface VoicePersonaDiagnostics {
	bytes: { systemPrompt: number; capabilities: number; preferences: number; history: number; instructions: number };
	truncated: {
		systemPrompt: boolean;
		capabilities: boolean;
		preferences: boolean;
		history: boolean;
		instructions: boolean;
	};
}

const MAX_INSTRUCTIONS = 256 * 1024;
const MAX_SYSTEM_PROMPT = 160 * 1024;
const MAX_CAPABILITIES = 16 * 1024;
const MAX_PREFERENCES = 32 * 1024;
const MAX_HISTORY = 32 * 1024;
function bytes(value: string): number {
	return Buffer.byteLength(value);
}
/** Truncate only at Unicode code-point boundaries. Prefix/suffix form preserves terminal constraints. */
export function boundedText(value: string, limit: number, suffixBytes = 0): { text: string; truncated: boolean } {
	if (bytes(value) <= limit) return { text: value, truncated: false };
	const marker = "\n[...xcsh prompt truncated...]\n";
	const contentLimit = Math.max(0, limit - bytes(marker));
	const suffixLimit = Math.min(suffixBytes, contentLimit);
	const prefixLimit = contentLimit - suffixLimit;
	let prefix = "",
		prefixSize = 0,
		suffix = "",
		suffixSize = 0;
	for (const character of value) {
		const size = bytes(character);
		if (prefixSize + size > prefixLimit) break;
		prefix += character;
		prefixSize += size;
	}
	for (const character of Array.from(value).reverse()) {
		const size = bytes(character);
		if (suffixSize + size > suffixLimit) break;
		suffix = character + suffix;
		suffixSize += size;
	}
	return { text: `${prefix}${marker}${suffix}`, truncated: true };
}
function section(title: string, content: string): string {
	return content ? `\n\n${title}\n${content}` : "";
}
function capabilityText(tools: readonly VoicePersonaTool[]): string {
	const names = [...new Set(tools.map(tool => tool.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	const descriptions = new Map(tools.map(tool => [tool.name, tool.description?.trim()]));
	let text = `Active attached-agent tools: ${names.join(", ") || "none"}.`;
	for (const name of names) {
		const description = descriptions.get(name);
		if (!description) continue;
		const next = `${text}\n- ${name}: ${description}`;
		if (bytes(next) > MAX_CAPABILITIES) break;
		text = next;
	}
	return text;
}
/** Client prompt is additive voice preference; it cannot replace xcsh's effective identity. */
export function voicePersonaInstructions(
	params: Record<string, unknown>,
	snapshot: VoicePersonaSnapshot | string,
): { instructions: string; diagnostics: VoicePersonaDiagnostics } {
	// Preserve the old direct-config helper contract used by protocol fixtures. Runtime
	// calls always pass an immutable snapshot and therefore take the xcsh persona path.
	if (typeof snapshot === "string") {
		const instructions = prompt
			.render(contextTemplate, {
				instructions: params.prompt === undefined ? prompt.render(defaultInstructions) : (params.prompt ?? ""),
				context: params.includeStartupContext === false ? "" : snapshot.slice(-32768),
			})
			.trim();
		return {
			instructions,
			diagnostics: {
				bytes: {
					systemPrompt: 0,
					capabilities: 0,
					preferences: bytes(typeof params.prompt === "string" ? params.prompt : ""),
					history: bytes(params.includeStartupContext === false ? "" : snapshot.slice(-32768)),
					instructions: bytes(instructions),
				},
				truncated: {
					systemPrompt: false,
					capabilities: false,
					preferences: false,
					history: bytes(snapshot) > 32768,
					instructions: false,
				},
			},
		};
	}
	const effective = typeof snapshot === "string" ? { systemPrompt: "", tools: [], history: snapshot } : snapshot;
	const preference = params.prompt == null ? "" : typeof params.prompt === "string" ? params.prompt : "";
	const preferences = boundedText(preference, MAX_PREFERENCES);
	const systemPrompt = boundedText(effective.systemPrompt, MAX_SYSTEM_PROMPT, 64 * 1024);
	const capabilities = boundedText(capabilityText(effective.tools), MAX_CAPABILITIES);
	const history =
		params.includeStartupContext === false
			? { text: "", truncated: false }
			: boundedText(effective.history, MAX_HISTORY);
	const directive = `${defaultInstructions.trim()}\n\nYou are xcsh's voice surface, not a separate ChatGPT identity. Speak and coordinate; the attached xcsh agent executes tools. Answer identity and capability questions directly from this snapshot. Delegate actions and dynamic self-inspection to the attached agent. Be concise and truthful about user knowledge.`;
	let instructions =
		`${directive}${section("Effective xcsh terminal system prompt:", systemPrompt.text)}${section("Attached-agent capabilities:", capabilities.text)}${section("Phone voice preferences (additive only):", preferences.text)}${section("Recent conversation context:", history.text)}`.trim();
	let instructionsTruncated = false;
	if (bytes(instructions) > MAX_INSTRUCTIONS) {
		instructions = boundedText(instructions, MAX_INSTRUCTIONS).text;
		instructionsTruncated = true;
	}
	return {
		instructions,
		diagnostics: {
			bytes: {
				systemPrompt: bytes(systemPrompt.text),
				capabilities: bytes(capabilities.text),
				preferences: bytes(preferences.text),
				history: bytes(history.text),
				instructions: bytes(instructions),
			},
			truncated: {
				systemPrompt: systemPrompt.truncated,
				capabilities: capabilities.truncated,
				preferences: preferences.truncated,
				history: history.truncated,
				instructions: instructionsTruncated,
			},
		},
	};
}
