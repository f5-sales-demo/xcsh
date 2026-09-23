import { type Component, Editor, getKeybindings, matchesKey, type TUI, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { INPUT_COPY, type InputQuestion, type InputResponse } from "../../../../chat-ui/src/interactions/contract";
import { QuestionForm } from "../../../../chat-ui/src/interactions/question-form";
import { getEditorTheme, theme } from "../theme/theme";
import { keyHint, rawKeyHint } from "./keybinding-hints";
import {
	matchesSelectorKey,
	type SelectorFrameLine,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorRow,
} from "./selector-frame";

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
		const height = this.tui.terminal.rows || 24;
		const inner = selectorFrameContentWidth(width);
		if (this.form.confirming) {
			const body: SelectorFrameLine[] = [
				selectorRow([`1. ${INPUT_COPY.proceed}`], [inner - 2], this.#confirmation === 0),
				{ content: theme.fg("muted", `   Submit with unanswered questions.`), selected: false },
				selectorRow([`2. ${INPUT_COPY.back}`], [inner - 2], this.#confirmation === 1),
				{ content: theme.fg("muted", `   ${INPUT_COPY.backDescription}`), selected: false },
			];
			return selectorFrame(
				width,
				height,
				"Submit answers?",
				`${this.form.unanswered} unanswered ${this.form.unanswered === 1 ? "question" : "questions"}`,
				[],
				body,
				[],
				[`${keyHint("tui.select.confirm", "choose")} · ${selectorCancelHint("return")}`],
				{ selectedBodyIndex: this.#confirmation * 2 },
			);
		}
		const body: SelectorFrameLine[] = [];
		let selectedBodyIndex: number | undefined;
		for (const [index, option] of this.form.options.entries()) {
			const highlighted = index === this.form.draft.highlighted;
			if (highlighted) selectedBodyIndex = body.length;
			const committed = highlighted && this.form.draft.committed;
			body.push(
				selectorRow(
					[`${theme.symbol(committed ? "checkbox.checked" : "checkbox.unchecked")} ${index + 1}. ${option.label}`],
					[inner - 2],
					highlighted,
				),
			);
			if (option.description.trim())
				body.push({ content: theme.fg("muted", `   ${option.description}`), selected: false });
		}
		const details: string[] = [];
		if (this.form.notesVisible) {
			details.push(theme.bold(this.form.options.length ? INPUT_COPY.notes : INPUT_COPY.answer));
			this.#editor.setMaxHeight(Math.max(1, height - 12));
			details.push(
				...(this.form.question.isSecret
					? maskedEditorLines(this.#editor.getText(), inner)
					: this.#editor.render(inner)),
			);
		}
		const submitLabel =
			this.form.index === this.form.questions.length - 1 && this.form.questions.length > 1 ? "submit all" : "submit";
		const interruptKeys = getKeybindings().getKeys("app.interrupt").join("/") || "Ctrl+C";
		const footer = [
			[
				...(this.form.options.length
					? [rawKeyHint(`1–${Math.min(9, this.form.options.length)}`, "answer"), rawKeyHint("Space", "commit")]
					: []),
				rawKeyHint("Tab", this.form.notesVisible ? "clear notes" : "notes"),
				keyHint("tui.select.confirm", submitLabel),
				...(this.form.questions.length > 1 && !this.form.notesVisible ? [rawKeyHint("←/→", "question")] : []),
				this.form.notesVisible ? rawKeyHint(interruptKeys, "interrupt") : selectorCancelHint("interrupt"),
			].join(" · "),
		];
		return selectorFrame(
			width,
			height,
			"Answer questions",
			`Question ${this.form.index + 1} of ${this.form.questions.length} · ${this.form.unanswered} unanswered`,
			[theme.fg("contentAccent", this.form.question.header), this.form.question.question],
			body,
			details,
			footer,
			{
				selectedBodyIndex,
				overflowHint: `${selectorKeys("up")}/${selectorKeys("down")}: scroll choices`,
			},
		);
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
		const enter = matchesSelectorKey(data, "confirm");
		if (this.form.confirming) {
			if (matchesSelectorKey(data, "cancel") || matchesKey(data, "backspace")) this.form.goBack();
			else if (enter) {
				if (this.#confirmation === 0) this.#finish(this.form.finish());
				else this.form.goBack();
			} else if (matchesKey(data, "up") || matchesKey(data, "down") || data === "j" || data === "k")
				this.#confirmation = 1 - this.#confirmation;
			else if (data === "1" || data === "2") this.#confirmation = Number(data) - 1;
		} else if (matchesSelectorKey(data, "cancel")) {
			if (this.form.escape() === "interrupted") this.#finish(undefined);
			this.#restore();
		} else if (keys.matches(data, "app.interrupt")) {
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
		else if (matchesSelectorKey(data, "up")) this.form.moveOption(-1);
		else if (matchesSelectorKey(data, "down")) this.form.moveOption(1);
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
