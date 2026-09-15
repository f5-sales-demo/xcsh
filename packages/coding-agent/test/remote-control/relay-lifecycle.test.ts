import { expect, test } from "bun:test";
import { RelayCodec } from "../../src/remote-control/relay";
import { ReconnectBackoff, RelayClientTracker, RelayHeartbeat } from "../../src/remote-control/relay-lifecycle";

test("same-stream initialize replaces and fully cleans the prior logical client", () => {
	let now = 1_000;
	const closed: Array<{ key: string; reason: string }> = [];
	const tracker = new RelayClientTracker({ now: () => now, onClose: (key, reason) => closed.push({ key, reason }) });
	const first = tracker.admit("phone", "voice", "initialize", 1);
	expect(first).toMatchObject({ kind: "accepted", replaced: false, generation: 1 });
	expect(tracker.begin(first.key, first.generation)).toBe(true);

	now++;
	const replacement = tracker.admit("phone", "voice", "initialize", 2);
	expect(replacement).toMatchObject({ kind: "accepted", replaced: true, generation: 2 });
	expect(closed).toEqual([{ key: first.key, reason: "replaced" }]);
	expect(tracker.pending(first.key)).toBe(0);
	expect(tracker.isCurrent(first.key, first.generation)).toBe(false);
	expect(tracker.isCurrent(replacement.key, replacement.generation)).toBe(true);
});

test("different streams coexist and unknown non-initialize traffic is dropped", () => {
	const tracker = new RelayClientTracker();
	const first = tracker.admit("phone", "one", "initialize", 1);
	const second = tracker.admit("phone", "two", "initialize", 2);
	expect(first.kind).toBe("accepted");
	expect(second.kind).toBe("accepted");
	expect(first.key).not.toBe(second.key);
	expect(tracker.size).toBe(2);
	expect(tracker.admit("unknown", "stream", "thread/list", 3)).toEqual({ kind: "dropped" });
});

test("idle expiry, client_closed, and outbound termination close only the target stream", () => {
	let now = 0;
	const closed: string[] = [];
	const tracker = new RelayClientTracker({ now: () => now, onClose: key => closed.push(key) });
	const first = tracker.admit("phone", "one", "initialize", 1);
	const second = tracker.admit("phone", "two", "initialize", 2);
	now = 10 * 60_000 + 1;
	tracker.touch(second.key, second.generation);
	tracker.sweep();
	expect(closed).toEqual([first.key]);
	tracker.close(second.key, "client_closed");
	expect(closed).toEqual([first.key, second.key]);
	const third = tracker.admit("phone", "three", "initialize", 3);
	tracker.close(third.key, "outbound_terminated");
	expect(closed).toEqual([first.key, second.key, third.key]);
});

test("queue saturation returns isolated retryable overload without harming another stream", () => {
	const tracker = new RelayClientTracker({ capacity: 128 });
	const busy = tracker.admit("phone", "busy", "initialize", 1);
	const healthy = tracker.admit("phone", "healthy", "initialize", 2);
	for (let index = 0; index < 128; index++) expect(tracker.begin(busy.key, busy.generation)).toBe(true);
	expect(tracker.begin(busy.key, busy.generation)).toBe(false);
	expect(tracker.overload(99)).toEqual({
		id: 99,
		error: { code: -32001, message: "Server overloaded; retry later." },
	});
	expect(tracker.begin(healthy.key, healthy.generation)).toBe(true);
});

test("closing one logical client clears only its codec state and unacknowledged output", () => {
	const codec = new RelayCodec();
	codec.receive(
		JSON.stringify({
			type: "client_message",
			client_id: "phone",
			stream_id: "one",
			seq_id: 1,
			message: { id: 1, method: "initialize", params: {} },
		}),
	);
	const first = codec.send("phone", "one", { id: 1, result: {} });
	const second = codec.send("phone", "two", { id: 2, result: {} });
	codec.closeClient("phone", "one");
	expect(codec.replay()).toEqual(second);
	expect(codec.replay()).not.toContain(first[0]);
});

test("outbound queue saturation is bounded per stream", () => {
	const codec = new RelayCodec(16 * 1024 * 1024, 128);
	for (let index = 0; index < 128; index++) codec.send("phone", "busy", { id: index, result: {} });
	expect(() => codec.send("phone", "busy", { id: 129, result: {} })).toThrow("Relay buffer limit");
	expect(() => codec.send("phone", "healthy", { id: 1, result: {} })).not.toThrow();
});

test("outbound work remains pending until acknowledged for graceful drain", () => {
	const codec = new RelayCodec();
	codec.send("phone", "voice", { id: 1, result: {} });
	codec.send("phone", "voice", { id: 2, result: {} });
	expect(codec.pendingMessages).toBe(2);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "voice", seq_id: 1, segment_id: 0 }));
	expect(codec.pendingMessages).toBe(1);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "voice", seq_id: 2 }));
	expect(codec.pendingMessages).toBe(0);
});

test("heartbeat times out missing pongs and reconnect delay is full-jitter and capped", () => {
	let now = 0;
	const heartbeat = new RelayHeartbeat(() => now);
	heartbeat.opened();
	now = 10_000;
	expect(heartbeat.poll()).toBe("ping");
	heartbeat.sentPing();
	now = 59_999;
	expect(heartbeat.poll()).not.toBe("timeout");
	now = 60_001;
	expect(heartbeat.poll()).toBe("timeout");
	heartbeat.pong();
	expect(heartbeat.poll()).not.toBe("timeout");

	const backoff = new ReconnectBackoff(() => 0.5);
	expect(Array.from({ length: 8 }, () => backoff.nextDelay())).toEqual([
		250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
	]);
	backoff.reset();
	expect(backoff.nextDelay()).toBe(250);
});
