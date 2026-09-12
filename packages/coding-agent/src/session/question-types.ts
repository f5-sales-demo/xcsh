/** Structured questions shared by the terminal form, tools and remote protocol. */
export interface InteractionQuestion {
	id: string;
	question: string;
	header?: string;
	options: readonly { label: string; description?: string }[];
	multi?: boolean;
	recommended?: number;
	isOther?: boolean;
	isSecret?: boolean;
}
export interface QuestionAnswer {
	selectedOptions: string[];
	customInput?: string;
}
export type QuestionAnswers = Record<string, QuestionAnswer>;

export function validQuestionAnswers(
	questions: readonly InteractionQuestion[],
	value: unknown,
): value is QuestionAnswers {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (Object.keys(value).length !== questions.length) return false;
	const answers = value as Record<string, unknown>;
	return questions.every(question => {
		if (!Object.hasOwn(answers, question.id)) return false;
		const answer = answers[question.id] as QuestionAnswer | null;
		if (!answer || typeof answer !== "object" || Array.isArray(answer) || !Array.isArray(answer.selectedOptions))
			return false;
		if (
			answer.selectedOptions.some(
				option => typeof option !== "string" || !question.options.some(value => value.label === option),
			)
		)
			return false;
		if (new Set(answer.selectedOptions).size !== answer.selectedOptions.length) return false;
		if (answer.customInput !== undefined && (typeof answer.customInput !== "string" || question.isOther === false))
			return false;
		return question.multi === true || answer.selectedOptions.length + (answer.customInput === undefined ? 0 : 1) <= 1;
	});
}

/** The answer map and wire protocol require unambiguous, bounded question identities. */
export function validQuestionGroup(questions: readonly InteractionQuestion[]): boolean {
	return (
		questions.length > 0 &&
		new Set(questions.map(question => question.id)).size === questions.length &&
		questions.every(
			question =>
				typeof question.id === "string" &&
				question.id.length > 0 &&
				question.id.length <= 256 &&
				new Set(question.options.map(option => option.label)).size === question.options.length,
		)
	);
}
