import capabilityTemplate from "../prompts/system/remote-voice-capabilities.md" with { type: "text" };
import policyTemplate from "../prompts/system/remote-voice-listening-reminder.md" with { type: "text" };
import liveTemplate from "../prompts/system/remote-voice-live.md" with { type: "text" };
import runtimeTemplate from "../prompts/system/remote-voice-runtime.md" with { type: "text" };
/** Immutable, bounded xcsh persona supplied to a newly-created voice surface. */

import { prompt } from "@f5-sales-demo/pi-utils";

export interface VoicePersonaTool {
	name: string;
}
export interface VoicePersonaSnapshot {
	tools: readonly VoicePersonaTool[];
	history: string;
	runtime?: {
		model?: string;
		provider?: string;
		reasoning?: string;
		host?: string;
		workspace?: string;
		tenant?: string | null;
		taskStatus?: "idle" | "running" | "waitingOnUserInput";
	};
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
/** GPT-Live receives compiled capability descriptions and allowlisted runtime facts only. */
export function voicePersonaInstructions(
	params: Record<string, unknown>,
	snapshot: VoicePersonaSnapshot,
): { instructions: string; diagnostics: VoicePersonaDiagnostics } {
	const names = new Set(snapshot.tools.map(tool => tool.name).filter(name => /^[a-z][a-z0-9_]{0,63}$/.test(name)));
	const capabilities = boundedText(
		prompt
			.render(capabilityTemplate, {
				files: names.has("read") || names.has("find"),
				tenant: names.has("xcsh_context"),
				api: names.has("xcsh_api"),
				person: names.has("person_profile"),
				machine: names.has("machine_profile"),
				tests: names.has("bash"),
				discovery: names.has("search_tool_bm25"),
			})
			.trim(),
		180,
	);
	const safeFact = (value: unknown, max: number) =>
		typeof value === "string" && value.length <= max && !/[\x00-\x1f<>`\n]/.test(value) ? value : undefined;
	const runtime = snapshot.runtime;
	let runtimeContext = boundedText(
		runtime
			? prompt
					.render(runtimeTemplate, {
						model: safeFact(runtime.model, 128),
						provider: safeFact(runtime.provider, 64),
						reasoning: safeFact(runtime.reasoning, 16),
						host: safeFact(runtime.host, 64),
						workspace: safeFact(runtime.workspace, 4096),
						tenant: runtime.tenant === null ? "none" : safeFact(runtime.tenant, 64),
						taskStatus: ["idle", "running", "waitingOnUserInput"].includes(String(runtime.taskStatus))
							? runtime.taskStatus
							: undefined,
					})
					.trim()
			: "",
		260,
	);
	// Incoming prompt strings and raw transcript history can contain instructions,
	// profile facts or credentials. Only typed verified runtime fields enter Live.
	const preferences = { text: "", truncated: typeof params.prompt === "string" && params.prompt.length > 0 };
	const history = { text: "", truncated: snapshot.history.length > 0 };
	let capabilityContext = capabilities;
	const render = () =>
		prompt
			.render(liveTemplate, {
				policy: prompt.render(policyTemplate).trim(),
				capabilities: capabilityContext.text,
				runtime: runtimeContext.text,
			})
			.trim();
	let instructions = render();
	if (bytes(instructions) > 4096) {
		capabilityContext = boundedText(
			capabilityContext.text,
			Math.max(0, bytes(capabilityContext.text) - (bytes(instructions) - 4096)),
		);
		instructions = render();
	}
	if (bytes(instructions) > 4096) {
		runtimeContext = boundedText(
			runtimeContext.text,
			Math.max(0, bytes(runtimeContext.text) - (bytes(instructions) - 4096)),
		);
		instructions = render();
	}
	const capabilitiesTruncated = capabilityContext.truncated;
	if (bytes(instructions) > 4096) throw new Error("Compiled voice policy exceeds bounded instruction budget");
	return {
		instructions,
		diagnostics: {
			bytes: {
				capabilities: bytes(capabilityContext.text),
				preferences: bytes(preferences.text),
				history: bytes(history.text),
				instructions: bytes(instructions),
			},
			truncated: {
				capabilities: capabilitiesTruncated,
				preferences: preferences.truncated,
				history: history.truncated,
				instructions:
					capabilitiesTruncated || runtimeContext.truncated || preferences.truncated || history.truncated,
			},
		},
	};
}

/** A bounded factual update; missing values explicitly retire earlier facts. */
export function voiceRuntimeContext(snapshot: VoicePersonaSnapshot): string {
	const runtime = snapshot.runtime ?? {};
	const fact = (value: unknown, limit: number): string =>
		typeof value === "string" && value.length <= 4096 && !/[\x00-\x1f<>`]/.test(value)
			? boundedText(value, limit).text
			: "unknown";
	return JSON.stringify({
		model: fact(runtime.model, 128),
		provider: fact(runtime.provider, 64),
		reasoning: fact(runtime.reasoning, 16),
		host: fact(runtime.host, 64),
		workspace: fact(runtime.workspace, 700),
		selectedContext: runtime.tenant === null ? "none" : fact(runtime.tenant, 64),
		taskStatus: ["idle", "running", "waitingOnUserInput"].includes(String(runtime.taskStatus))
			? runtime.taskStatus
			: "unknown",
	});
}
