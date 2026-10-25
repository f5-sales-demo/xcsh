import planResultTemplate from "../prompts/system/remote-voice-plan-result.md" with { type: "text" };
import resultTemplate from "../prompts/system/remote-voice-result.md" with { type: "text" };
import { assistantPlanHistoryItems } from "./history";

/** Keep a small, completed identifier list beside its verified result without changing wire schemas. */
export function voiceResultInstructions(text: string): { text: string; names: string[] } {
	if (assistantPlanHistoryItems("voice-result", text, "final_answer", "plan").some(item => item.type === "plan"))
		return { text: `${planResultTemplate.trim()}\n\n${text}`, names: [] };
	if (Buffer.byteLength(text) > 1000 || /truncated/i.test(text)) return { text, names: [] };
	const entries = text.split(/\r?\n/).filter(line => /^\s*(?:[-*]|\d+\.)\s+/.test(line));
	if (!entries.length || entries.length > 16) return { text, names: [] };
	const names: string[] = [];
	for (const line of entries) {
		const match = /^\s*(?:[-*]|\d+\.)\s+`([^`\x00-\x1f<>]+)`\s*$/.exec(line);
		if (!match || Buffer.byteLength(match[1]) > 128) return { text, names: [] };
		names.push(match[1]);
	}
	const output = `${resultTemplate.trim()}\nExact identifiers: ${JSON.stringify(names)}\nVerified result:\n${text}`;
	return Buffer.byteLength(output) <= 1900 ? { text: output, names } : { text, names: [] };
}
const tokens = (text: string): string[] =>
	text
		.toLowerCase()
		.replace(/\b(?:dot|dash|hyphen|underscore|slash)\b/g, " ")
		.match(/[\p{L}\p{N}]+/gu) ?? [];
const contains = (text: string, name: string): boolean => {
	const expected = tokens(name);
	if (!expected.length) return false;
	const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const separator = "(?:[\\s._/\\-]+|\\s+(?:dot|dash|hyphen|underscore|slash)\\s+)";
	return new RegExp(
		`(?<![\\p{L}\\p{N}._/\\-])${expected.map(escapePattern).join(separator)}(?![\\p{L}\\p{N}_/\\-]|\\.[\\p{L}\\p{N}])`,
		"iu",
	).test(text);
};
export interface VoiceResultFidelityObservation {
	delegationId: string;
	outcome: "matched" | "omitted" | "superseded" | "incomplete";
	expectedCount: number;
	missingCount: number;
}
/** Observe supplied results; never rewrite provider speech, cancel work, or replay a tool. */
interface PendingResult {
	id: string;
	names: string[];
	completed: string;
	partial: string;
	finalSeen: boolean;
	seen: Set<string>;
}
export class VoiceResultFidelity {
	#pending?: PendingResult;
	expect(id: string, names: string[]): VoiceResultFidelityObservation | null {
		const previous = this.close();
		this.#pending = names.length
			? { id, names: [...names], completed: "", partial: "", finalSeen: false, seen: new Set() }
			: undefined;
		return previous;
	}
	#missing(pending: PendingResult): number {
		return pending.names.filter(name => !contains(`${pending.completed} ${pending.partial}`, name)).length;
	}
	close(): VoiceResultFidelityObservation | null {
		const pending = this.#pending;
		this.#pending = undefined;
		if (!pending) return null;
		const missingCount = this.#missing(pending);
		return {
			delegationId: pending.id,
			outcome: pending.finalSeen ? (missingCount ? "omitted" : "matched") : "incomplete",
			expectedCount: pending.names.length,
			missingCount,
		};
	}
	observe(
		role: "user" | "assistant",
		text: string,
		done: boolean,
		id?: string,
	): VoiceResultFidelityObservation | null {
		const pending = this.#pending;
		if (!pending) return null;
		if (role === "user") {
			if (!text.trim()) return null;
			this.#pending = undefined;
			return {
				delegationId: pending.id,
				outcome: "superseded",
				expectedCount: pending.names.length,
				missingCount: this.#missing(pending),
			};
		}
		if (!done) {
			pending.partial = (pending.partial + text).slice(-8192);
			return null;
		}
		const key = id ?? text;
		if (pending.seen.has(key)) return null;
		pending.seen.add(key);
		pending.completed = `${pending.completed} ${text}`.slice(-8192);
		pending.partial = "";
		pending.finalSeen = true;
		const missingCount = this.#missing(pending);
		if (missingCount) return null;
		this.#pending = undefined;
		return { delegationId: pending.id, outcome: "matched", expectedCount: pending.names.length, missingCount: 0 };
	}
}
