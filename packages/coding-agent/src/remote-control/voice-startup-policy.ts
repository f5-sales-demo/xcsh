/** Exact provider non-speech annotation; never grants caller or task admission. */
export function isSniffAnnotation(text: string): boolean {
	return /^\s*(?:\[sniff\]\s*)+$/i.test(text);
}

/** Detect captured assistant-only exchanges without classifying a greeting as caller input. */
export class StartupAssistantPolicy {
	#caller = false;
	#text = "";
	#completed = "";
	#violation: "self-dialogue" | "identity-mismatch" | "startup-speech" | null = null;
	constructor(private readonly options: { callerFirst?: boolean } = {}) {}
	observe(
		role: "user" | "assistant",
		text: string,
		done: boolean,
	): "self-dialogue" | "identity-mismatch" | "startup-speech" | null {
		if (this.#violation) return this.#violation;
		if (role === "user") {
			if (text.trim()) {
				this.#caller = true;
				this.#text = "";
				this.#completed = "";
			}
			return null;
		}
		this.#text = (done ? text : this.#text + text).slice(-8192);
		if (isSniffAnnotation(this.#text)) {
			this.#text = "";
			return null;
		}
		const values = [this.#text, (this.#completed + this.#text).slice(-8192)].map(value =>
			value.replace(/[’‘]/g, "'").trim(),
		);
		if (done) {
			this.#completed = `${this.#completed}${this.#text} `.slice(-8192);
			this.#text = "";
		}
		// Wait for a bounded unfinished provider annotation, never for ordinary speech.
		if (!this.#caller && !done && this.#completed.trim() === "" && /^\s*\[[^\]\r\n]{0,256}$/.test(this.#text))
			return null;
		const greeting = "(?:(?:hi|hello|hey|sure|okay|alright)[!,.]?\\s+)?";
		const wrongIdentity = new RegExp(`(?:^|[.!?]\\s+)${greeting}(?:i'm|i am)\\s+(?:just\\s+)?chat\\s*gpt\\b`, "i");
		const questionAndAnswer =
			/^(?:(?:what\s+)?what (?:can you do|are you)|who are you)\?\s*(?:i'm|i am|i can|sure)\b/i;
		const addressedAssistant = /^(?:hi|hello|hey)[,\s]+(?:chat\s*gpt|xcsh|ek[- ]see[- ]shell)\b/i;
		if (values.some(value => wrongIdentity.test(value) || /\?\s*(?:i'm|i am)\s+chat\s*gpt\b/i.test(value)))
			this.#violation = "identity-mismatch";
		else if (!this.#caller && values.some(value => questionAndAnswer.test(value) || addressedAssistant.test(value)))
			this.#violation = "self-dialogue";
		else if (!this.#caller && this.options.callerFirst && values.some(value => value.trim()))
			this.#violation = "startup-speech";
		return this.#violation;
	}
}
