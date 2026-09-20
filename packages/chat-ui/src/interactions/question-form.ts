import { INPUT_COPY, type InputQuestion, type InputResponse } from "./contract";

interface Draft {
	highlighted: number;
	notes: string;
	committed: boolean;
	notesVisible: boolean;
}
export type SubmitResult = { kind: "notes" | "next" | "confirm" } | { kind: "submitted"; response: InputResponse };

/** Presentation state only. Never persist this object or publish its drafts. */
export class QuestionForm {
	readonly questions: readonly InputQuestion[];
	#drafts: Draft[];
	#snoozed = false;
	index = 0;
	confirming = false;
	constructor(
		questions: readonly InputQuestion[],
		readonly blocking = true,
		readonly startedAt = Date.now(),
	) {
		if (!questions.length || new Set(questions.map(question => question.id)).size !== questions.length)
			throw new Error("Invalid question identities");
		this.questions = structuredClone(questions);
		this.#drafts = questions.map(() => ({ highlighted: 0, notes: "", committed: false, notesVisible: false }));
	}
	get question(): InputQuestion {
		return this.questions[this.index];
	}
	get draft(): Readonly<Draft> {
		return { ...this.#drafts[this.index] };
	}
	get options(): readonly { label: string; description: string }[] {
		const options = [...(this.question.options ?? [])];
		if (this.question.isOther && options.length)
			options.push({ label: INPUT_COPY.other, description: INPUT_COPY.otherDescription });
		return options;
	}
	get notesVisible(): boolean {
		return !this.options.length || this.draft.notesVisible;
	}
	get unanswered(): number {
		return this.#drafts.filter(
			(draft, index) => !draft.committed || (!this.questions[index].options?.length && !draft.notes.trim()),
		).length;
	}
	interact(): void {
		this.#snoozed = true;
	}
	moveQuestion(delta: number): void {
		this.interact();
		this.index = (this.index + delta + this.questions.length) % this.questions.length;
	}
	moveOption(delta: number): void {
		this.interact();
		if (!this.options.length) return;
		const draft = this.#drafts[this.index];
		draft.highlighted = (draft.highlighted + delta + this.options.length) % this.options.length;
		draft.committed = false;
	}
	editNotes(notes: string): void {
		this.interact();
		const draft = this.#drafts[this.index];
		if (draft.notes !== notes) draft.committed = false;
		draft.notes = notes;
		draft.notesVisible = true;
	}
	toggleNotes(): void {
		this.interact();
		if (!this.options.length) return;
		const draft = this.#drafts[this.index];
		if (draft.notesVisible) this.#clearNotes();
		else draft.notesVisible = true;
	}
	#clearNotes(): void {
		Object.assign(this.#drafts[this.index], { notes: "", notesVisible: false, committed: false });
	}
	escape(): "cleared" | "interrupted" | "back" {
		this.interact();
		if (this.confirming) {
			this.goBack();
			return "back";
		}
		if (this.options.length && this.draft.notesVisible) {
			this.#clearNotes();
			return "cleared";
		}
		return "interrupted";
	}
	submit(): SubmitResult {
		this.interact();
		const draft = this.#drafts[this.index];
		if (!draft.notesVisible && this.question.isOther && draft.highlighted === this.question.options?.length) {
			draft.notesVisible = true;
			return { kind: "notes" };
		}
		draft.committed = true;
		if (this.index < this.questions.length - 1) {
			this.moveQuestion(1);
			return { kind: "next" };
		}
		if (this.unanswered) {
			this.confirming = true;
			return { kind: "confirm" };
		}
		return { kind: "submitted", response: this.finish() };
	}
	goBack(): void {
		this.interact();
		this.confirming = false;
		const index = this.#drafts.findIndex(
			(draft, index) => !draft.committed || (!this.questions[index].options?.length && !draft.notes.trim()),
		);
		if (index >= 0) this.index = index;
	}
	finish(): InputResponse {
		return {
			answers: Object.fromEntries(
				this.questions.map((question, index) => {
					const draft = this.#drafts[index];
					const answers: string[] = [];
					if (draft.committed) {
						const option = question.options?.[draft.highlighted];
						if (option) answers.push(option.label);
						else if (
							question.options?.length &&
							question.isOther &&
							draft.highlighted === question.options.length
						)
							answers.push(INPUT_COPY.other);
						if (draft.notes.trim()) answers.push(`user_note: ${draft.notes.trim()}`);
					}
					return [question.id, { answers }];
				}),
			),
		};
	}
	/** Codex's fixed 60-second hidden grace plus 60-second visible countdown; any input snoozes it. */
	tick(now: number): InputResponse | undefined {
		return !this.blocking && !this.#snoozed && now - this.startedAt >= 120_000 ? { answers: {} } : undefined;
	}
	countdown(now: number): number | undefined {
		return !this.blocking && !this.#snoozed && now - this.startedAt >= 60_000
			? Math.max(0, Math.ceil((120_000 - (now - this.startedAt)) / 1000))
			: undefined;
	}
}
