import { type AnswerRecap, type AnswerRecapRecord, DELIVERY_COPY } from "./answer-recap";
import type { InputQuestion } from "./contract";
import type { ConversationPlan, PlanAction } from "./conversation-plan";

export interface InteractionIdentity {
	sessionId: string;
	threadId: string;
	turnId: string;
	itemId: string;
	generation: number;
}
export interface PendingInteraction {
	isBlocking?: boolean;
	autoResolutionMs?: number | null;
	id: string;
	kind: string;
	title: string;
	delivery?: "waiting" | "async";
	questionId?: string;
	inputQuestions?: readonly InputQuestion[];
	options?: readonly string[];
	identity?: InteractionIdentity;
}
export type InteractionCommand =
	| { type: "interaction_snapshot"; after?: number }
	| {
			type: "interaction_respond";
			requestId: string;
			responseId: string;
			identity: InteractionIdentity;
			value: unknown;
			chatId?: string;
	  }
	| { type: "interaction_cancel"; requestId: string; identity: InteractionIdentity }
	| { type: "plan_decide"; planId: string; action: PlanAction; responseId: string };
export type InteractionFrame =
	| { type: "interaction_error"; itemId: string; failureId?: string; message: string }
	| {
			type: "interaction_snapshot";
			sessionId: string;
			revision: number;
			pending: PendingInteraction[];
			presentations?: AnswerRecapRecord[];
			plan?: ConversationPlan;
	  }
	| {
			type: "interaction_event";
			revision: number;
			event: {
				type: "opened" | "resolved";
				interaction: PendingInteraction;
				reason?: string;
				presentation?: import("./answer-recap").AnswerRecap;
				presentationEvidence?: string;
			};
	  }
	| { type: "interaction_receipt"; responseId: string; accepted: boolean; error?: string }
	| { type: "plan_available"; plan: ConversationPlan }
	| { type: "plan_resolved"; planId: string };
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(entry => typeof entry === "string");
export function isInteractionIdentity(value: unknown): value is InteractionIdentity {
	return (
		record(value) &&
		Object.keys(value).length === 5 &&
		[value.sessionId, value.threadId, value.turnId, value.itemId].every(id) &&
		revision(value.generation)
	);
}
function question(value: unknown): boolean {
	return (
		record(value) &&
		id(value.id) &&
		typeof value.header === "string" &&
		typeof value.question === "string" &&
		(value.isOther === undefined || typeof value.isOther === "boolean") &&
		(value.isSecret === undefined || typeof value.isSecret === "boolean") &&
		(value.options == null ||
			(Array.isArray(value.options) &&
				value.options.every(
					option => record(option) && typeof option.label === "string" && typeof option.description === "string",
				)))
	);
}
function pending(value: unknown): value is PendingInteraction {
	return (
		record(value) &&
		id(value.id) &&
		["input", "select", "request_user_input"].includes(String(value.kind)) &&
		typeof value.title === "string" &&
		(value.identity === undefined || isInteractionIdentity(value.identity)) &&
		(value.delivery === undefined || value.delivery === "waiting" || value.delivery === "async") &&
		(value.questionId === undefined || id(value.questionId)) &&
		(value.options === undefined || strings(value.options)) &&
		(value.kind !== "request_user_input" ||
			(Array.isArray(value.inputQuestions) &&
				value.inputQuestions.length > 0 &&
				value.inputQuestions.every(question)))
	);
}
function plan(value: unknown): value is ConversationPlan {
	return (
		record(value) &&
		id(value.id) &&
		id(value.itemId) &&
		revision(value.revision) &&
		typeof value.markdown === "string" &&
		["pending", "resolved", "superseded"].includes(String(value.status))
	);
}
function recap(value: unknown): value is AnswerRecap {
	return (
		record(value) &&
		typeof value.state === "string" &&
		Object.hasOwn(DELIVERY_COPY, value.state) &&
		Array.isArray(value.rows) &&
		value.rows.every(
			row =>
				record(row) &&
				id(row.id) &&
				[row.topic, row.question, row.answer].every(value => typeof value === "string") &&
				[row.description, row.notes].every(value => value === undefined || typeof value === "string"),
		)
	);
}
export function isInteractionCommand(value: unknown): value is InteractionCommand {
	if (!record(value)) return false;
	if (value.type === "interaction_snapshot") return value.after === undefined || revision(value.after);
	if (value.type === "plan_decide")
		return id(value.planId) && id(value.responseId) && ["implement", "fresh", "stay"].includes(String(value.action));
	if (!id(value.requestId) || !isInteractionIdentity(value.identity)) return false;
	return (
		value.type === "interaction_cancel" ||
		(value.type === "interaction_respond" &&
			id(value.responseId) &&
			value.value !== undefined &&
			(value.chatId === undefined ||
				(typeof value.chatId === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value.chatId))))
	);
}
export function isInteractionFrame(value: unknown): value is InteractionFrame {
	if (!record(value)) return false;
	if (value.type === "interaction_error")
		return (
			id(value.itemId) &&
			typeof value.message === "string" &&
			(value.failureId === undefined || typeof value.failureId === "string")
		);
	if (value.type === "interaction_snapshot")
		return (
			id(value.sessionId) &&
			revision(value.revision) &&
			Array.isArray(value.pending) &&
			value.pending.length <= 32 &&
			value.pending.every(pending) &&
			(value.plan === undefined || plan(value.plan)) &&
			(value.presentations === undefined ||
				(Array.isArray(value.presentations) &&
					value.presentations.length <= 1024 &&
					value.presentations.every(
						entry =>
							record(entry) &&
							id(entry.id) &&
							recap(entry.recap) &&
							(entry.evidence === undefined || typeof entry.evidence === "string") &&
							(entry.toolCallId === undefined || id(entry.toolCallId)),
					)))
		);
	if (value.type === "interaction_event")
		return (
			revision(value.revision) &&
			record(value.event) &&
			["opened", "resolved"].includes(String(value.event.type)) &&
			pending(value.event.interaction) &&
			(value.event.presentation === undefined || recap(value.event.presentation)) &&
			(value.event.presentationEvidence === undefined || typeof value.event.presentationEvidence === "string") &&
			(value.event.reason === undefined ||
				["answered", "cancelled", "interrupted", "dismissed", "expired", "superseded", "owner_lost"].includes(
					String(value.event.reason),
				))
		);
	if (value.type === "interaction_receipt")
		return (
			id(value.responseId) &&
			typeof value.accepted === "boolean" &&
			(value.error === undefined || typeof value.error === "string")
		);
	return value.type === "plan_available" ? plan(value.plan) : value.type === "plan_resolved" && id(value.planId);
}
