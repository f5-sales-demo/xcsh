/** Capture execution facts at native file mutation boundaries, scoped to one tool call. */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentToolError, type AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { unifiedDiff } from "@f5-sales-demo/pi-natives";
import { isEnoent, isRecord } from "@f5-sales-demo/pi-utils";
import type { FileExecutionChange, FileExecutionDetails } from "./execution-metadata";

type Contents = string | null | undefined;
interface Mutation {
	before: Contents;
	after: Contents;
}
class FileMutations {
	readonly entries = new Map<string, Mutation>();
	readonly moves = new Map<string, string>();
	snapshot(status: FileExecutionDetails["status"] = "inProgress"): FileExecutionDetails {
		const changes: FileExecutionChange[] = [];
		const paired = new Map<string, { destination: string; before: string; after: string }>();
		const destinations = new Set<string>();
		for (const [source, destination] of this.moves) {
			const from = this.entries.get(source);
			const to = this.entries.get(destination);
			if (
				source !== destination &&
				typeof from?.before === "string" &&
				from.after === null &&
				typeof to?.after === "string" &&
				!destinations.has(destination)
			) {
				paired.set(source, { destination, before: from.before, after: to.after });
				destinations.add(destination);
			}
		}
		for (const [path, { before, after }] of this.entries) {
			if (destinations.has(path)) continue;
			const move = paired.get(path);
			if (move) {
				changes.push({
					path,
					type: "update",
					unifiedDiff: unifiedDiff(move.before, move.after),
					movePath: move.destination,
				});
				continue;
			}
			if (before === undefined || after === undefined || before === after) continue;
			if (before === null && after !== null) changes.push({ path, type: "add", content: after });
			else if (before !== null && after === null) changes.push({ path, type: "delete", content: before });
			else if (before !== null && after !== null)
				changes.push({ path, type: "update", unifiedDiff: unifiedDiff(before, after), movePath: null });
		}
		return { kind: "fileChange", status, changes };
	}
}
const active = new AsyncLocalStorage<FileMutations>();
async function contents(path: string): Promise<Contents> {
	try {
		if (!(await stat(path)).isFile()) return undefined;
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
	} catch (error) {
		return isEnoent(error) ? null : undefined;
	}
}
export async function recordFileMutation<T>(path: string, run: () => Promise<T>): Promise<T> {
	const scope = active.getStore();
	if (!scope) return run();
	path = resolve(path);
	let entry = scope.entries.get(path);
	if (!entry) {
		const before = await contents(path);
		entry = { before, after: before };
		scope.entries.set(path, entry);
	}
	try {
		return await run();
	} finally {
		entry.after = await contents(path);
	}
}
/** Join successful write-then-unlink operations into the original file's rename fact. */
export function recordFileMove(path: string, destination: string): void {
	const scope = active.getStore();
	if (!scope) return;
	path = resolve(path);
	destination = resolve(destination);
	const source = scope.entries.get(path);
	const target = scope.entries.get(destination);
	if (!source || !target || source.after !== null || typeof target.after !== "string") return;
	const origin = [...scope.moves].find(([, current]) => current === path)?.[0] ?? path;
	for (const [from, current] of scope.moves) if (current === destination && from !== origin) scope.moves.delete(from);
	scope.moves.set(origin, destination);
}
export async function recordFileRename<T>(path: string, destination: string, run: () => Promise<T>): Promise<T> {
	const result = await recordFileMutation(path, () => recordFileMutation(destination, run));
	recordFileMove(path, destination);
	return result;
}
export async function captureFileExecution<T extends object>(
	run: (snapshot: () => FileExecutionDetails) => Promise<AgentToolResult<T>>,
): Promise<AgentToolResult<Partial<T> & { execution: FileExecutionDetails }>> {
	const scope = new FileMutations();
	return active.run(scope, async () => {
		try {
			const result = await run(() => scope.snapshot());
			const details: Partial<T> = result.details ?? {};
			const outcome: unknown = details;
			const partialFailure =
				isRecord(outcome) &&
				Array.isArray(outcome.perFileResults) &&
				outcome.perFileResults.some(value => isRecord(value) && value.isError === true);
			return {
				...result,
				details: { ...details, execution: scope.snapshot(partialFailure ? "failed" : "completed") },
			};
		} catch (error) {
			const execution = scope.snapshot("failed");
			if (!execution.changes.length) throw error;
			if (error instanceof AgentToolError) {
				error.result.details = { ...(isRecord(error.result.details) ? error.result.details : {}), execution };
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			const failure = new AgentToolError(message, {
				content: [{ type: "text", text: message }],
				details: { execution },
			});
			failure.cause = error;
			throw failure;
		}
	});
}
