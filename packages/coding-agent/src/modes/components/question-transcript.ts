import type { Component } from "@f5-sales-demo/pi-tui";
import {
	type AnswerDelivery,
	type AnswerRecap,
	answerRecap,
	asyncReplyRecap,
} from "../../../../chat-ui/src/interactions/answer-recap";
import { parseQuestionReplies } from "../../../../chat-ui/src/interactions/async-answer";
import type {
	AsyncInputQuestion,
	AsyncQuestionItem,
	InputQuestion,
} from "../../../../chat-ui/src/interactions/contract";
import { theme } from "../theme/theme";
import { AnswerRecapComponent } from "./answer-recap";
import { selectorProse, selectorTranscriptFrame } from "./selector-frame";

export function asyncBatchRecap(
	text: string,
	batches: ReadonlyMap<string, { item: AsyncQuestionItem; questionIds: string[] }>,
	state: AnswerDelivery = "recorded",
): AnswerRecap | undefined {
	const originals: InputQuestion[] = [];
	for (const batch of batches.values()) {
		batch.item.questions.forEach((question, index) => {
			originals.push({
				id: batch.questionIds[index]!,
				header: question.title,
				question: question.title,
				isSecret: (question as { isSecret?: boolean }).isSecret,
				options: question.options?.map(label => ({ label, description: "" })),
			});
		});
	}
	return asyncReplyRecap(text, originals, state);
}

export interface AsyncInputReply {
	type: "user_input_reply";
	itemId: string;
	questionId: string;
	answer: string;
}

export interface ResolvedAsyncQuestionReply {
	reply: AsyncInputReply;
	question: AsyncInputQuestion & { isSecret?: boolean };
	position: number;
	total: number;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseAsyncInputReply(text: string): AsyncInputReply | undefined {
	try {
		const legacy: unknown = JSON.parse(text);
		if (
			record(legacy) &&
			legacy.type === "user_input_reply" &&
			typeof legacy.itemId === "string" &&
			typeof legacy.questionId === "string" &&
			typeof legacy.answer === "string"
		)
			return {
				type: "user_input_reply",
				itemId: legacy.itemId,
				questionId: legacy.questionId,
				answer: legacy.answer,
			};
	} catch {
		/* Canonical envelopes and ordinary user prose. */
	}
	const reply = parseQuestionReplies(text)?.[0];
	if (!reply) return undefined;
	let identity: unknown;
	try {
		identity = JSON.parse(reply.questionItemId);
	} catch {
		return undefined;
	}
	if (
		!Array.isArray(identity) ||
		identity.length !== 3 ||
		identity[0] !== "request_user_input_async" ||
		typeof identity[1] !== "string" ||
		!Number.isSafeInteger(identity[2])
	)
		return undefined;
	return {
		type: "user_input_reply",
		itemId: identity[1],
		questionId: reply.questionItemId,
		answer: reply.answer,
	};
}

export function resolveAsyncQuestionReply(
	messages: readonly unknown[],
	reply: AsyncInputReply,
): ResolvedAsyncQuestionReply | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!record(message) || message.role !== "custom" || message.customType !== "async-user-input") continue;
		const details = message.details;
		if (!record(details) || !record(details.item) || details.item.id !== reply.itemId) continue;
		if (!Array.isArray(details.questionIds) || !Array.isArray(details.item.questions)) continue;
		return resolveAsyncQuestionReplyFromItem(
			details.item as unknown as AsyncQuestionItem,
			details.questionIds,
			reply,
		);
	}
	return undefined;
}

export function resolveAsyncQuestionReplyFromItem(
	item: AsyncQuestionItem,
	questionIds: readonly unknown[],
	reply: AsyncInputReply,
): ResolvedAsyncQuestionReply | undefined {
	if (item.id !== reply.itemId || !Array.isArray(item.questions)) return undefined;
	const position = questionIds.indexOf(reply.questionId);
	const question = item.questions[position];
	if (position < 0 || !record(question) || typeof question.title !== "string") return undefined;
	return {
		reply,
		question: {
			title: question.title,
			...(Array.isArray(question.options) && question.options.every(option => typeof option === "string")
				? { options: question.options }
				: {}),
			...(question.isSecret === true ? { isSecret: true } : {}),
		},
		position,
		total: item.questions.length,
	};
}

export class QuestionTranscriptComponent implements Component {
	private constructor(
		private readonly state:
			| { kind: "pending"; item: AsyncQuestionItem }
			| { kind: "answered"; resolved: ResolvedAsyncQuestionReply },
	) {}

	static pending(item: AsyncQuestionItem): QuestionTranscriptComponent {
		return new QuestionTranscriptComponent({ kind: "pending", item });
	}

	static answered(resolved: ResolvedAsyncQuestionReply): QuestionTranscriptComponent {
		return new QuestionTranscriptComponent({ kind: "answered", resolved });
	}

	render(width: number): string[] {
		if (this.state.kind === "pending") {
			const count = this.state.item.questions.length;
			return selectorTranscriptFrame(
				width,
				"Questions pending",
				`${count} ${count === 1 ? "question" : "questions"} · Work continues while you answer`,
				this.state.item.questions.map((question, index) => selectorProse(`${index + 1}. ${question.title}`)),
				[`${theme.fg("contentAccent", "/questions")} to answer`],
			);
		}
		const { question, reply } = this.state.resolved;
		return new AnswerRecapComponent(
			answerRecap(
				[
					{
						id: reply.questionId,
						header: question.title,
						question: question.title,
						isSecret: question.isSecret,
						options: question.options?.map(label => ({ label, description: "" })),
					},
				],
				{ answers: { [reply.questionId]: { answers: [reply.answer] } } },
				"recorded",
				false,
			),
		).render(width);
	}

	invalidate(): void {}
}
