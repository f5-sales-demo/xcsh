import { expect, test } from "bun:test";
import { updateFileHistoryItem } from "../../src/remote-control/file-changes";
import { completeToolHistoryItem } from "../../src/remote-control/history";
import fixtures from "./fixtures/codex-0.153.4-file-changes.json";

const item = { type: "fileChange", id: "file-item", changes: [], status: "inProgress" };
for (const [index, fixture] of fixtures.cases.entries()) {
	test(`file changes match the executed pinned Rust converter: ${index}`, () => {
		const execution = { kind: "fileChange", status: "completed", changes: fixture.changes };
		expect(updateFileHistoryItem(item, execution)).toEqual({
			...item,
			status: "completed",
			changes: fixture.expected,
		});
		expect(item.changes).toEqual([]);
	});
}
test.each(["inProgress", "completed", "failed", "declined"])("file execution preserves status %s", status => {
	expect(updateFileHistoryItem(item, { kind: "fileChange", status, changes: [] })?.status).toBe(status);
});
test.each(
	[
		null,
		[],
		{},
		{ kind: "command", status: "completed", changes: [] },
		{ kind: "fileChange", status: "unknown", changes: [] },
		{ kind: "fileChange", status: ["completed"], changes: [] },
		...[
			null,
			{},
			[null],
			[{ path: "p", type: "add", content: 42 }],
			[{ path: "p", type: "delete" }],
			[{ path: "p", type: "update", unifiedDiff: "diff" }],
			[{ path: "p", type: "update", unifiedDiff: "diff", movePath: 42 }],
			[{ path: "p", type: "other", content: "text" }],
			[
				{ path: "p", type: "add", content: "a" },
				{ path: "p", type: "delete", content: "a" },
			],
		].map(changes => ({ kind: "fileChange", status: "completed", changes })),
	].map(value => ({ value })),
)("malformed file execution facts are rejected atomically: %j", ({ value }) => {
	expect(updateFileHistoryItem(item, value)).toBeUndefined();
});
test("a display diff or tool name alone never supplies missing file execution facts", () => {
	const result = {
		role: "toolResult" as const,
		toolCallId: "call",
		toolName: "edit",
		content: [{ type: "text" as const, text: "+1 displayed line" }],
		details: { diff: "+1 displayed line" },
		isError: false,
		timestamp: 1,
	};
	expect(completeToolHistoryItem(item, result)).toEqual({ ...item, status: "completed" });
	const dynamic = { type: "dynamicToolCall", id: "dynamic" };
	expect(
		completeToolHistoryItem(dynamic, {
			...result,
			details: { execution: { kind: "fileChange", status: "completed", changes: [] } },
		}).type,
	).toBe("dynamicToolCall");
});
