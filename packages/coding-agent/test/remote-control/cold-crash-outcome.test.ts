import { expect, test } from "bun:test";
import { projectHistorySnapshot } from "../../src/remote-control/history";
import { SessionManager } from "../../src/session/session-manager";

function admitted() {
	const manager = SessionManager.inMemory("/tmp/sanitized-crash-fixture");
	manager.appendCustomEntry("remote-history", { kind: "turnStarted", id: "admitted-task", startedAtMs: 1000 });
	manager.appendCustomEntry("remote-history", {
		kind: "requestAccepted",
		turnId: "admitted-task",
		clientUserMessageId: "one-request",
	});
	manager.appendMessage({ role: "user", content: "Update disposable fixture once", timestamp: 1001 });
	return manager;
}

test("cold admitted task without completion is failed with unknown action outcome, never caller cancellation", () => {
	const manager = admitted();
	const snapshot = projectHistorySnapshot("fixture", manager.getEntries(), false, manager.getCwd());
	expect(snapshot.turns).toHaveLength(1);
	expect(snapshot.turns[0]).toMatchObject({ id: "admitted-task", status: "failed", completedAt: null });
	expect(snapshot.turns[0].error?.message).toContain("outcome");
	expect(snapshot.turns[0].error?.message).toContain("unknown");
	expect(snapshot.turns[0].error?.message).toContain("before retrying");
	expect(snapshot.timeline.some(row => row.entry.type === "turnCompleted")).toBe(false);
});

test("live admitted task remains running and durable caller interruption remains interrupted", () => {
	const manager = admitted();
	expect(projectHistorySnapshot("fixture", manager.getEntries(), true).turns[0]).toMatchObject({
		status: "inProgress",
		error: null,
	});
	manager.appendCustomEntry("remote-history", {
		kind: "turnCompleted",
		id: "admitted-task",
		status: "interrupted",
		completedAtMs: 2000,
	});
	expect(projectHistorySnapshot("fixture", manager.getEntries(), false).turns[0]).toMatchObject({
		status: "interrupted",
		error: null,
	});
});

test("durable verified completion still survives cold reopen", () => {
	const manager = admitted();
	manager.appendCustomEntry("remote-history", {
		kind: "turnCompleted",
		id: "admitted-task",
		status: "completed",
		completedAtMs: 2000,
	});
	expect(projectHistorySnapshot("fixture", manager.getEntries(), false).turns[0]).toMatchObject({
		status: "completed",
		error: null,
	});
});
