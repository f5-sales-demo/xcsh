// Ported list contracts from pinned thread_processor.rs, filters.rs and state/runtime/threads.rs.
// Native keyset cursors retain anchors after live sessions exit. See NOTICE.md and LICENSE.
import { resolve } from "node:path";
import { ProtocolError } from "./errors";
import { historyPageLimit } from "./history-page";

type Thread = Record<string, unknown>;
const sourceKinds = new Set([
	"cli",
	"vscode",
	"exec",
	"appServer",
	"subAgent",
	"subAgentReview",
	"subAgentCompact",
	"subAgentThreadSpawn",
	"subAgentOther",
	"unknown",
]);
const sortFields = {
	created_at: "createdAt",
	updated_at: "updatedAt",
	recency_at: "recencyAt",
	section_position: "sectionPosition",
} as const;
type SortKey = keyof typeof sortFields;
const invalid = (field: string) => new ProtocolError(-32602, `Invalid thread list ${field}`);
const compareIds = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function optionalString(params: Thread, field: string): void {
	if (params[field] != null && typeof params[field] !== "string") throw invalid(field);
}
function strings(value: unknown, field: string): string[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw invalid(field);
	return value;
}
function cursorString(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string") throw invalid("cursor");
	return value;
}
interface Anchor {
	version: 1;
	collection: "threads";
	sortKey: SortKey;
	value: number;
	id: string | null;
}
function parseAnchor(value: string, sortKey: SortKey): Anchor {
	try {
		if (value.length > 8192) throw new Error();
		const anchor = JSON.parse(value);
		if (
			anchor?.version !== 1 ||
			anchor.collection !== "threads" ||
			anchor.sortKey !== sortKey ||
			typeof anchor.value !== "number" ||
			!Number.isFinite(anchor.value) ||
			!(anchor.id === null || (typeof anchor.id === "string" && anchor.id.length > 0 && anchor.id.length <= 256))
		)
			throw new Error();
		return anchor;
	} catch {
		throw new ProtocolError(-32600, "Invalid thread list cursor");
	}
}

export function threadList(threads: readonly Thread[], params: Thread) {
	const limit = historyPageLimit(params.limit);
	for (const field of [
		"sortKey",
		"sortDirection",
		"searchTerm",
		"sectionId",
		"projectId",
		"parentThreadId",
		"ancestorThreadId",
	])
		optionalString(params, field);
	if (params.archived != null && typeof params.archived !== "boolean") throw invalid("archived");
	if (Object.hasOwn(params, "useStateDbOnly") && typeof params.useStateDbOnly !== "boolean")
		throw invalid("useStateDbOnly");
	const sortKey = params.sortKey ?? "created_at";
	if (typeof sortKey !== "string" || !Object.hasOwn(sortFields, sortKey)) throw invalid("sortKey");
	const key = sortKey as SortKey;
	const direction = params.sortDirection ?? (key === "section_position" ? "asc" : "desc");
	if (direction !== "asc" && direction !== "desc") throw invalid("sortDirection");
	const step = direction === "asc" ? 1 : -1;
	const providers = strings(params.modelProviders, "modelProviders");
	const sources = strings(params.sourceKinds, "sourceKinds");
	if (sources?.some(source => !sourceKinds.has(source))) throw invalid("sourceKinds");
	const cwds = typeof params.cwd === "string" ? [params.cwd] : strings(params.cwd, "cwd");
	if (cwds?.some(cwd => cwd.includes("\0"))) throw invalid("cwd");
	const normalizedCwds = cwds?.map(cwd => resolve(cwd));
	if (params.parentThreadId != null && params.ancestorThreadId != null)
		throw new ProtocolError(-32600, "parentThreadId and ancestorThreadId are mutually exclusive");
	if (key === "section_position" && params.sectionId == null)
		throw new ProtocolError(-32600, "section-position sorting requires a section filter");
	// This host exposes live top-level terminals. They have no remote projects,
	// sections, archived entries or spawned descendants. No agent work is started.
	if (params.projectId != null) throw new ProtocolError(-32602, "Remote project not found");
	const wireCursor = cursorString(params.cursor);
	const anchor = wireCursor === undefined ? undefined : parseAnchor(wireCursor, key);
	const value = (thread: Thread) => Number(thread[sortFields[key]] ?? 0);
	let data = threads.filter(thread => {
		if (
			params.archived === true ||
			params.sectionId != null ||
			params.parentThreadId != null ||
			params.ancestorThreadId != null
		)
			return false;
		if (providers?.length && !providers.includes(String(thread.modelProvider))) return false;
		if (sources?.length && !sources.includes(String(thread.source ?? "cli"))) return false;
		if (normalizedCwds && !normalizedCwds.includes(resolve(String(thread.cwd ?? "")))) return false;
		if (
			typeof params.searchTerm === "string" &&
			![thread.name, thread.preview].some(v => typeof v === "string" && v.includes(params.searchTerm as string))
		)
			return false;
		return true;
	});
	data.sort((a, b) => step * (value(a) - value(b) || compareIds(String(a.id), String(b.id))));
	if (anchor)
		data = data.filter(thread => {
			const delta = value(thread) - anchor.value;
			// Timestamp-only reverse anchors include every same-timestamp entry.
			return anchor.id === null ? step * delta >= 0 : step * (delta || compareIds(String(thread.id), anchor.id)) > 0;
		});
	const more = data.length > limit;
	data = data.slice(0, limit);
	const encode = (thread: Thread, reverse = false) =>
		JSON.stringify({
			version: 1,
			collection: "threads",
			sortKey: key,
			value: value(thread),
			id: reverse ? null : String(thread.id),
		} satisfies Anchor);
	return {
		data: data.map(thread => ({ ...thread, turns: [] })),
		nextCursor: more && data.length ? encode(data[data.length - 1]) : null,
		backwardsCursor: data.length ? encode(data[0], true) : null,
	};
}

export function loadedThreadList(ids: readonly string[], params: Thread) {
	const limit = params.limit ?? ids.length;
	if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0 || limit > 0xffffffff) throw invalid("limit");
	const cursor = cursorString(params.cursor);
	if (cursor !== undefined && (!cursor.length || cursor.length > 256 || cursor.includes("\0")))
		throw new ProtocolError(-32600, "Invalid loaded thread cursor");
	const sorted = [...ids].sort(compareIds).filter(id => cursor === undefined || compareIds(id, cursor) > 0);
	const data = sorted.slice(0, Math.max(1, limit));
	return { data, nextCursor: data.length < sorted.length ? (data.at(-1) ?? null) : null };
}
