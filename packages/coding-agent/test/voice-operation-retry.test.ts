import { expect, test } from "bun:test";
import { VoiceOperationRetry } from "../src/session/voice-operation-retry";

test("one failed read consumes the shared budget across operations", () => {
	const budget = new VoiceOperationRetry();
	budget.begin("read-one", "readOnly");
	expect(budget.retry("read-one")).toBe(false);
	budget.settle("read-one", "failed");
	expect(budget.retry("read-one")).toBe(true);
	budget.begin("read-two", "readOnly");
	budget.settle("read-two", "failed");
	expect(budget.retry("read-two")).toBe(false);
	expect(budget.retry("read-one")).toBe(false);
});
test.each(["mutation", "unknown"] as const)("%s never retries from a failed or uncertain outcome", effect => {
	const budget = new VoiceOperationRetry();
	budget.begin("op", effect);
	budget.settle("op", "failed");
	expect(budget.retry("op")).toBe(false);
	budget.settle("op", "unknown");
	expect(budget.retry("op")).toBe(false);
});
test("completed and unknown reads do not retry and outcomes stay inspectable", () => {
	const budget = new VoiceOperationRetry();
	budget.begin("done", "readOnly");
	budget.settle("done", "completed");
	expect(budget.retry("done")).toBe(false);
	budget.begin("lost", "readOnly");
	budget.settle("lost", "unknown");
	expect(budget.retry("lost")).toBe(false);
	expect(budget.snapshot()).toEqual([
		{ id: "done", effect: "readOnly", outcome: "completed" },
		{ id: "lost", effect: "readOnly", outcome: "unknown" },
	]);
});
