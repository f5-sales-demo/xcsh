/** Removes an invocation-specific shell metadata frame from streamed output. */
export class ShellOutputFilter {
	#pending = "";
	#metadata = false;
	#closed = false;
	constructor(
		readonly start: string,
		readonly end: string,
		readonly emit: (text: string) => void,
	) {
		if (!start || !end) throw new Error("Shell metadata delimiters must not be empty");
	}
	push(text: string): void {
		if (this.#closed) return;
		this.#pending += text;
		while (this.#pending) {
			const delimiter = this.#metadata ? this.end : this.start;
			const index = this.#pending.indexOf(delimiter);
			if (index >= 0) {
				if (!this.#metadata && index) this.emit(this.#pending.slice(0, index));
				this.#pending = this.#pending.slice(index + delimiter.length);
				this.#metadata = !this.#metadata;
				continue;
			}
			let keep = Math.min(this.#pending.length, delimiter.length - 1);
			while (keep && !this.#pending.endsWith(delimiter.slice(0, keep))) keep--;
			const ready = this.#pending.length - keep;
			if (!this.#metadata && ready) this.emit(this.#pending.slice(0, ready));
			this.#pending = this.#pending.slice(ready);
			return;
		}
	}
	finish(): void {
		if (this.#closed) return;
		this.#closed = true;
		if (!this.#metadata && this.#pending) this.emit(this.#pending);
		this.#pending = "";
	}
}
