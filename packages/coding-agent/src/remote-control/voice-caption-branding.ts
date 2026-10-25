const spokenNames = ["ek-see-shell", "ek see shell", "xc shell", "xc-shell"];
const namePattern =
	/(?<![\p{L}\p{N}_/.-])(?:ek-see-shell|ek see shell|xc shell|xc-shell)(?![\p{L}\p{N}_/-]|\.[\p{L}\p{N}_])/giu;

/** Display-only product spelling. Raw provider events and spoken audio stay unchanged. */
export class VoiceCaptionBranding {
	#pending = "";
	#previous = "";
	#published = "";
	append(delta: string): string {
		this.#pending += delta;
		let end = this.#pending.length;
		// Hold only a possible product-name suffix, including an ambiguous final dot.
		// This avoids emitting a phonetic prefix that a later fragment completes.
		for (let i = Math.max(0, end - 13); i < end; i++) {
			const previous = i ? this.#pending[i - 1]! : this.#previous;
			if (previous && /[\p{L}\p{N}_/.-]/u.test(previous)) continue;
			const suffix = this.#pending.slice(i).toLowerCase();
			if (spokenNames.some(name => name.startsWith(suffix) || suffix === `${name}.`)) {
				end = i;
				break;
			}
		}
		const text = this.#pending.slice(0, end);
		const result = this.#format(text);
		this.#pending = this.#pending.slice(end);
		if (text) this.#previous = text.at(-1)!;
		this.#published += result;
		return result;
	}
	complete(text: string): string {
		return this.finish(text).text;
	}
	finish(source: string): { text: string; delta: string } {
		const text = source.replace(namePattern, "xcsh");
		const delta = text.startsWith(this.#published) ? text.slice(this.#published.length) : "";
		this.reset();
		return { text, delta };
	}
	flush(): string {
		const text = this.#format(this.#pending);
		this.reset();
		return text;
	}
	reset(): void {
		this.#pending = "";
		this.#previous = "";
		this.#published = "";
	}
	#format(text: string): string {
		// Include the preceding source character when deciding a token boundary.
		return (this.#previous + text)
			.replace(namePattern, (match, offset: number) => (offset < this.#previous.length ? match : "xcsh"))
			.slice(this.#previous.length);
	}
}
