export interface QuestionReply {
	answer: string;
	question: string;
	questionItemId: string;
}

/** Bound model-authored framing in UTF-8 bytes as Codex AnsweredQuestion does. */
export function createQuestionReply(questionItemId: string, question: string, answer: string): string {
	const encoder = new TextEncoder();
	let bounded = "";
	for (const char of question) {
		if (encoder.encode(bounded + char).length > 512) break;
		bounded += char;
	}
	bounded = bounded.replace(/[\n\r]/g, " ");
	if (encoder.encode(questionItemId).length > 512) return `> ${bounded}\n\n${answer}`;
	return `<send_user_message_question_reply>\n${JSON.stringify([{ answer, question: bounded, questionItemId }])}\n</send_user_message_question_reply>`;
}

export function parseQuestionReplies(text: string): QuestionReply[] | undefined {
	const match = /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/.exec(text);
	if (!match) return undefined;
	try {
		const replies: unknown = JSON.parse(match[1]);
		if (!Array.isArray(replies) || !replies.length) return undefined;
		if (
			!replies.every(
				reply =>
					reply &&
					typeof reply === "object" &&
					!Array.isArray(reply) &&
					Object.keys(reply).sort().join(",") === "answer,question,questionItemId" &&
					typeof reply.answer === "string" &&
					typeof reply.question === "string" &&
					typeof reply.questionItemId === "string",
			)
		)
			return undefined;
		return replies;
	} catch {
		return undefined;
	}
}

/** Presentation only; the original correlated reply remains model-facing. */
export function asyncAnswerSummary(text: string): string | undefined {
	return parseQuestionReplies(text)
		?.map(reply => `Answer recorded: ${reply.answer}`)
		.join("\n\n");
}
