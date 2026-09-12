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

const MAX_INSTRUCTIONS = 64 * 1024;
const MAX_SYSTEM_PROMPT = 160 * 1024;
const MAX_CAPABILITIES = 16 * 1024;
const MAX_PREFERENCES = 32 * 1024;
const MAX_HISTORY = 32 * 1024;
const MIN_SYSTEM_PROMPT = 16 * 1024;
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
function section(title: string, content: string): string {
	return content ? `\n\n${title}\n${content}` : "";
}
function capabilityParts(tools: readonly VoicePersonaTool[]): { names: string; descriptions: string[] } {
	const names = [...new Set(tools.map(tool => tool.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	const descriptions = new Map(tools.map(tool => [tool.name, tool.description?.trim()]));
	return {
		names: `Active attached-agent tools: ${names.join(", ") || "none"}.`,
		descriptions: names.flatMap(name => {
			const description = descriptions.get(name);
			return description ? [`\n- ${name}: ${description}`] : [];
		}),
	};
}
function renderPersona(
	directive: string,
	systemPrompt: string,
	capabilities: string,
	preferences: string,
	history: string,
): string {
	return `${directive}${section("Effective xcsh terminal system prompt:", systemPrompt)}${section("Attached-agent capabilities:", capabilities)}${section("Phone voice preferences (additive only):", preferences)}${section("Recent conversation context:", history)}`.trim();
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
	const directive = `${defaultInstructions.trim()}\n\nYou are xcsh's voice surface, not a separate ChatGPT identity. Speak and coordinate; the attached xcsh agent executes tools. Answer identity and capability questions directly from this snapshot. Delegate actions and dynamic self-inspection to the attached agent. Be concise and truthful about user knowledge.`;
	const capability = capabilityParts(effective.tools);
	const emptyEnvelope = renderPersona(directive, "", capability.names, "", "");
	const systemFrameBytes = effective.systemPrompt
		? bytes(section("Effective xcsh terminal system prompt:", "x")) - 1
		: 0;
	const preferenceFrameBytes = preference ? bytes(section("Phone voice preferences (additive only):", "x")) - 1 : 0;
	const systemReserve = Math.min(bytes(effective.systemPrompt), MIN_SYSTEM_PROMPT);
	const preferenceLimit = Math.max(
		0,
		Math.min(
			MAX_PREFERENCES,
			MAX_INSTRUCTIONS - bytes(emptyEnvelope) - systemFrameBytes - systemReserve - preferenceFrameBytes,
		),
	);
	const preferences = boundedText(preference, preferenceLimit);
	const withoutSystem = renderPersona(directive, "", capability.names, preferences.text, "");
	const systemLimit = Math.max(
		0,
		Math.min(MAX_SYSTEM_PROMPT, MAX_INSTRUCTIONS - bytes(withoutSystem) - systemFrameBytes),
	);
	const systemPrompt = boundedText(
		effective.systemPrompt,
		systemLimit,
		Math.min(64 * 1024, Math.floor(systemLimit * 0.4)),
	);

	let capabilitiesText = capability.names;
	let instructions = renderPersona(directive, systemPrompt.text, capabilitiesText, preferences.text, "");
	let includedDescriptions = 0;
	for (const description of capability.descriptions) {
		if (bytes(capabilitiesText + description) > MAX_CAPABILITIES) break;
		const candidate = renderPersona(
			directive,
			systemPrompt.text,
			capabilitiesText + description,
			preferences.text,
			"",
		);
		if (bytes(candidate) > MAX_INSTRUCTIONS) break;
		capabilitiesText += description;
		instructions = candidate;
		includedDescriptions++;
	}
	const includeHistory = params.includeStartupContext !== false && effective.history.length > 0;
	const historyFrameBytes = includeHistory ? bytes(section("Recent conversation context:", "x")) - 1 : 0;
	const historyLimit = Math.max(0, Math.min(MAX_HISTORY, MAX_INSTRUCTIONS - bytes(instructions) - historyFrameBytes));
	const history = includeHistory ? boundedText(effective.history, historyLimit) : { text: "", truncated: false };
	instructions = renderPersona(directive, systemPrompt.text, capabilitiesText, preferences.text, history.text);
	const instructionsTruncated =
		systemPrompt.truncated ||
		preferences.truncated ||
		history.truncated ||
		includedDescriptions < capability.descriptions.length;
	return {
		instructions,
		diagnostics: {
			bytes: {
				systemPrompt: bytes(systemPrompt.text),
				capabilities: bytes(capabilitiesText),
				preferences: bytes(preferences.text),
				history: bytes(history.text),
				instructions: bytes(instructions),
			},
			truncated: {
				systemPrompt: systemPrompt.truncated,
				capabilities: includedDescriptions < capability.descriptions.length,
				preferences: preferences.truncated,
				history: history.truncated,
				instructions: instructionsTruncated,
			},
		},
	};
}
