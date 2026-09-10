import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { SessionEntry } from "../session/session-manager";

export interface HistoryTurn {
	id: string;
	items: Record<string, unknown>[];
	itemsView: string;
	status: string;
	error: { message: string; codexErrorInfo: null; additionalDetails: null } | null;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
}
export type TimelineEntry =
	| { type: "item"; position: number; turnId: string; item: Record<string, unknown> }
	| { type: "realtime"; position: number; item: Record<string, unknown> }
	| { type: "turnStarted"; position: number; turnId: string; startedAt: number | null }
	| ({ type: "turnCompleted"; position: number; turnId: string } & Pick<
			HistoryTurn,
			"status" | "error" | "startedAt" | "completedAt" | "durationMs"
	  >);
export interface TimelineRow {
	sourceId: string;
	entry: TimelineEntry;
}
export function historyError() {
	return {
		message: "The selected model could not complete this turn. Check the terminal for details.",
		codexErrorInfo: null,
		additionalDetails: null,
	};
}
export function newHistoryTurn(id: string, status = "completed"): HistoryTurn {
	return {
		id,
		items: [],
		itemsView: "full",
		status,
		error: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
	};
}
export function assistantHistoryItem(id: string, text: string, phase: string | undefined = "final_answer") {
	return { type: "agentMessage", id, text, phase, memoryCitation: null, delivery: null, questions: null };
}
export function messageKey(message: AgentMessage): string {
	return JSON.stringify([
		message.role,
		"timestamp" in message ? message.timestamp : null,
		message.role === "toolResult" ? message.toolCallId : null,
	]);
}
export function completeToolHistoryItem(
	item: Record<string, unknown>,
	message: Extract<AgentMessage, { role: "toolResult" }>,
): Record<string, unknown> {
	return {
		...item,
		status: message.isError ? "failed" : "completed",
		success: !message.isError,
		contentItems: message.content.flatMap((part): Record<string, unknown>[] =>
			part.type === "text"
				? [{ type: "inputText", text: part.text }]
				: part.type === "image"
					? [{ type: "inputImage", imageUrl: `data:${part.mimeType};base64,${part.data}` }]
					: [],
		),
	};
}
export function messageHistoryItems(
	id: string,
	message: AgentMessage,
	clientId: string | null = null,
): Record<string, unknown>[] {
	if (message.role === "user") {
		const content =
			typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
		return [
			{
				type: "userMessage",
				id,
				clientId,
				content: content.flatMap((part): Record<string, unknown>[] =>
					part.type === "text"
						? [{ type: "text", text: part.text, text_elements: [] }]
						: part.type === "image"
							? [{ type: "image", url: `data:${part.mimeType};base64,${part.data}` }]
							: [],
				),
			},
		];
	}
	if (message.role !== "assistant") return [];
	return message.content.flatMap((part, index): Record<string, unknown>[] => {
		if (part.type === "text" && part.text) return [assistantHistoryItem(`${id}:${index}`, part.text, part.phase)];
		if (part.type === "toolCall")
			return [
				{
					type: "dynamicToolCall",
					id: `${id}:tool:${part.id}`,
					namespace: null,
					tool: part.name,
					arguments: part.arguments,
					status: "inProgress",
					contentItems: null,
					success: null,
					durationMs: null,
				},
			];
		return [];
	});
}

/** Project the selected persisted branch, never the compacted model context.
 * Metadata records contain identities/boundaries only; AgentSession still owns
 * the corresponding message append (which occurs after subscriber notification).
 */
export function projectHistory(threadId: string, entries: readonly SessionEntry[], running = false): HistoryTurn[] {
	return projectHistorySnapshot(threadId, entries, running).turns;
}
export function projectHistorySnapshot(
	threadId: string,
	entries: readonly SessionEntry[],
	running = false,
): { turns: HistoryTurn[]; timeline: TimelineRow[] } {
	const turns: HistoryTurn[] = [];
	const timeline: TimelineRow[] = [];
	const inferredEnds: { turn: HistoryTurn; position: number; sourceId: string }[] = [];
	let lastMessage = { position: 0, sourceId: "" };
	const complete = (value: HistoryTurn, position: number, sourceId: string) => {
		timeline.push({
			sourceId,
			entry: {
				type: "turnCompleted",
				position,
				turnId: value.id,
				status: value.status,
				error: value.error,
				startedAt: value.startedAt,
				completedAt: value.completedAt,
				durationMs: value.durationMs,
			},
		});
	};
	const tools = new Map<string, Record<string, unknown>>();
	let current: HistoryTurn | undefined;
	let explicit = false;
	let continuingTools = false;
	let marker: { key: string; id: string; clientId: string | null } | undefined;
	let startMs = 0;
	for (const [index, entry] of entries.entries()) {
		const position = index + 1;
		const ms = Date.parse(entry.timestamp);
		if (
			entry.type === "custom" &&
			entry.customType === "remote-realtime" &&
			entry.data &&
			typeof entry.data === "object"
		) {
			const record = entry.data as Record<string, unknown>;
			if (record.kind === "voiceTimeline")
				timeline.push({
					sourceId: entry.id,
					entry: { type: "realtime", position, item: record.item as Record<string, unknown> },
				});
		}
		if (
			entry.type === "custom" &&
			entry.customType === "remote-history" &&
			entry.data &&
			typeof entry.data === "object"
		) {
			const record = entry.data as Record<string, unknown>;
			if (record.kind === "turnStarted" && typeof record.id === "string") {
				if (current && !explicit) inferredEnds.push({ turn: current, ...lastMessage });
				current = newHistoryTurn(record.id, "inProgress");
				startMs = typeof record.startedAtMs === "number" ? record.startedAtMs : ms;
				current.startedAt = Math.floor(startMs / 1000);
				turns.push(current);
				timeline.push({
					sourceId: entry.id,
					entry: { type: "turnStarted", position, turnId: current.id, startedAt: current.startedAt },
				});
				explicit = true;
				marker = undefined;
			} else if (record.kind === "turnCompleted" && current && current.id === record.id) {
				current.status = ["completed", "failed", "interrupted"].includes(String(record.status))
					? String(record.status)
					: "interrupted";
				current.error = current.status === "failed" ? historyError() : null;
				const end = typeof record.completedAtMs === "number" ? record.completedAtMs : ms;
				current.completedAt = Math.floor(end / 1000);
				current.durationMs = Math.max(0, end - startMs);
				complete(current, position, entry.id);
				current = undefined;
				explicit = false;
				marker = undefined;
			} else if (record.kind === "message" && typeof record.id === "string" && typeof record.key === "string") {
				marker = {
					id: record.id,
					key: record.key,
					clientId: typeof record.clientId === "string" ? record.clientId : null,
				};
			}
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		const identity = marker?.key === messageKey(message) ? marker : undefined;
		marker = undefined;
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		if (!current || (message.role === "user" && !explicit && !continuingTools)) {
			if (current && !explicit) inferredEnds.push({ turn: current, ...lastMessage });
			current = newHistoryTurn(`${threadId}-turn-${entry.id}`);
			startMs = ms;
			current.startedAt = Math.floor(ms / 1000);
			turns.push(current);
			timeline.push({
				sourceId: entry.id,
				entry: { type: "turnStarted", position, turnId: current.id, startedAt: current.startedAt },
			});
			continuingTools = false;
		}
		const messageId = identity?.id ?? `${threadId}-item-${entry.id}`;
		const items = messageHistoryItems(messageId, message, identity?.clientId);
		current.items.push(...items);
		for (const item of items)
			timeline.push({ sourceId: entry.id, entry: { type: "item", position, turnId: current.id, item } });
		lastMessage = { position, sourceId: entry.id };
		if (message.role === "assistant")
			for (const part of message.content)
				if (part.type === "toolCall") {
					const item = items.find(value => value.id === `${messageId}:tool:${part.id}`);
					if (item) tools.set(part.id, item);
				}
		if (message.role === "toolResult") {
			const item = tools.get(message.toolCallId);
			if (item) Object.assign(item, completeToolHistoryItem(item, message));
		}
		if (message.role === "assistant") {
			continuingTools = message.stopReason === "toolUse";
			if (message.stopReason === "error") {
				current.status = "failed";
				current.error = historyError();
			} else if (message.stopReason === "aborted") {
				current.status = "interrupted";
				current.error = null;
			} else {
				current.status = explicit || continuingTools ? "inProgress" : "completed";
				current.error = null;
			}
		}
		if (!explicit) {
			current.completedAt = Math.floor(ms / 1000);
			current.durationMs = Math.max(0, ms - startMs);
		}
	}
	for (const value of turns)
		if (value.status === "inProgress" && (!running || value !== turns.at(-1))) value.status = "interrupted";
	if (current && !explicit && current.status !== "inProgress") inferredEnds.push({ turn: current, ...lastMessage });
	for (const value of inferredEnds) complete(value.turn, value.position, value.sourceId);
	return { turns, timeline };
}
