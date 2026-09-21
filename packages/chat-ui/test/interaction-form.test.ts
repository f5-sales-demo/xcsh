import { expect, test } from "bun:test";
import { QuestionForm } from "../src/interactions/question-form";

const questions = [
	{
		id: "scope",
		header: "Scope",
		question: "Which scope?",
		isOther: true,
		options: [
			{ label: "Small (Recommended)", description: "Limits the change." },
			{ label: "Large", description: "Covers every client." },
		],
	},
	{
		id: "timing",
		header: "Timing",
		question: "When?",
		isOther: true,
		options: [
			{ label: "Now (Recommended)", description: "Starts immediately." },
			{ label: "Later", description: "Defers work." },
		],
	},
];

test("highlighted choices and drafts are never answers; skipped questions require confirmation", () => {
	const form = new QuestionForm(questions);
	form.moveQuestion(1);
	expect(form.submit()).toEqual({ kind: "confirm" });
	expect(form.finish()).toEqual({ answers: { scope: { answers: [] }, timing: { answers: ["Now (Recommended)"] } } });
});

test("choice plus trimmed multiline Unicode notes matches Codex serialization", () => {
	const form = new QuestionForm(questions);
	form.moveOption(1);
	form.toggleNotes();
	form.editNotes("  α\nsecond line  ");
	expect(form.submit()).toEqual({ kind: "next" });
	form.submit();
	expect(form.finish().answers.scope.answers).toEqual(["Large", "user_note: α\nsecond line"]);
});

test("navigation wraps and changing a committed draft invalidates commitment", () => {
	const form = new QuestionForm(questions);
	form.submit();
	form.moveQuestion(1);
	expect(form.index).toBe(0);
	form.toggleNotes();
	form.editNotes("unsubmitted");
	form.moveQuestion(-1);
	expect(form.finish().answers.scope.answers).toEqual([]);
});

test("space-style commit and delete-style clearing preserve Codex skipped-answer semantics", () => {
	const form = new QuestionForm([questions[0]]);
	form.commitSelection();
	expect(form.unanswered).toBe(0);
	form.clearSelection();
	expect(form.draft.highlighted).toBeUndefined();
	expect(form.unanswered).toBe(1);
	expect(form.submit()).toEqual({ kind: "confirm" });
	expect(form.finish()).toEqual({ answers: { scope: { answers: [] } } });
});

test("None of the above opens notes and commits only on submission", () => {
	const form = new QuestionForm([questions[0]]);
	form.moveOption(2);
	expect(form.submit()).toEqual({ kind: "notes" });
	expect(form.finish().answers.scope.answers).toEqual([]);
	form.editNotes("Alternative");
	expect(form.submit()).toEqual({
		kind: "submitted",
		response: { answers: { scope: { answers: ["None of the above", "user_note: Alternative"] } } },
	});
});

test("escape clears option notes before interrupting; timer clears without a choice", () => {
	const form = new QuestionForm([questions[0]], false, 0);
	form.toggleNotes();
	form.editNotes("draft");
	expect(form.escape()).toBe("cleared");
	expect(form.escape()).toBe("interrupted");
	expect(form.tick(120_000)).toBeUndefined();
	const untouched = new QuestionForm([questions[0]], false, 0);
	expect(untouched.tick(119_999)).toBeUndefined();
	expect(untouched.tick(120_000)).toEqual({ answers: {} });
	expect(new QuestionForm([questions[0]], true, 0).tick(999_999)).toBeUndefined();
});
