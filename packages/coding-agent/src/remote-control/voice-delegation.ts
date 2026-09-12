/** Ported from pinned context/realtime_delegation.rs. See NOTICE.md and LICENSE. */
import { prompt } from "@f5-sales-demo/pi-utils";
import template from "../prompts/system/remote-voice-delegation.md" with { type: "text" };

function bounded(value: string, tail: boolean): string {
	const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	const bytes = Buffer.from(escaped);
	if (bytes.length <= 4096) return escaped;
	if (tail) {
		let start = bytes.length - 4093;
		while ((bytes[start] & 0xc0) === 0x80) start++;
		return `…${bytes.subarray(start).toString("utf8")}`;
	}
	let end = 4093;
	while ((bytes[end] & 0xc0) === 0x80) end--;
	return `${bytes.subarray(0, end).toString("utf8")}…`;
}
/** Byte-compatible formatter for the pinned Codex delegation envelope. */
export function pinnedVoiceDelegation(input: string, transcript: string | null = null, tail = false): string {
	return prompt
		.render(template, {
			input: bounded(input, false),
			transcript: transcript ? bounded(transcript, true) : undefined,
			tail,
		})
		.trimEnd();
}

const XCSH_DELEGATION_CONTRACT = `<xcsh_voice_delegation_contract>
Treat the preceding <input> as the user's exact request. If it asks what xcsh knows or remembers about the user, or asks to read or write self-awareness or memory, you MUST first use the read tool on memory://root/memory_summary.md. Use that project-scoped result and the normal xcsh memory rules before answering or changing memory. When the read returns stored facts, your answer MUST include at least one concrete, non-sensitive stored fact. Label inferences and possibly stale facts honestly, and never replace the lookup with a claim that only the current conversation is available. If the shared project memory is missing or empty, say so truthfully without inventing facts. For unrelated requests, proceed normally.
</xcsh_voice_delegation_contract>`;

/** xcsh voice handoff: pinned envelope plus the shared-memory execution contract. */
export function voiceDelegation(input: string, transcript: string | null = null, tail = false): string {
	return `${pinnedVoiceDelegation(input, transcript, tail)}\n${XCSH_DELEGATION_CONTRACT}`;
}

/** Recognize both pinned envelopes and xcsh-enriched handoffs as voice-owned input. */
export function isVoiceDelegation(value: string): boolean {
	const candidate = value.trim();
	return (
		candidate.startsWith("<realtime_delegation>") &&
		(candidate.endsWith("</realtime_delegation>") || candidate.endsWith("</xcsh_voice_delegation_contract>"))
	);
}
