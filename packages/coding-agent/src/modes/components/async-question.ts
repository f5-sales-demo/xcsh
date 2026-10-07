import { type Component, Editor, matchesKey, type TUI, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { getEditorTheme } from "../theme/theme";
import {
	matchesSelectorKey,
	selectorFrame,
	selectorFrameContentWidth,
	selectorProse,
	selectorRow,
} from "./selector-frame";

/** Async answer editor: typing and paste select free text; explicit Enter delivers the answer. */
export class AsyncQuestionComponent implements Component {
	#editor = new Editor(getEditorTheme());
	#selected = 0;
	#editing: boolean;
	#closed = false;
	#abort: () => void;
	constructor(
		private readonly tui: TUI,
		private readonly title: string,
		private readonly options: readonly string[] | undefined,
		private readonly done: (answer: string | undefined) => void,
		private readonly signal: AbortSignal,
		draft: string,
		private readonly saveDraft: (text: string) => void,
	) {
		this.#editing = !options?.length || Boolean(draft);
		this.#editor.disableSubmit = true;
		this.#editor.setBorderVisible(false);
		this.#editor.setText(draft);
		this.#editor.onChange = () => saveDraft(this.#editor.getExpandedText());
		this.#abort = () => this.#finish(undefined);
		signal.addEventListener("abort", this.#abort, { once: true });
		if (signal.aborted) queueMicrotask(this.#abort);
	}
	#finish(answer: string | undefined): void {
		if (this.#closed) return;
		this.#closed = true;
		this.saveDraft(this.#editor.getExpandedText());
		this.done(answer);
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesKey(data, "escape")) this.#finish(undefined);
		else if (matchesKey(data, "ctrl+c")) {
			if (this.#editing && this.#editor.getText()) this.#editor.setText("");
			else this.#finish(undefined);
		} else if (matchesSelectorKey(data, "confirm")) {
			const answer = this.#editing ? this.#editor.getExpandedText() : this.options?.[this.#selected];
			if (answer?.trim()) this.#finish(answer);
		} else if (!this.#editing && (matchesKey(data, "up") || matchesKey(data, "down"))) {
			const count = (this.options?.length ?? 0) + 1;
			this.#selected = (this.#selected + (matchesKey(data, "up") ? -1 : 1) + count) % count;
			this.#editing = this.#selected === this.options?.length;
		} else if (!this.#editing && /^[1-9]$/.test(data) && Number(data) <= (this.options?.length ?? 0)) {
			this.#selected = Number(data) - 1;
			this.#finish(this.options![this.#selected]);
		} else {
			this.#editing = true;
			this.#editor.handleInput(data);
		}
		this.tui.requestRender();
	}
	render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		this.#editor.setMaxHeight(Math.max(1, (this.tui.terminal.rows || 24) - 12));
		return selectorFrame(
			width,
			this.tui.terminal.rows || 24,
			"Answer question",
			"Work continues while you answer",
			[],
			[
				...(this.options ?? [])
					.slice(0, 32)
					.map((option, index) =>
						selectorRow([`${index + 1}. ${option}`], [inner - 2], !this.#editing && index === this.#selected),
					),
				selectorProse("Other: type your answer"),
			],
			[...wrapTextWithAnsi(this.title, inner), ...(this.#editing ? this.#editor.render(inner) : [])],
			["Enter: submit · Esc: answer later"],
			{},
		);
	}
	invalidate(): void {
		this.#editor.invalidate();
	}
	dispose(): void {
		this.signal.removeEventListener("abort", this.#abort);
		this.#closed = true;
	}
}
