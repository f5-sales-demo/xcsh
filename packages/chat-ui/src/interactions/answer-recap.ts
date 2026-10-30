import { INPUT_COPY, type InputQuestion, type InputResponse } from "./contract";
import { parseQuestionReplies } from "./question-reply";

/** Presentation data only. Never substitute this for model-facing answers. */
export type AnswerDelivery = "pending" | "asked" | "recorded" | "queued" | "delivered" | "failed" | "interrupted";
export interface AnswerRecapRow {
	id: string;
	topic: string;
	question: string;
	answer: string;
	description?: string;
	notes?: string;
}
export interface AnswerRecap {
	state: AnswerDelivery;
	rows: AnswerRecapRow[];
}

export interface AnswerRecapRecord {
	id: string;
	recap: AnswerRecap;
	evidence?: string;
	toolCallId?: string;
}

/** Question identities survive replay and retries; text is never an identity. */
export function unseenAnswerRecap(recap: AnswerRecap, seen: Set<string>): AnswerRecap | undefined {
	const rows = recap.rows.filter(row => {
		if (seen.has(row.id)) return false;
		seen.add(row.id);
		return true;
	});
	return rows.length ? { ...recap, rows } : undefined;
}
export const DELIVERY_COPY: Record<AnswerDelivery, string> = {
	pending: "Questions pending",
	asked: "Questions asked",
	recorded: "Answers recorded",
	queued: "Queued for the next model response",
	delivered: "Answers delivered",
	failed: "Delivery failed",
	interrupted: "Questions interrupted",
};

function row(question: InputQuestion, values: readonly string[], encodedFreeText: boolean): AnswerRecapRow {
	const selected = question.options?.find(option => option.label === values[0]);
	const other = question.isOther && values[0] === INPUT_COPY.other;
	const raw = values[other ? 1 : 0] ?? "";
	const custom = encodedFreeText && raw.startsWith("user_note: ") ? raw.slice(11) : raw;
	return {
		id: question.id,
		topic: selected ? question.header : question.question,
		question: question.question,
		answer: question.isSecret
			? values.length
				? "Answer hidden"
				: "No answer provided"
			: (selected
					? selected.label.replace(/\s*\(Recommended\)$/i, "")
					: other
						? custom || INPUT_COPY.other
						: custom) || "No answer provided",
		description: question.isSecret ? undefined : selected?.description || undefined,
		notes: !question.isSecret && selected && values[1]?.startsWith("user_note: ") ? values[1].slice(11) : undefined,
	};
}

export function answerRecap(
	questions: readonly InputQuestion[],
	response: InputResponse | undefined,
	state: AnswerDelivery,
	encodedFreeText = true,
): AnswerRecap {
	return {
		state,
		rows: questions.map(question => row(question, response?.answers[question.id]?.answers ?? [], encodedFreeText)),
	};
}

export function recapText(recap: AnswerRecap): string {
	return [
		DELIVERY_COPY[recap.state],
		...recap.rows.map(value =>
			recap.state === "pending" || recap.state === "asked"
				? value.question
				: [
						value.topic + " — " + value.answer,
						value.description,
						value.notes === undefined ? undefined : "Notes: " + value.notes,
					]
						.filter(value => value !== undefined)
						.join("\n"),
		),
	].join("\n\n");
}

/** Full safe questions and submitted values for existing disclosure controls. */
export function safeQuestionEvidence(questions: readonly InputQuestion[], response?: InputResponse): string {
	const answers = response
		? Object.fromEntries(
				questions.map(question => [
					question.id,
					{
						answers:
							question.isSecret && response.answers[question.id]?.answers.length
								? ["Answer hidden"]
								: (response.answers[question.id]?.answers ?? []),
					},
				]),
			)
		: undefined;
	return JSON.stringify(
		{
			questions: questions.map(question => (question.isSecret ? { ...question, options: undefined } : question)),
			...(answers ? { answers } : {}),
		},
		null,
		2,
	);
}

export function asyncReplyRecap(
	text: string,
	questions?: readonly InputQuestion[],
	state: AnswerDelivery = "recorded",
): AnswerRecap | undefined {
	const replies = parseQuestionReplies(text);
	if (!replies) return undefined;
	const originals = questions?.filter(question => replies.some(reply => reply.questionItemId === question.id));
	const ordered = [
		...(originals ?? []),
		...replies
			.filter(reply => !originals?.some(question => question.id === reply.questionItemId))
			.map(reply => ({ id: reply.questionItemId, header: reply.question, question: reply.question })),
	];
	return {
		state,
		rows: ordered.map(question =>
			row(question, [replies.find(reply => reply.questionItemId === question.id)?.answer ?? ""], false),
		),
	};
}

/** Adapter-friendly projection; arguments and results remain unchanged. */
export function questionToolRecap(
	tool: string | undefined,
	args: unknown,
	text: string,
	running = false,
	ok = true,
): { recap: AnswerRecap; evidence: string } | undefined {
	if (tool !== "request_user_input" && tool !== "request_user_input_async") return undefined;
	const source = (args as { questions?: unknown[] } | undefined)?.questions;
	if (!Array.isArray(source))
		return {
			recap: { state: ok ? "pending" : "failed", rows: [] },
			evidence: "Original question details unavailable; answer payload hidden.",
		};
	const questions: InputQuestion[] = source.flatMap((value, index) => {
		if (!value || typeof value !== "object") return [];
		const question = value as Partial<InputQuestion> & { title?: string };
		const prompt = question.question ?? question.title;
		if (typeof prompt !== "string") return [];
		return [
			{
				id: question.id ?? String(index),
				header: question.header ?? prompt,
				question: prompt,
				isSecret: question.isSecret,
				isOther: tool === "request_user_input" ? (question.isOther ?? true) : false,
				options: question.options?.map(option =>
					typeof option === "string" ? { label: option, description: "" } : option,
				),
			},
		];
	});
	let response: InputResponse | undefined;
	if (ok && !running && tool === "request_user_input") {
		try {
			const parsed = JSON.parse(text);
			if (parsed && typeof parsed.answers === "object" && parsed.answers) response = parsed;
		} catch {
			/* A failed or incomplete result is not an accepted answer. */
		}
	}
	const state: AnswerDelivery = !ok
		? /^(?:Interrupted|Aborted|Cancelled|Canceled)(?:[.!:]|$)/i.test(text.trim())
			? "interrupted"
			: "failed"
		: response
			? "recorded"
			: tool === "request_user_input_async" && !running
				? "asked"
				: "pending";
	const evidence = safeQuestionEvidence(questions, response);
	return {
		recap: answerRecap(questions, response, state),
		evidence:
			tool === "request_user_input_async" && ok && !running
				? `${evidence}\n\nAcknowledgement: ${JSON.stringify(safeAcknowledgement(text))}`
				: evidence,
	};
}

function safeAcknowledgement(text: string): unknown {
	try {
		const value = JSON.parse(text);
		return {
			...(typeof value.accepted === "boolean" ? { accepted: value.accepted } : {}),
			...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
			...(Array.isArray(value.questionIds) && value.questionIds.every((id: unknown) => typeof id === "string")
				? { questionIds: value.questionIds }
				: {}),
		};
	} catch {
		return "Acknowledgement unavailable";
	}
}
