import { expect, test } from "bun:test";
import { inventoryProtocolTrace } from "../../src/remote-control/trace-report";

test("signal inventory links bidirectional replies, errors, and unanswered requests", () => {
	const row = (direction: string, message: unknown, elapsedMs: number) => ({
		kind: "event",
		layer: "rpc",
		direction,
		message,
		elapsedMs,
	});
	const rows = [
		row("in", { id: { $ref: "one" }, method: "thread/read", params: {} }, 10),
		row("out", { id: { $ref: "one" }, error: { code: -32601 } }, 25),
		row("out", { id: { $ref: "two" }, method: "item/tool/requestUserInput", params: {} }, 30),
		row("in", { id: { $ref: "two" }, result: { answers: {} } }, 70),
		row("in", { id: { $ref: "three" }, method: "turn/start", params: {} }, 80),
	];
	const report = inventoryProtocolTrace(rows);
	expect(report.requests).toContainEqual({
		method: "thread/read",
		direction: "in",
		latencyMs: 15,
		outcome: "error",
		errorCode: -32601,
	});
	expect(report.requests).toContainEqual({
		method: "item/tool/requestUserInput",
		direction: "out",
		latencyMs: 40,
		outcome: "result",
		resultKeys: ["answers"],
	});
	expect(report.unanswered).toEqual([{ method: "turn/start", direction: "in" }]);
});
