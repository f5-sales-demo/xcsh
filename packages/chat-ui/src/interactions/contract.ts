/** Codex 392f56a611c4 payloads. xcsh resolution metadata belongs in separate events. */
export interface InputOption {
	label: string;
	description: string;
}
export interface InputQuestion {
	id: string;
	header: string;
	question: string;
	options?: readonly InputOption[] | null;
	isOther?: boolean;
	isSecret?: boolean;
}
export interface InputResponse {
	answers: Record<string, { answers: string[] }>;
}
export interface AsyncInputQuestion {
	title: string;
	options?: string[];
}

export const INPUT_COPY = {
	other: "None of the above",
	otherDescription: "Optionally, add details in notes (tab).",
	notes: "Add notes",
	answer: "Type your answer (optional)",
	confirm: "Submit with unanswered questions?",
	back: "Go back",
	backDescription: "Return to the first unanswered question.",
	proceed: "Proceed",
} as const;

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate at the completion owner, independently of any presentation surface. */
export function validInputResponse(questions: readonly InputQuestion[], value: unknown): value is InputResponse {
	if (!record(value) || Object.keys(value).length !== 1 || !record(value.answers)) return false;
	const answers = value.answers;
	if (Object.keys(answers).length !== questions.length) return false;
	return questions.every(question => {
		if (!Object.hasOwn(answers, question.id)) return false;
		const answer = answers[question.id];
		if (!record(answer) || Object.keys(answer).length !== 1 || !Array.isArray(answer.answers)) return false;
		const entries = answer.answers;
		if (entries.some(entry => typeof entry !== "string") || entries.length > 2) return false;
		if (!entries.length) return true;
		const labels = question.options?.map(option => option.label) ?? [];
		if (question.isOther && labels.length) labels.push(INPUT_COPY.other);
		if (labels.includes(entries[0])) return entries.length === 1 || entries[1].startsWith("user_note: ");
		return entries.length === 1 && (question.isOther !== false || !labels.length);
	});
}
