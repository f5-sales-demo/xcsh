/**
 * Shared framed text input for extension dialogs. Public callbacks remain unchanged.
 */
import { Container, Input, type TUI, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { CountdownTimer } from "./countdown-timer";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorNavigationHint,
} from "./selector-frame";

export interface HookInputOptions {
	tui?: TUI;
	timeout?: number;
	onTimeout?: () => void;
}

export class HookInputComponent extends Container {
	#input = new Input();
	#countdown: CountdownTimer | undefined;
	#remaining: number | undefined;
	#closed = false;
	#offset = 0;
	#capacity = 1;
	#detailLength = 0;
	constructor(
		private readonly title: string,
		private readonly placeholder: string | undefined,
		private readonly onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
		private readonly opts?: HookInputOptions,
	) {
		super();
		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.#countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				seconds => {
					this.#remaining = seconds;
				},
				() => {
					if (this.#closed) return;
					this.#closed = true;
					opts.onTimeout?.();
					this.onCancel();
				},
			);
		}
	}
	override render(width: number): string[] {
		const rows = this.opts?.tui?.terminal?.rows || process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const question = wrapTextWithAnsi(this.title, inner);
		const details = question.length > 2 ? question : [];
		this.#capacity = Math.max(1, rows - 12);
		this.#detailLength = details.length;
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - this.#capacity));
		return selectorFrame(
			width,
			rows,
			"Extension input",
			this.title,
			[],
			this.#input.render(inner),
			[
				...(!this.#input.getValue() && this.placeholder ? [this.placeholder] : []),
				...details.slice(this.#offset, this.#offset + this.#capacity),
			],
			[
				...(this.#remaining === undefined ? [] : [`Closes after ${this.#remaining}s idle`]),
				selectorNavigationHint("submit"),
				selectorCancelHint("cancel"),
				...(details.length > this.#capacity ? ["PgUp/PgDn: details"] : []),
			],
		);
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		this.#countdown?.reset();
		if (matchesSelectorKey(data, "cancel")) {
			this.#closed = true;
			this.dispose();
			this.onCancel();
		} else if (matchesSelectorKey(data, "confirm")) {
			this.#closed = true;
			this.dispose();
			this.onSubmit(this.#input.getValue());
		} else if (matchesSelectorKey(data, "pageDown"))
			this.#offset = Math.min(Math.max(0, this.#detailLength - this.#capacity), this.#offset + this.#capacity);
		else if (matchesSelectorKey(data, "pageUp")) this.#offset = Math.max(0, this.#offset - this.#capacity);
		else this.#input.handleInput(data);
	}
	dispose(): void {
		this.#countdown?.dispose();
	}
}
