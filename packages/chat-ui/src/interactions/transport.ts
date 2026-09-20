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
	  }
	| { type: "interaction_cancel"; requestId: string; identity: InteractionIdentity }
	| { type: "plan_decide"; planId: string; action: PlanAction; responseId: string };
export type InteractionFrame =
	| {
			type: "interaction_snapshot";
			sessionId: string;
			revision: number;
			pending: PendingInteraction[];
			plan?: ConversationPlan;
	  }
	| {
			type: "interaction_event";
			revision: number;
			event: { type: "opened" | "resolved"; interaction: PendingInteraction; reason?: string };
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
export function isInteractionCommand(value: unknown): value is InteractionCommand {
	if (!record(value)) return false;
	if (value.type === "interaction_snapshot") return value.after === undefined || revision(value.after);
	if (value.type === "plan_decide")
		return id(value.planId) && id(value.responseId) && ["implement", "fresh", "stay"].includes(String(value.action));
	if (!id(value.requestId) || !isInteractionIdentity(value.identity)) return false;
	return (
		value.type === "interaction_cancel" ||
		(value.type === "interaction_respond" && id(value.responseId) && value.value !== undefined)
	);
}
export function isInteractionFrame(value: unknown): value is InteractionFrame {
	if (!record(value)) return false;
	if (value.type === "interaction_snapshot")
		return (
			id(value.sessionId) &&
			revision(value.revision) &&
			Array.isArray(value.pending) &&
			value.pending.length <= 32 &&
			value.pending.every(pending) &&
			(value.plan === undefined || plan(value.plan))
		);
	if (value.type === "interaction_event")
		return (
			revision(value.revision) &&
			record(value.event) &&
			["opened", "resolved"].includes(String(value.event.type)) &&
			pending(value.event.interaction) &&
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
