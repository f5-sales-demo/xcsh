import { expect, test } from "bun:test";
import { VoiceHistory } from "../../src/remote-control/voice-history";

function fixture() {
	const records: any[] = [],
		events: any[] = [];
	const history = new VoiceHistory(
		"voice-1",
		async record => {
			records.push(record);
		},
		(method, params) => events.push({ method, ...params }),
	);
	return { history, records, events };
}

test("canonical empty speech delta keeps a segment so a repeated final is not added as new speech", async () => {
	const f = fixture();
	await f.history.start();
	await f.history.transcript("assistant", "", false);
	expect(
		f.events.filter(event => event.method.endsWith("/started") && event.item.type === "transcriptSegment"),
	).toHaveLength(1);
	await f.history.transcript("assistant", "Repeated final", true);
	await f.history.close(false);
	expect(f.records.map(record => record.item.type)).toEqual(["realtimeSessionStarted", "realtimeSessionClosed"]);
});

test("final-only transcript input has the same byte bound as streamed input", async () => {
	const f = fixture();
	await f.history.start();
	await expect(f.history.transcript("user", "🌳".repeat(262145), true)).rejects.toThrow("Realtime transcript limit");
	expect(f.records).toHaveLength(1);
	await f.history.close(true);
	expect(f.records.at(-1).item.outcome).toBe("failed");
});

test("history persists the speech boundary and promotion in source order with one item identity", async () => {
	const f = fixture();
	await f.history.observe({ type: "turnStarted", turnId: "turn-1" });
	await f.history.start();
	await f.history.transcript("assistant", "Before", false);
	await f.history.observe({
		type: "item",
		turnId: "turn-1",
		completed: true,
		item: { type: "agentMessage", id: "result", text: "::codex-realtime-inline{}\nFixture result" },
	});
	await f.history.transcript("assistant", "After", false);
	await f.history.close(false);
	expect(f.records.map(record => record.item.type)).toEqual([
		"realtimeSessionStarted",
		"transcriptSegment",
		"bemItemPromoted",
		"transcriptSegment",
		"realtimeSessionClosed",
	]);
	for (const { item } of f.records) {
		expect(f.events.filter(event => event.method.endsWith("/started") && event.item.id === item.id)).toHaveLength(1);
		expect(f.events.filter(event => event.method.endsWith("/completed") && event.item.id === item.id)).toHaveLength(
			1,
		);
	}
});

test("history serializes a blocked persistence effect before a later closure", async () => {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const records: any[] = [];
	const history = new VoiceHistory(
		"voice-1",
		async record => {
			if ((record.item as { type: string }).type === "transcriptSegment") {
				entered.resolve();
				await release.promise;
			}
			records.push(record);
		},
		() => {},
	);
	await history.start();
	const transcript = history.transcript("user", "Fixture", true);
	await entered.promise;
	let closed = false;
	const closure = history.close(false).then(() => {
		closed = true;
	});
	try {
		await Bun.sleep(10);
		expect(closed).toBe(false);
	} finally {
		release.resolve();
		await transcript;
		await closure;
	}
	expect(records.map(record => record.item.type)).toEqual([
		"realtimeSessionStarted",
		"transcriptSegment",
		"realtimeSessionClosed",
	]);
});

test("one history owner preserves a late promotion from an earlier call", async () => {
	const f = fixture();
	await f.history.observe({ type: "turnStarted", turnId: "turn-1" });
	await f.history.start();
	await f.history.close(false);
	await f.history.observe({ type: "turnCompleted", turnId: "turn-1" });
	await f.history.start("voice-2");
	await f.history.observe({
		type: "item",
		turnId: "turn-1",
		completed: true,
		item: { type: "agentMessage", id: "result", text: "::codex-realtime-inline{}\nLate result" },
	});
	expect(f.records.at(-1).item).toMatchObject({ type: "bemItemPromoted", realtimeSessionId: "voice-1" });
	await f.history.close(false);
	expect(f.records.at(-1).item.realtimeSessionId).toBe("voice-2");
});
