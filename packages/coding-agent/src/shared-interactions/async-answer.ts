import { asyncReplyRecap, recapText } from "./answer-recap";

export { createQuestionReply, parseQuestionReplies, type QuestionReply } from "./question-reply";

/** Presentation only; the original correlated reply remains model-facing. */
export function asyncAnswerSummary(text: string): string | undefined {
	const recap = asyncReplyRecap(text);
	return recap ? recapText(recap) : undefined;
}
