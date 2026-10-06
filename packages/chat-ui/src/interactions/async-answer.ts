/** Presentation only; the original correlated reply remains model-facing. */
export function asyncAnswerSummary(text: string): string | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const reply = value as Record<string, unknown>;
	if (
		reply.type !== "user_input_reply" ||
		typeof reply.itemId !== "string" ||
		typeof reply.questionId !== "string" ||
		typeof reply.answer !== "string"
	)
		return undefined;
	if (Object.keys(reply).sort().join(",") !== "answer,itemId,questionId,type") return undefined;
	return `Answer recorded: ${reply.answer.replace(/^user_note:\s*/, "")}`;
}
