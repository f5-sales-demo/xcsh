import type { DiffEntry, ResourceDiff } from "./types";

export function computeResourceDiff(current: Record<string, unknown>, desired: Record<string, unknown>): ResourceDiff {
	const added: DiffEntry[] = [];
	const removed: DiffEntry[] = [];
	const changed: DiffEntry[] = [];
	let unchangedCount = 0;

	diffObjects(current, desired, "", added, removed, changed, { count: 0 });
	unchangedCount =
		countLeafKeys(current) + countLeafKeys(desired) - added.length - removed.length - changed.length * 2;
	if (unchangedCount < 0) unchangedCount = 0;

	return {
		hasDifferences: added.length > 0 || removed.length > 0 || changed.length > 0,
		added,
		removed,
		changed,
		unchangedCount,
	};
}

function diffObjects(
	current: unknown,
	desired: unknown,
	prefix: string,
	added: DiffEntry[],
	removed: DiffEntry[],
	changed: DiffEntry[],
	_ctx: { count: number },
): void {
	if (current === desired) return;
	if (current === undefined || current === null) {
		if (desired !== undefined && desired !== null) {
			added.push({ path: prefix || "(root)", newValue: desired });
		}
		return;
	}
	if (desired === undefined || desired === null) {
		removed.push({ path: prefix || "(root)", oldValue: current });
		return;
	}

	if (Array.isArray(current) && Array.isArray(desired)) {
		diffArrays(current, desired, prefix, added, removed, changed, _ctx);
		return;
	}

	if (
		typeof current === "object" &&
		typeof desired === "object" &&
		!Array.isArray(current) &&
		!Array.isArray(desired)
	) {
		const curObj = current as Record<string, unknown>;
		const desObj = desired as Record<string, unknown>;
		const allKeys = new Set([...Object.keys(curObj), ...Object.keys(desObj)]);

		for (const key of allKeys) {
			const childPath = prefix ? `${prefix}.${key}` : key;
			const curVal = curObj[key];
			const desVal = desObj[key];

			if (!(key in curObj)) {
				added.push({ path: childPath, newValue: desVal });
			} else if (!(key in desObj)) {
				removed.push({ path: childPath, oldValue: curVal });
			} else {
				diffObjects(curVal, desVal, childPath, added, removed, changed, _ctx);
			}
		}
		return;
	}

	if (!deepEqual(current, desired)) {
		changed.push({ path: prefix || "(root)", oldValue: current, newValue: desired });
	}
}

function diffArrays(
	current: unknown[],
	desired: unknown[],
	prefix: string,
	added: DiffEntry[],
	removed: DiffEntry[],
	changed: DiffEntry[],
	_ctx: { count: number },
): void {
	const maxLen = Math.max(current.length, desired.length);
	for (let i = 0; i < maxLen; i++) {
		const childPath = `${prefix}[${i}]`;
		if (i >= current.length) {
			added.push({ path: childPath, newValue: desired[i] });
		} else if (i >= desired.length) {
			removed.push({ path: childPath, oldValue: current[i] });
		} else {
			diffObjects(current[i], desired[i], childPath, added, removed, changed, _ctx);
		}
	}
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;

	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((val, i) => deepEqual(val, b[i]));
	}

	if (Array.isArray(a) || Array.isArray(b)) return false;

	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(key => key in bObj && deepEqual(aObj[key], bObj[key]));
}

function countLeafKeys(obj: unknown): number {
	if (obj == null || typeof obj !== "object") return 1;
	if (Array.isArray(obj)) return obj.reduce((sum, item) => sum + countLeafKeys(item), 0);
	return Object.values(obj as Record<string, unknown>).reduce((sum: number, val) => sum + countLeafKeys(val), 0);
}

export function formatDiff(diff: ResourceDiff, kind: string, name: string): string {
	if (!diff.hasDifferences) {
		return `${kind}/${name}: no changes detected.`;
	}

	const lines: string[] = [];
	lines.push(`diff ${kind}/${name}`);

	for (const entry of diff.removed) {
		lines.push(`- ${entry.path}: ${formatValue(entry.oldValue)}`);
	}
	for (const added of diff.added) {
		lines.push(`+ ${added.path}: ${formatValue(added.newValue)}`);
	}
	for (const entry of diff.changed) {
		lines.push(`~ ${entry.path}: ${formatValue(entry.oldValue)} → ${formatValue(entry.newValue)}`);
	}

	lines.push(`  ${diff.unchangedCount} field(s) unchanged`);
	return lines.join("\n");
}

function formatValue(value: unknown): string {
	if (value === undefined) return "<undefined>";
	if (value === null) return "null";
	if (typeof value === "string") return `"${value}"`;
	if (typeof value === "object") {
		const json = JSON.stringify(value);
		return json.length > 80 ? `${json.slice(0, 77)}...` : json;
	}
	return String(value);
}
