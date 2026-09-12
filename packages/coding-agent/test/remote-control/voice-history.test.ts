import { expect, test } from "bun:test";
import { VoiceHistory } from "../../src/remote-control/voice-history";

function fixture(sessionId: string | null = "voice-1") {
	const records: any[] = [],
		events: any[] = [];
	const history = new VoiceHistory(
		sessionId,
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

test.each(["userMessage", "agentMessage"] as const)(
	"history orders %s effects around the backing event",
	async type => {
		const order: string[] = [];
		const history = new VoiceHistory(
			"voice-1",
			async record => {
				order.push(`persist:${(record.item as any).type}`);
			},
			(method, params) => {
				if (method.endsWith("/completed")) order.push(`emit:${(params.item as any).type}`);
			},
		);
		await history.observe({ type: "turnStarted", turnId: "turn-1" });
		await history.start();
		await history.transcript("user", "Pending speech", false);
		order.length = 0;
		await history.observe(
			{
				type: "item",
				turnId: "turn-1",
				completed: true,
				item:
					type === "userMessage"
						? { type, id: "typed", content: [{ type: "text", text: "Typed input" }] }
						: { type, id: "answer", text: "::codex-realtime-inline{}\nAnswer" },
			},
			() => {
				order.push("backing");
			},
		);
		if (type === "userMessage")
			expect(order).toEqual(["persist:transcriptSegment", "emit:transcriptSegment", "backing"]);
		else
			expect(order).toEqual([
				"backing",
				"persist:transcriptSegment",
				"emit:transcriptSegment",
				"persist:bemItemPromoted",
				"emit:bemItemPromoted",
			]);
		await history.close(false);
	},
);

test("history waits for an asynchronous backing event before after-effects and later closure", async () => {
	const order: string[] = [];
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const history = new VoiceHistory(
		"voice-1",
		async record => {
			order.push((record.item as any).type);
		},
		() => {},
	);
	await history.observe({ type: "turnStarted", turnId: "turn-1" });
	await history.start();
	order.length = 0;
	const observed = history.observe(
		{
			type: "item",
			turnId: "turn-1",
			completed: true,
			item: { type: "agentMessage", id: "answer", text: "::codex-realtime-inline{}\nAnswer" },
		},
		async () => {
			entered.resolve();
			await release.promise;
			order.push("backing");
		},
	);
	await entered.promise;
	const closed = history.close(false);
	try {
		await Bun.sleep(0);
		expect(order).toEqual([]);
	} finally {
		release.resolve();
		await observed;
		await closed;
	}
	expect(order).toEqual(["backing", "bemItemPromoted", "realtimeSessionClosed"]);
});

test.each(["existingCall", "webrtc"] as const)(
	"successive %s calls preserve shared history call identities",
	async transport => {
		const { NativeVoice } = await import("../../src/remote-control/voice");
		const f = fixture(null);
		const deps = {
			history: f.history,
			createCall: async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" }),
			authenticate: async () => ({ accessToken: "fixture", accountId: "123456789012" }),
			open: async () => ({ send: () => {}, close: () => {}, bufferedAmount: 0 }),
			emit: (method: string, params: Record<string, unknown>) => {
				f.events.push({ method, ...params });
			},
			records: () => f.records,
			record: async (record: Record<string, unknown>) => {
				f.records.push(record);
			},
			delegate: async () => "Done",
		};
		const params = {
			version: "v3",
			outputModality: "audio",
			transport:
				transport === "existingCall"
					? { type: "existingCall", callId: "fixture" }
					: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
			includeStartupContext: false,
		};
		await f.history.observe({ type: "turnStarted", turnId: "backing" });
		const first = new NativeVoice(deps);
		await first.start({ ...params, realtimeSessionId: "voice-1" });
		await first.stop();
		await f.history.observe({ type: "turnCompleted", turnId: "backing" });
		const second = new NativeVoice(deps);
		await second.start({ ...params, realtimeSessionId: "voice-2" });
		try {
			await f.history.observe({
				type: "item",
				turnId: "backing",
				completed: true,
				item: { type: "agentMessage", id: "late", text: "::codex-realtime-inline{}\nLate result" },
			});
			expect(f.records.at(-1).item).toMatchObject({
				type: "bemItemPromoted",
				realtimeSessionId: "voice-1",
				itemId: "late",
			});
		} finally {
			await second.stop();
		}
		expect(
			f.records
				.filter(record => record.item?.type === "realtimeSessionStarted")
				.map(record => record.item.realtimeSessionId),
		).toEqual(["voice-1", "voice-2"]);
		expect(f.records.filter(record => record.kind === "voiceTimeline").map(record => record.item.type)).toEqual([
			"realtimeSessionStarted",
			"realtimeSessionClosed",
			"realtimeSessionStarted",
			"bemItemPromoted",
			"realtimeSessionClosed",
		]);
	},
);
