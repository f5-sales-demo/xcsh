import { expect, test } from "bun:test";
import { unifiedDiff } from "@f5-sales-demo/pi-natives";
import { coalesceTurnFileChanges, composeFileDiffs } from "../../src/remote-control/turn-file-diff";

test.each([
	["baseline\n", "baseline\n\nchange\n", "baseline\nchange\n"],
	["baseline\n", "baseline\n\nchange", "baseline\nchange"],
	["a\nb\nc\nd\ne\nf\ng\n", "a\nB\nc\nd\ne\nf\ng\n", "a\nB\nc\nd\ne\nF\ng\n"],
	["old\n", "new\n", "old\n"],
	["a\r\nb\r\n", "a\r\nB\r\n", "a\r\nC\r\n"],
])("sequential patches compose without losing content or newline facts: %j", (before, middle, after) => {
	const patches = [unifiedDiff(before, middle, 3), unifiedDiff(middle, after, 3)];
	expect(composeFileDiffs(patches)).toBe(unifiedDiff(before, after, 3));
});

test("conflicting patches are not silently composed", () => {
	expect(composeFileDiffs([unifiedDiff("a\n", "b\n"), unifiedDiff("different\n", "c\n")])).toBeUndefined();
});

test("unknown context gaps never appear in the result", () => {
	const before = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join("");
	const middle = before.replace("line 4\n", "first\n");
	const after = middle.replace("line 25\n", "second\n");
	const composed = composeFileDiffs([unifiedDiff(before, middle, 0), unifiedDiff(middle, after, 0)]);
	expect(composed).toBe(unifiedDiff(before, after, 0));
	expect(composed).not.toContain("xcsh-unchanged");
});

test("phone move projection uses the destination and standard Git rename metadata", () => {
	const item = {
		type: "fileChange",
		id: "move",
		status: "completed",
		changes: [
			{
				path: "/workspace/old.txt",
				kind: { type: "update", move_path: "/workspace/new.txt" },
				diff: "\n\nMoved to: /workspace/new.txt",
			},
		],
	};
	coalesceTurnFileChanges([item]);
	expect(item.changes[0].path).toBe("/workspace/new.txt");
	expect(item.changes[0].diff).toContain("rename from /workspace/old.txt\nrename to /workspace/new.txt\n");
	expect(item.changes[0].diff).not.toContain("Moved to:");
	const once = structuredClone(item);
	coalesceTurnFileChanges([item]);
	expect(item).toEqual(once);
});
