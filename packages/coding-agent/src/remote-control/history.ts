import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { SessionEntry } from "../session/session-manager";
import { updateFileHistoryItem } from "./file-changes";

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
export interface HistoryToolContext {
	cwd: string;
	commandCallIds: string[];
	fileCallIds?: string[];
}
function commandHistoryItem(id: string, command: string, cwd: string): Record<string, unknown> {
	return {
		type: "commandExecution",
		id,
		pluginId: null,
		scriptPath: null,
		command,
		cwd,
		processId: null,
		source: "agent",
		status: "inProgress",
		commandActions: [],
		aggregatedOutput: null,
		exitCode: null,
		durationMs: null,
	};
}
export function updateCommandHistoryItem(
	item: Record<string, unknown>,
	value: unknown,
): Record<string, unknown> | undefined {
	const execution = value as Record<string, unknown> | undefined;
	if (
		execution?.kind === "command" &&
		typeof execution.command === "string" &&
		typeof execution.cwd === "string" &&
		typeof execution.aggregatedOutput === "string" &&
		(execution.processId === null || typeof execution.processId === "string") &&
		(execution.exitCode === null ||
			(typeof execution.exitCode === "number" &&
				Number.isInteger(execution.exitCode) &&
				execution.exitCode >= -2147483648 &&
				execution.exitCode <= 2147483647)) &&
		(execution.durationMs === null ||
			(typeof execution.durationMs === "number" &&
				Number.isSafeInteger(execution.durationMs) &&
				execution.durationMs >= 0)) &&
		["inProgress", "completed", "failed"].includes(String(execution.status))
	) {
		const result = { ...item };
		for (const key of ["command", "cwd", "aggregatedOutput", "processId", "exitCode", "durationMs", "status"])
			result[key] = execution[key];
		return result;
	}
	return undefined;
}
export interface BackgroundCommand {
	turnId: string;
	item: Record<string, unknown>;
}
export function backgroundCommandCompletion(
	message: AgentMessage,
	jobs: Map<string, BackgroundCommand>,
): (BackgroundCommand & { jobId: string }) | undefined {
	if (message.role !== "custom" || message.customType !== "async-result") return;
	const details = message.details as { jobId?: unknown; execution?: unknown } | undefined;
	const job = typeof details?.jobId === "string" ? jobs.get(details.jobId) : undefined;
	if (job?.item.status !== "inProgress") return;
	const item = updateCommandHistoryItem(job.item, details?.execution);
	if (!item || item.status === "inProgress") return;
	return { turnId: job.turnId, item, jobId: details!.jobId as string };
}
export function completeToolHistoryItem(
	item: Record<string, unknown>,
	message: Extract<AgentMessage, { role: "toolResult" }>,
): Record<string, unknown> {
	if (item.type === "fileChange") {
		const details = message.details as { execution?: unknown } | undefined;
		return (
			updateFileHistoryItem(item, details?.execution) ?? {
				...item,
				status: message.isError ? "failed" : "completed",
			}
		);
	}
	if (item.type === "commandExecution") {
		const details = message.details as { execution?: Record<string, unknown> } | undefined;
		const execution = details?.execution;
		const result: Record<string, unknown> = { ...item, status: message.isError ? "failed" : "completed" };
		const updated = updateCommandHistoryItem(item, execution);
		if (updated) return updated;
		result.aggregatedOutput = message.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join("\n");
		return result;
	}
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
	tools?: HistoryToolContext,
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
		if (part.type === "toolCall") {
			if (Array.isArray(tools?.fileCallIds) && tools.fileCallIds.includes(part.id))
				return [{ type: "fileChange", id: `${id}:tool:${part.id}`, changes: [], status: "inProgress" }];
			if (
				typeof tools?.cwd === "string" &&
				Array.isArray(tools.commandCallIds) &&
				tools.commandCallIds.includes(part.id)
			)
				return [
					commandHistoryItem(
						`${id}:tool:${part.id}`,
						typeof part.arguments?.command === "string" ? part.arguments.command : "",
						tools.cwd,
					),
				];
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
		}
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
): { turns: HistoryTurn[]; timeline: TimelineRow[]; jobs: Map<string, BackgroundCommand> } {
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
	const toolTurns = new Map<string, string>();
	const jobs = new Map<string, BackgroundCommand>();
	let current: HistoryTurn | undefined;
	let explicit = false;
	let continuingTools = false;
	let marker: { key: string; id: string; clientId: string | null; tools?: HistoryToolContext } | undefined;
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
					tools: record.tools as HistoryToolContext | undefined,
				};
			}
		}
		if (entry.type === "custom" && entry.customType === "async-execution") {
			const data = entry.data as { jobId?: unknown; execution?: unknown } | undefined;
			const job = typeof data?.jobId === "string" ? jobs.get(data.jobId) : undefined;
			if (job?.item.status === "inProgress") {
				const item = updateCommandHistoryItem(job.item, data?.execution);
				if (item) Object.assign(job.item, item);
			}
		}

		if (entry.type !== "message" && entry.type !== "custom_message") continue;
		const message: AgentMessage =
			entry.type === "message"
				? entry.message
				: {
						role: "custom",
						customType: entry.customType,
						content: entry.content,
						display: entry.display,
						details: entry.details,
						attribution: entry.attribution,
						timestamp: ms,
					};
		const completion = backgroundCommandCompletion(message, jobs);
		if (completion) Object.assign(jobs.get(completion.jobId)!.item, completion.item);
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
		const items = messageHistoryItems(messageId, message, identity?.clientId, identity?.tools);
		current.items.push(...items);
		for (const item of items)
			timeline.push({ sourceId: entry.id, entry: { type: "item", position, turnId: current.id, item } });
		lastMessage = { position, sourceId: entry.id };
		if (message.role === "assistant")
			for (const part of message.content)
				if (part.type === "toolCall") {
					const item = items.find(value => value.id === `${messageId}:tool:${part.id}`);
					if (item) {
						tools.set(part.id, item);
						toolTurns.set(part.id, current.id);
					}
				}
		if (message.role === "toolResult") {
			const item = tools.get(message.toolCallId);
			if (item) {
				Object.assign(item, completeToolHistoryItem(item, message));
				const details = message.details as { async?: { jobId?: unknown } } | undefined;
				if (item.type === "commandExecution" && typeof details?.async?.jobId === "string")
					jobs.set(details.async.jobId, { turnId: toolTurns.get(message.toolCallId)!, item });
			}
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
	return { turns, timeline, jobs };
}
