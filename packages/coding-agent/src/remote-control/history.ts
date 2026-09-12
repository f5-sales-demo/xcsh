import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { SessionEntry, SessionToolExecution } from "../session/session-manager";
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
		message.role === "hookMessage" ? "custom" : message.role,
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
function completedUserCommandHistoryItem(
	id: string,
	command: string,
	output: string,
	exitCode: number | undefined,
	cancelled: boolean,
	cwd: string,
): Record<string, unknown> {
	return {
		...commandHistoryItem(id, command, cwd),
		source: "userShell",
		status: cancelled || (exitCode !== undefined && exitCode !== 0) ? "failed" : "completed",
		aggregatedOutput: output || null,
		exitCode: exitCode ?? null,
	};
}
function textContent(content: string | readonly { type: string; text?: string }[]): string[] {
	return typeof content === "string"
		? [content]
		: content.flatMap(part => (part.type === "text" && typeof part.text === "string" ? [part.text] : []));
}
function hookHistoryItem(id: string, hookRunId: string, content: string[]): Record<string, unknown>[] {
	const fragments = content.filter(text => text.length > 0).map(text => ({ text, hookRunId }));
	return fragments.length > 0 ? [{ type: "hookPrompt", id, fragments }] : [];
}
function fileName(path: string): string {
	return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
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
function classifiedToolHistoryItem(
	item: Record<string, unknown>,
	toolExecution?: SessionToolExecution,
): Record<string, unknown> {
	if (item.type === "dynamicToolCall" && typeof toolExecution?.cwd === "string") {
		if (toolExecution.kind === "fileChange")
			item = { type: "fileChange", id: item.id, changes: [], status: "inProgress" };
		else if (toolExecution.kind === "command") {
			const args = item.arguments as { command?: unknown } | undefined;
			item = commandHistoryItem(
				String(item.id),
				typeof args?.command === "string" ? args.command : "",
				toolExecution.cwd,
			);
		}
	}
	return item;
}

export function activeToolHistoryItem(
	item: Record<string, unknown>,
	toolExecution: SessionToolExecution & { execution?: unknown },
): Record<string, unknown> {
	const classified = classifiedToolHistoryItem(item, toolExecution);
	const updated =
		classified.type === "commandExecution"
			? updateCommandHistoryItem(classified, toolExecution.execution)
			: classified.type === "fileChange"
				? updateFileHistoryItem(classified, toolExecution.execution)
				: undefined;
	// Only the core result message settles the tool, even if a progress snapshot carries final facts.
	return { ...(updated ?? classified), status: "inProgress" };
}
export function completeToolHistoryItem(
	item: Record<string, unknown>,
	message: Extract<AgentMessage, { role: "toolResult" }>,
	toolExecution?: SessionToolExecution,
): Record<string, unknown> {
	item = classifiedToolHistoryItem(item, toolExecution);
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
	if (message.role === "user" || message.role === "developer") {
		const content =
			typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
		if (message.role === "developer")
			return hookHistoryItem(
				id,
				id,
				content.flatMap(part => (part.type === "text" ? [part.text] : [])),
			);
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
	if (message.role === "bashExecution")
		return [
			completedUserCommandHistoryItem(
				id,
				message.command,
				message.output,
				message.exitCode,
				message.cancelled,
				tools?.cwd ?? "",
			),
		];
	if (message.role === "pythonExecution")
		return [
			completedUserCommandHistoryItem(
				id,
				message.code,
				message.output,
				message.exitCode,
				message.cancelled,
				tools?.cwd ?? "",
			),
		];
	if (message.role === "custom" || message.role === "hookMessage") {
		if (!message.display || message.customType === "async-result") return [];
		return hookHistoryItem(id, message.customType, textContent(message.content));
	}
	if (message.role === "branchSummary")
		return hookHistoryItem(id, `branch-summary:${message.fromId}`, [message.summary]);
	if (message.role === "compactionSummary") return [{ type: "contextCompaction", id }];
	if (message.role === "fileMention")
		return [
			{
				type: "userMessage",
				id,
				clientId: null,
				content: message.files.map(file => ({ type: "mention", name: fileName(file.path), path: file.path })),
			},
		];
	if (message.role === "media") {
		if (message.media.kind === "image" && message.media.provenance.sourceType === "path")
			return [{ type: "imageView", id, path: message.media.provenance.source }];
		const label = message.media.caption || message.media.alt || `[${message.media.kind} media]`;
		return hookHistoryItem(id, message.media.id, [label]);
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
export function projectHistory(
	threadId: string,
	entries: readonly SessionEntry[],
	running = false,
	cwd = "",
): HistoryTurn[] {
	return projectHistorySnapshot(threadId, entries, running, cwd).turns;
}
export function projectHistorySnapshot(
	threadId: string,
	entries: readonly SessionEntry[],
	running = false,
	cwd = "",
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
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			if (!current) {
				current = newHistoryTurn(`${threadId}-turn-${entry.id}`);
				startMs = ms;
				current.startedAt = Math.floor(ms / 1000);
				turns.push(current);
				timeline.push({
					sourceId: entry.id,
					entry: { type: "turnStarted", position, turnId: current.id, startedAt: current.startedAt },
				});
			}
			const item =
				entry.type === "compaction"
					? { type: "contextCompaction", id: `${threadId}-item-${entry.id}` }
					: hookHistoryItem(`${threadId}-item-${entry.id}`, `branch-summary:${entry.fromId}`, [entry.summary])[0];
			if (item) {
				current.items.push(item);
				timeline.push({ sourceId: entry.id, entry: { type: "item", position, turnId: current.id, item } });
				lastMessage = { position, sourceId: entry.id };
				if (!explicit) {
					current.completedAt = Math.floor(ms / 1000);
					current.durationMs = Math.max(0, ms - startMs);
				}
			}
			continue;
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
		const messageId = identity?.id ?? `${threadId}-item-${entry.id}`;
		const projectedItems = messageHistoryItems(messageId, message, identity?.clientId, {
			cwd: identity?.tools?.cwd ?? (entry.type === "message" ? entry.toolExecution?.cwd : undefined) ?? cwd,
			commandCallIds: identity?.tools?.commandCallIds ?? [],
			fileCallIds: identity?.tools?.fileCallIds,
		});
		if (projectedItems.length === 0 && message.role !== "assistant" && message.role !== "toolResult") continue;
		const opensTurn =
			message.role === "user" || message.role === "bashExecution" || message.role === "pythonExecution";
		if (!current || (opensTurn && !explicit && !continuingTools)) {
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
		current.items.push(...projectedItems);
		for (const item of projectedItems)
			timeline.push({ sourceId: entry.id, entry: { type: "item", position, turnId: current.id, item } });
		lastMessage = { position, sourceId: entry.id };
		if (message.role === "assistant")
			for (const part of message.content)
				if (part.type === "toolCall") {
					const item = projectedItems.find(value => value.id === `${messageId}:tool:${part.id}`);
					if (item) {
						tools.set(part.id, item);
						toolTurns.set(part.id, current.id);
					}
				}
		if (message.role === "toolResult") {
			const item = tools.get(message.toolCallId);
			if (item) {
				const completed = completeToolHistoryItem(
					item,
					message,
					entry.type === "message" ? entry.toolExecution : undefined,
				);
				for (const key of Object.keys(item)) delete item[key];
				Object.assign(item, completed);
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
