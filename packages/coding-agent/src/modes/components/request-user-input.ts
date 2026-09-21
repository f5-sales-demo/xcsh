import { type Component, Editor, getKeybindings, matchesKey, type TUI, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { INPUT_COPY, type InputQuestion, type InputResponse } from "../../../../chat-ui/src/interactions/contract";
import { QuestionForm } from "../../../../chat-ui/src/interactions/question-form";
import { getEditorTheme } from "../theme/theme";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function maskedEditorLines(text: string, width: number): string[] {
	const masked = text
		.split("\n")
		.map(line => [...graphemes.segment(line)].map(() => "*").join(""))
		.join("\n");
	return masked.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
}

/** Uses the ordinary multiline composer; form state stays local until explicit submission. */
export class RequestUserInputComponent implements Component {
	readonly form: QuestionForm;
	#editor = new Editor(getEditorTheme());
	#confirmation = 0;
	#closed = false;
	#abort: () => void;
	constructor(
		private readonly tui: TUI,
		questions: readonly InputQuestion[],
		private readonly done: (value: InputResponse | undefined) => void,
		private readonly signal: AbortSignal,
	) {
		this.form = new QuestionForm(questions);
		this.#editor.disableSubmit = true;
		this.#editor.setBorderVisible(false);
		this.#editor.onChange = text => this.form.editNotes(text);
		this.#abort = () => this.#finish(undefined);
		signal.addEventListener("abort", this.#abort, { once: true });
		if (signal.aborted) queueMicrotask(this.#abort);
	}
	#finish(value: InputResponse | undefined): void {
		if (this.#closed) return;
		this.#closed = true;
		this.done(value);
	}
	dispose(): void {
		this.signal.removeEventListener("abort", this.#abort);
		this.#closed = true;
	}
	invalidate(): void {
		this.#editor.invalidate();
	}
	render(width: number): string[] {
		const lines: string[] = [];
		const add = (text: string) => lines.push(...wrapTextWithAnsi(text, Math.max(1, width)));
		if (this.form.confirming) {
			add(INPUT_COPY.confirm);
			add(`${this.#confirmation === 0 ? ">" : " "} 1. ${INPUT_COPY.proceed}`);
			add(
				`   Submit with ${this.form.unanswered} unanswered ${this.form.unanswered === 1 ? "question" : "questions"}.`,
			);
			add(`${this.#confirmation === 1 ? ">" : " "} 2. ${INPUT_COPY.back}`);
			add(`   ${INPUT_COPY.backDescription}`);
			return lines;
		}
		add(
			`Question ${this.form.index + 1}/${this.form.questions.length}${this.form.unanswered ? ` (${this.form.unanswered} unanswered)` : ""}`,
		);
		add(this.form.question.header);
		add(this.form.question.question);
		add("");
		for (const [index, option] of this.form.options.entries()) {
			add(`${index === this.form.draft.highlighted ? ">" : " "} ${index + 1}. ${option.label}`);
			add(`   ${option.description}`);
		}
		if (this.form.notesVisible) {
			add("");
			add(this.form.options.length ? INPUT_COPY.notes : INPUT_COPY.answer);
			this.#editor.setMaxHeight(Math.max(3, (this.tui.terminal.rows || 24) - lines.length - 3));
			lines.push(
				...(this.form.question.isSecret
					? maskedEditorLines(this.#editor.getText(), Math.max(1, width))
					: this.#editor.render(Math.max(1, width))),
			);
		}
		add("");
		add(
			`${this.form.notesVisible ? "tab or esc to clear notes" : "tab to add notes"} | enter to submit ${this.form.index === this.form.questions.length - 1 && this.form.questions.length > 1 ? "all" : "answer"}${this.form.questions.length > 1 && !this.form.notesVisible ? " | ←/→ to navigate questions" : ""}${this.form.notesVisible ? "" : " | esc to interrupt"}`,
		);
		return lines;
	}
	#restore(): void {
		const callback = this.#editor.onChange;
		this.#editor.onChange = undefined;
		this.#editor.setText(this.form.draft.notes);
		this.#editor.onChange = callback;
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		this.form.interact();
		const keys = getKeybindings();
		const enter = keys.matches(data, "tui.select.confirm");
		if (this.form.confirming) {
			if (matchesKey(data, "escape") || matchesKey(data, "backspace")) this.form.goBack();
			else if (enter) {
				if (this.#confirmation === 0) this.#finish(this.form.finish());
				else this.form.goBack();
			} else if (matchesKey(data, "up") || matchesKey(data, "down") || data === "j" || data === "k")
				this.#confirmation = 1 - this.#confirmation;
			else if (data === "1" || data === "2") this.#confirmation = Number(data) - 1;
		} else if (matchesKey(data, "escape")) {
			if (this.form.escape() === "interrupted") this.#finish(undefined);
			this.#restore();
		} else if (matchesKey(data, "ctrl+c")) {
			if (this.form.notesVisible && this.form.draft.notes) {
				this.form.editNotes("");
				this.#restore();
			} else this.#finish(undefined);
		} else if (matchesKey(data, "tab")) {
			this.form.toggleNotes();
			this.#restore();
		} else if (!this.form.notesVisible && data === " ") this.form.commitSelection();
		else if (!this.form.notesVisible && (matchesKey(data, "backspace") || matchesKey(data, "delete"))) {
			this.form.clearSelection();
			this.#restore();
		} else if (enter) this.#submit();
		else if (
			matchesKey(data, "ctrl+p") ||
			matchesKey(data, "pageUp") ||
			(!this.form.notesVisible && (matchesKey(data, "left") || data === "h"))
		) {
			this.form.moveQuestion(-1);
			this.#restore();
		} else if (
			matchesKey(data, "ctrl+n") ||
			matchesKey(data, "pageDown") ||
			(!this.form.notesVisible && (matchesKey(data, "right") || data === "l"))
		) {
			this.form.moveQuestion(1);
			this.#restore();
		} else if (this.form.notesVisible) this.#editor.handleInput(data);
		else if (keys.matches(data, "tui.select.up")) this.form.moveOption(-1);
		else if (keys.matches(data, "tui.select.down")) this.form.moveOption(1);
		else if (/^[1-9]$/.test(data) && Number(data) <= this.form.options.length) {
			this.form.selectOption(Number(data) - 1);
			this.#submit();
		}
		this.tui.requestRender();
	}
	#submit(): void {
		const result = this.form.submit();
		if (result.kind === "submitted") this.#finish(result.response);
		this.#restore();
	}
}
