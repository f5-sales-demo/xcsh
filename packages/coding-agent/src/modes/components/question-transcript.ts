import type { Component } from "@f5-sales-demo/pi-tui";
import type { AsyncInputQuestion, AsyncQuestionItem } from "../../../../chat-ui/src/interactions/contract";
import { theme } from "../theme/theme";
import { selectorFrame, selectorFrameContentWidth, selectorProse, selectorRow } from "./selector-frame";

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
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (
		!record(value) ||
		value.type !== "user_input_reply" ||
		typeof value.itemId !== "string" ||
		typeof value.questionId !== "string" ||
		typeof value.answer !== "string"
	)
		return undefined;
	return { type: "user_input_reply", itemId: value.itemId, questionId: value.questionId, answer: value.answer };
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
		const inner = selectorFrameContentWidth(width);
		if (this.state.kind === "pending") {
			const count = this.state.item.questions.length;
			return selectorFrame(
				width,
				Math.max(8, count + 7),
				"Questions pending",
				`${count} ${count === 1 ? "question" : "questions"} · Work continues while you answer`,
				[],
				this.state.item.questions.map((question, index) =>
					selectorRow([`${index + 1}. ${question.title}`], [inner - 2], false),
				),
				[],
				[`${theme.fg("contentAccent", "/questions")} to answer`],
			);
		}
		const { question, reply, position, total } = this.state.resolved;
		const answer = question.isSecret
			? theme.fg("muted", "Answer hidden")
			: reply.answer.replace(/^user_note:\s*/, "");
		return selectorFrame(
			width,
			8,
			"Answer recorded",
			`Question ${position + 1} of ${total}`,
			[question.title],
			[selectorProse(`${theme.symbol("checkbox.checked")} ${answer}`)],
			[],
			[],
		);
	}

	invalidate(): void {}
}
