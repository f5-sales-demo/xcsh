import { unifiedDiff } from "@f5-sales-demo/pi-natives";
import { isRecord } from "@f5-sales-demo/pi-utils";
import { parsePatch } from "diff";

type Line = { text?: string; origin?: number; newline: boolean };

/** Compose only evidenced patch lines, never reading a later working-tree version. */
export function composeFileDiffs(diffs: readonly string[]): string | undefined {
	if (diffs.length > 1024 || diffs.reduce((bytes, diff) => bytes + Buffer.byteLength(diff), 0) > 8 * 1024 * 1024)
		return;
	const original: Line[] = [];
	const current: Line[] = [];
	const extend = (length: number) => {
		while (current.length < length) {
			const line = { origin: original.length, newline: true };
			original.push(line);
			current.push(line);
		}
	};
	try {
		for (const diff of diffs) {
			const parsed = parsePatch(`--- before\n+++ after\n${diff}`);
			if (parsed.length !== 1) return;
			let offset = 0;
			for (const hunk of parsed[0].hunks) {
				const start = (hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1) + offset;
				if (start < 0 || start + hunk.oldLines > 100_000 || hunk.newLines > 100_000) return;
				extend(start + hunk.oldLines);
				const replacement: Line[] = [];
				let cursor = start;
				for (let i = 0; i < hunk.lines.length; i++) {
					const value = hunk.lines[i];
					if (value.startsWith("\\")) continue;
					const prefix = value[0];
					const text = value.slice(1);
					const newline = !hunk.lines[i + 1]?.startsWith("\\ No newline");
					if (prefix === " " || prefix === "-") {
						const line = current[cursor++];
						if (!line || (line.text !== undefined && (line.text !== text || line.newline !== newline))) return;
						line.text = text;
						line.newline = newline;
						if (prefix === " ") replacement.push(line);
					} else if (prefix === "+") replacement.push({ text, newline });
					else return;
				}
				if (cursor !== start + hunk.oldLines || replacement.length !== hunk.newLines) return;
				current.splice(start, hunk.oldLines, ...replacement);
				offset += hunk.newLines - hunk.oldLines;
			}
		}
		// Unknown gaps are kept identical, with zero context so invented text cannot escape.
		const sparse = original.some(line => line.text === undefined);
		const render = (lines: Line[]) =>
			lines
				.map(line => `${line.text ?? `xcsh-unchanged-${line.origin}`}\n`.slice(0, line.newline ? undefined : -1))
				.join("");
		return unifiedDiff(render(original), render(current), sparse ? 0 : 3);
	} catch {
		return;
	}
}

/** One net change per repeated file in phone history; canonical tool items stay intact. */
export function coalesceTurnFileChanges(items: Record<string, unknown>[]): void {
	const groups = new Map<string, { item: Record<string, unknown>; change: Record<string, unknown> }[]>();
	for (const item of items) {
		if (item.type !== "fileChange" || item.status !== "completed" || !Array.isArray(item.changes)) continue;
		for (const change of item.changes) {
			if (typeof change.path !== "string") continue;
			if (
				isRecord(change.kind) &&
				change.kind.type === "update" &&
				typeof change.kind.move_path === "string" &&
				typeof change.diff === "string"
			) {
				if (change.path === change.kind.move_path && change.diff.startsWith("diff --git ")) continue;
				const source = change.path;
				const destination = change.kind.move_path;
				const suffix = `\n\nMoved to: ${destination}`;
				const patch = change.diff.endsWith(suffix) ? change.diff.slice(0, -suffix.length) : change.diff;
				const quote = (path: string) => JSON.stringify(path);
				change.path = destination;
				change.diff = `diff --git ${quote(`a/${source}`)} ${quote(`b/${destination}`)}\n${patch ? "" : "similarity index 100%\n"}rename from ${source}\nrename to ${destination}\n${patch ? `--- ${quote(`a/${source}`)}\n+++ ${quote(`b/${destination}`)}\n${patch}` : ""}`;
			}

			const group = groups.get(change.path) ?? [];
			group.push({ item, change });
			groups.set(change.path, group);
		}
	}
	for (const group of groups.values()) {
		if (
			group.length < 2 ||
			group.some(
				({ change }) =>
					!isRecord(change.kind) ||
					change.kind.type !== "update" ||
					change.kind.move_path !== null ||
					typeof change.diff !== "string",
			)
		)
			continue;
		const diff = composeFileDiffs(group.map(({ change }) => change.diff as string));
		if (diff === undefined) continue;
		for (const { item, change } of group)
			item.changes = (item.changes as unknown[]).filter(value => value !== change);
		if (diff) (group.at(-1)!.item.changes as unknown[]).push({ ...group.at(-1)!.change, diff });
	}
}
