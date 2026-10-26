import { createHash } from "node:crypto";

export interface VoiceApproval {
	chatId: string;
	workspace: string;
	requestId: string;
	revision: number;
	title: string;
	secret: boolean;
	eligible: boolean;
	identity: string;
	kind?: "approval" | "input" | "select" | "plan";
	options?: readonly string[];
}
const normalized = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const signature = (request: VoiceApproval) => createHash("sha256").update(JSON.stringify(request)).digest("hex");
/** Speech proposes a decision; the existing interaction owner resolves it atomically. */
export class VoiceApprovalGate {
	#candidate?: { signature: string; request: VoiceApproval };
	#announced?: { signature: string; request: VoiceApproval };
	#assistant = "";
	constructor(
		private readonly pending: () => VoiceApproval[],
		private readonly respond: (requestId: string, value: string) => boolean,
	) {}
	reset(): void {
		this.#announced = undefined;
		this.#candidate = undefined;
	}
	assistantCompleted(text: string): void {
		this.#assistant = normalized(text);
		this.#candidate = undefined;
		this.#announced = undefined;
		const current = this.pending();
		if (current.length !== 1 || !current[0]?.eligible || current[0].secret || !current[0].title.trim()) return;
		const request = current[0];
		if (this.#assistant.includes(normalized(request.title)))
			this.#candidate = { signature: signature(request), request: { ...request } };
	}
	/** A media adapter reports actual playback followed by silence, independently of transcript completion. */
	playbackCompleted(requestId: string, revision: number): boolean {
		const candidate = this.#candidate;
		const current = this.pending();
		if (
			!candidate ||
			current.length !== 1 ||
			current[0]?.requestId !== requestId ||
			current[0].revision !== revision ||
			signature(current[0]) !== candidate.signature
		)
			return false;
		this.#announced = candidate;
		return true;
	}
	callerCompleted(text: string, role: "user" | "assistant", complete: boolean, echoed = false): boolean {
		const answer = normalized(text),
			announced = this.#announced;
		const kind = announced?.request.kind ?? "approval";
		const decision =
			kind === "plan"
				? /^yes[.!]?$/.test(answer)
					? "implement"
					: /^no[.!]?$/.test(answer)
						? "stay"
						: ["clear context and implement", "yes, clear context and implement"].includes(answer)
							? "fresh"
							: undefined
				: kind === "approval"
					? /^yes[.!]?$/.test(answer)
						? "accept"
						: /^no[.!]?$/.test(answer)
							? "decline"
							: undefined
					: kind === "select"
						? announced?.request.options?.find(option => normalized(option) === answer)
						: text.trim();
		if (
			role !== "user" ||
			!complete ||
			echoed ||
			!decision ||
			((kind === "approval" || kind === "plan") && /\b(yes|no)\b/.test(this.#assistant)) ||
			(kind !== "approval" && this.#assistant === answer)
		)
			return false;
		const current = this.pending();
		if (!announced || current.length !== 1 || !current[0] || signature(current[0]) !== announced.signature)
			return false;
		this.#announced = undefined;
		this.#candidate = undefined;
		return this.respond(announced.request.requestId, decision);
	}
}
