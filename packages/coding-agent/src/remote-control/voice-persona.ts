import liveTemplate from "../prompts/system/remote-voice-live.md" with { type: "text" };
/** Immutable, bounded xcsh persona supplied to a newly-created voice surface. */

import { prompt } from "@f5-sales-demo/pi-utils";

export interface VoicePersonaTool {
	name: string;
}
export interface VoicePersonaSnapshot {
	tools: readonly VoicePersonaTool[];
	history: string;
}
export interface VoicePersonaDiagnostics {
	bytes: {
		capabilities: number;
		preferences: number;
		history: number;
		instructions: number;
	};
	truncated: {
		capabilities: boolean;
		preferences: boolean;
		history: boolean;
		instructions: boolean;
	};
}

// Keep server-managed instructions comfortably below the smallest documented
// Realtime context window (32k tokens) so voice turns retain operating room.
// This is a byte budget, not a claim about an OpenAI token-limit contract.
function bytes(value: string): number {
	return Buffer.byteLength(value);
}
/** Truncate only at Unicode code-point boundaries. Prefix/suffix form preserves terminal constraints. */
export function boundedText(value: string, limit: number, suffixBytes = 0): { text: string; truncated: boolean } {
	if (bytes(value) <= limit) return { text: value, truncated: false };
	const marker = "\n[...xcsh prompt truncated...]\n";
	if (limit <= 0) return { text: "", truncated: true };
	if (limit < bytes(marker)) {
		let text = "";
		for (const character of value) {
			if (bytes(text + character) > limit) break;
			text += character;
		}
		return { text, truncated: true };
	}
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
/** GPT-Live owns speech; the attached agent retains procedures and exposes capability names only. */
export function voicePersonaInstructions(
	params: Record<string, unknown>,
	snapshot: VoicePersonaSnapshot,
): { instructions: string; diagnostics: VoicePersonaDiagnostics } {
	const names = [...new Set(snapshot.tools.map(tool => tool.name).filter(Boolean))].sort();
	const included: string[] = [];
	for (const name of names) {
		if (bytes(included.concat(name).join(", ")) > 2048) break;
		included.push(name);
	}
	const capabilitiesTruncated = included.length < names.length;
	const capabilities = included.length
		? `Available attached-agent tools: ${included.join(", ")}.${capabilitiesTruncated ? " Additional capabilities can be checked by the attached agent." : ""}`
		: "No attached-agent tools are currently registered; the agent can explain its available capabilities.";
	const preferences = boundedText(typeof params.prompt === "string" ? params.prompt : "", 1024);
	const history = boundedText(params.includeStartupContext === false ? "" : snapshot.history, 2048, 1800);
	const instructions = prompt
		.render(liveTemplate, { capabilities, preferences: preferences.text, history: history.text })
		.trim();
	return {
		instructions,
		diagnostics: {
			bytes: {
				capabilities: bytes(capabilities),
				preferences: bytes(preferences.text),
				history: bytes(history.text),
				instructions: bytes(instructions),
			},
			truncated: {
				capabilities: capabilitiesTruncated,
				preferences: preferences.truncated,
				history: history.truncated,
				instructions: capabilitiesTruncated || preferences.truncated || history.truncated,
			},
		},
	};
}
