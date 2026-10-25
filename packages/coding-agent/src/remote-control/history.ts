import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { SessionEntry, SessionToolExecution } from "../session/session-manager";
import { updateFileHistoryItem } from "./file-changes";
import { coalesceTurnFileChanges } from "./turn-file-diff";

export interface HistoryTurn {
	id: string;
	items: Record<string, unknown>[];
	itemsView: string;
	status: string;
	error: { message: string; codexErrorInfo: "misalignmentPolicyViolation" | null; additionalDetails: null } | null;
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
function codexErrorInfo(providerFailureCode?: string): "misalignmentPolicyViolation" | null {
	return providerFailureCode === "misalignment_policy_violation" ? "misalignmentPolicyViolation" : null;
}
export function historyError(providerFailureCode?: string) {
	return {
		message: "The selected model could not complete this turn. Check the terminal for details.",
		codexErrorInfo: codexErrorInfo(providerFailureCode),
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
export function assistantPlanHistoryItems(
	id: string,
	text: string,
	phase?: string,
	mode: "plan" | "default" = "default",
): Record<string, unknown>[] {
	if (mode !== "plan") return [assistantHistoryItem(id, text, phase)];
	const items: Record<string, unknown>[] = [];
	let fence = "";
	let start = -1;
	let body = -1;
	let offset = 0;
	let plainStart = 0;
	let planIndex = 0;
	for (const line of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
		const value = line.trim();
		const marker = /^(`{3,}|~{3,})/u.exec(value)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
		} else if (!fence && value === "<proposed_plan>" && start < 0) {
			start = offset;
			body = offset + line.length;
		} else if (!fence && value === "</proposed_plan>" && start >= 0) {
			const markdown = text.slice(body, offset).trim();
			if (markdown) {
				if (start > plainStart)
					items.push(
						assistantHistoryItem(
							planIndex === 0 ? id : `${id}:text:${planIndex}`,
							text.slice(plainStart, start),
							phase,
						),
					);
				items.push({ type: "plan", id: `${id}:plan:${planIndex++}`, text: markdown });
				plainStart = offset + line.length;
			}
			start = -1;
		}
		offset += line.length;
	}
	if (!items.length) return [assistantHistoryItem(id, text, phase)];
	if (plainStart < text.length)
		items.push(assistantHistoryItem(`${id}:text:${planIndex}`, text.slice(plainStart), phase));
	return items;
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
	collaborationMode?: "plan" | "default";
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
		if (message.customType === "async-user-input" && message.details && typeof message.details === "object") {
			const item = (message.details as { item?: Record<string, unknown> }).item;
			if (
				item?.type === "agentMessage" &&
				item.delivery === "async" &&
				typeof item.id === "string" &&
				typeof item.text === "string" &&
				Array.isArray(item.questions)
			)
				return [structuredClone(item)];
		}
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
		if (part.type === "text" && part.text)
			return assistantPlanHistoryItems(`${id}:${index}`, part.text, part.phase, tools?.collaborationMode);
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

type CaptionRole = "user" | "assistant";
interface CaptionSegment {
	id: string;
	realtimeSessionId: string;
	role: CaptionRole;
	text: string;
	position: number;
}
interface CaptionGroup {
	position: number;
	realtimeSessionId: string;
	segments: CaptionSegment[];
}
interface CanonicalCaption {
	turn: HistoryTurn;
	turnPosition: number;
	itemPosition: number;
	itemIndex: number;
	role: CaptionRole;
	text: string;
	used: boolean;
}

function captionText(item: Record<string, unknown>): { role: CaptionRole; text: string } | undefined {
	if (item.type === "agentMessage" && typeof item.text === "string") return { role: "assistant", text: item.text };
	if (item.type !== "userMessage" || !Array.isArray(item.content)) return;
	const text = item.content
		.flatMap(part =>
			part && typeof part === "object" && (part as Record<string, unknown>).type === "text"
				? [String((part as Record<string, unknown>).text ?? "")]
				: [],
		)
		.join("\n");
	return { role: "user", text };
}

function captionKey(role: CaptionRole, text: string): string {
	return JSON.stringify([role, text.trim().replace(/\s+/gu, " ")]);
}

function captionHistoryItem(segment: CaptionSegment): Record<string, unknown> {
	const id = `voice-transcript-${segment.id}`;
	return segment.role === "assistant"
		? assistantHistoryItem(id, segment.text)
		: {
				type: "userMessage",
				id,
				clientId: null,
				content: [{ type: "text", text: segment.text, text_elements: [] }],
			};
}

/**
 * Project persisted voice captions into ordinary turns for clients that hydrate
 * only through thread/turns/list and thread/items/list. The canonical timeline
 * stays unchanged for clients that consume thread/timeline/list.
 */
export function projectCompatibilityHistory(
	threadId: string,
	entries: readonly SessionEntry[],
	running = false,
	cwd = "",
): HistoryTurn[] {
	const snapshot = projectHistorySnapshot(threadId, entries, running, cwd);
	const turns = snapshot.turns.map(turn => ({ ...turn, items: turn.items.map(item => structuredClone(item)) }));
	const turnPositions = new Map(
		snapshot.timeline.flatMap(row =>
			row.entry.type === "turnStarted" ? [[row.entry.turnId, row.entry.position] as const] : [],
		),
	);
	const itemPositions = new Map(
		snapshot.timeline.flatMap(row =>
			row.entry.type === "item" ? [[String(row.entry.item.id), row.entry.position] as const] : [],
		),
	);
	const canonical: CanonicalCaption[] = [];
	for (const turn of turns)
		turn.items.forEach((item, itemIndex) => {
			const caption = captionText(item);
			if (caption?.text.trim())
				canonical.push({
					turn,
					turnPosition: turnPositions.get(turn.id) ?? Number.MAX_SAFE_INTEGER,
					itemPosition: itemPositions.get(String(item.id)) ?? Number.MAX_SAFE_INTEGER,
					itemIndex,
					...caption,
					used: false,
				});
		});

	const groups: CaptionGroup[] = [];
	let group: CaptionGroup | undefined;
	const sessionBounds = new Map<string, { start: number; end: number }>();
	for (const row of snapshot.timeline) {
		if (row.entry.type !== "realtime") continue;
		const item = row.entry.item;
		if (item.type === "realtimeSessionStarted" && typeof item.realtimeSessionId === "string") {
			sessionBounds.set(item.realtimeSessionId, { start: row.entry.position, end: Number.MAX_SAFE_INTEGER });
			group = undefined;
			continue;
		}
		if (item.type === "realtimeSessionClosed" && typeof item.realtimeSessionId === "string") {
			const bounds = sessionBounds.get(item.realtimeSessionId);
			if (bounds) bounds.end = row.entry.position;
			group = undefined;
			continue;
		}
		if (
			item.type !== "transcriptSegment" ||
			typeof item.id !== "string" ||
			typeof item.realtimeSessionId !== "string" ||
			(item.role !== "user" && item.role !== "assistant") ||
			typeof item.text !== "string" ||
			!item.text.trim()
		)
			continue;
		if (!group || item.role === "user" || group.realtimeSessionId !== item.realtimeSessionId) {
			group = { position: row.entry.position, realtimeSessionId: item.realtimeSessionId, segments: [] };
			groups.push(group);
		}
		group.segments.push({
			id: item.id,
			realtimeSessionId: item.realtimeSessionId,
			role: item.role,
			text: item.text,
			position: row.entry.position,
		});
	}

	const before = new Map<string, Map<number, Record<string, unknown>[]>>();
	const after = new Map<string, Map<number, Record<string, unknown>[]>>();
	const insert = (
		collection: Map<string, Map<number, Record<string, unknown>[]>>,
		turnId: string,
		index: number,
		item: Record<string, unknown>,
	) => {
		let byIndex = collection.get(turnId);
		if (!byIndex) {
			byIndex = new Map();
			collection.set(turnId, byIndex);
		}
		let items = byIndex.get(index);
		if (!items) {
			items = [];
			byIndex.set(index, items);
		}
		items.push(item);
	};
	const synthetic: Array<{ position: number; sequence: number; turn: HistoryTurn }> = [];
	for (const [sequence, candidate] of groups.entries()) {
		const bounds = sessionBounds.get(candidate.realtimeSessionId);
		const matches = candidate.segments.map(segment => {
			const key = captionKey(segment.role, segment.text);
			let best: CanonicalCaption | undefined;
			for (const value of canonical) {
				if (
					value.used ||
					captionKey(value.role, value.text) !== key ||
					!bounds ||
					// A voice assistant message can be appended to the preceding inferred
					// text turn before the delayed user caption arrives. Its item position,
					// rather than that older turn's start, determines whether it belongs to
					// this realtime session.
					value.itemPosition < bounds.start ||
					value.turnPosition > bounds.end ||
					value.itemPosition > segment.position
				)
					continue;
				if (
					!best ||
					Math.abs(value.turnPosition - segment.position) < Math.abs(best.turnPosition - segment.position)
				)
					best = value;
			}
			if (best) best.used = true;
			return best;
		});
		const anchor = matches.find(Boolean);
		if (anchor) {
			for (const [index, segment] of candidate.segments.entries()) {
				if (matches[index]) continue;
				const item = captionHistoryItem(segment);
				const next = matches.slice(index + 1).find(match => match?.turn.id === anchor.turn.id);
				const previous = matches.slice(0, index).findLast(match => match?.turn.id === anchor.turn.id);
				if (next) insert(before, anchor.turn.id, next.itemIndex, item);
				else if (previous) insert(after, anchor.turn.id, previous.itemIndex, item);
				else if (segment.role === "user") insert(before, anchor.turn.id, 0, item);
				else insert(after, anchor.turn.id, Math.max(0, anchor.turn.items.length - 1), item);
			}
			continue;
		}
		const turn = newHistoryTurn(`voice-turn-${candidate.segments[0]!.id}`);
		turn.items.push(...candidate.segments.map(captionHistoryItem));
		synthetic.push({ position: candidate.position, sequence, turn });
	}

	for (const turn of turns) {
		coalesceTurnFileChanges(turn.items);
		const original = turn.items;
		turn.items = [];
		for (const [index, item] of original.entries()) {
			turn.items.push(...(before.get(turn.id)?.get(index) ?? []), item, ...(after.get(turn.id)?.get(index) ?? []));
		}
	}
	return [
		...turns.map((turn, sequence) => ({
			position: turnPositions.get(turn.id) ?? Number.MAX_SAFE_INTEGER,
			sequence,
			turn,
		})),
		...synthetic,
	]
		.sort((left, right) => left.position - right.position || left.sequence - right.sequence)
		.map(value => value.turn);
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
	// Streaming providers can persist a result before the finalized assistant call.
	// Match those facts only to the exact call in this branch; never infer from tool names.
	const earlyResults = new Map<string, Extract<SessionEntry, { type: "message" }>>();
	const tools = new Map<string, Record<string, unknown>>();
	const toolTurns = new Map<string, string>();
	const jobs = new Map<string, BackgroundCommand>();
	let collaborationMode: "plan" | "default" = "default";
	let current: HistoryTurn | undefined;
	let explicit = false;
	let continuingTools = false;
	let marker: { key: string; id: string; clientId: string | null; tools?: HistoryToolContext } | undefined;
	let startMs = 0;
	for (const [index, entry] of entries.entries()) {
		const position = index + 1;
		const ms = Date.parse(entry.timestamp);
		if (entry.type === "mode_change") collaborationMode = entry.mode === "plan" ? "plan" : "default";
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
				current.error = current.status === "failed" ? (current.error ?? historyError()) : null;
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
			collaborationMode: identity?.tools?.collaborationMode ?? collaborationMode,
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
						const early = earlyResults.get(part.id);
						if (early?.message.role === "toolResult") {
							Object.assign(item, completeToolHistoryItem(item, early.message, early.toolExecution));
							earlyResults.delete(part.id);
						}
					}
				}
		if (message.role === "toolResult") {
			const item = tools.get(message.toolCallId);
			if (!item && entry.type === "message") earlyResults.set(message.toolCallId, entry);

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
				current.error = historyError(message.providerFailureCode);
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
	for (const value of turns) {
		if (value.status !== "inProgress" || (running && value === turns.at(-1))) continue;
		// No durable completion exists and no live owner is running this turn.
		// Stopped execution cannot establish cancellation or the action outcome.
		value.status = "failed";
		value.error = {
			message:
				"Execution stopped without a recorded completion. The action outcome is unknown. Check authoritative state before retrying.",
			codexErrorInfo: null,
			additionalDetails: null,
		};
	}
	if (current && !explicit && current.status !== "inProgress") inferredEnds.push({ turn: current, ...lastMessage });
	for (const value of inferredEnds) complete(value.turn, value.position, value.sourceId);
	return { turns, timeline, jobs };
}
