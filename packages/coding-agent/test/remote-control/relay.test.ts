import { expect, test } from "bun:test";
import { RelayCodec } from "../../src/remote-control/relay";

const envelope = (seq_id: number, message: unknown) => ({
	type: "client_message",
	client_id: "phone",
	stream_id: "stream",
	seq_id,
	cursor: `cursor-${seq_id}`,
	message,
});
test("deduplicates relay replay and retains cursor", () => {
	const codec = new RelayCodec();
	const frame = envelope(1, { id: 1, method: "thread/list", params: {} });
	expect(codec.receive(JSON.stringify(frame))).toMatchObject({
		clientId: "phone",
		streamId: "stream",
		message: frame.message,
	});
	expect(codec.receive(JSON.stringify(frame))).toBeNull();
	expect(codec.cursor).toBe("cursor-1");
});
test("unacknowledged responses replay until matching stream ack", () => {
	const codec = new RelayCodec();
	const frames = codec.send("phone", "stream", { id: 1, result: {} });
	expect(codec.replay()).toEqual(frames);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "other", seq_id: 1 }));
	expect(codec.replay()).toEqual(frames);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "stream", seq_id: 1 }));
	expect(codec.replay()).toEqual([]);
});
test("partial chunk acknowledgements retain only later chunks and acknowledge plain envelopes at segment zero", () => {
	const codec = new RelayCodec();
	expect(codec.send("phone", "stream", { id: 1, result: {} })).toHaveLength(1);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "stream", seq_id: 1, segment_id: 0 }));
	expect(codec.replay()).toEqual([]);

	const chunks = codec.send("phone", "stream", { text: "水".repeat(80000) });
	expect(chunks.length).toBeGreaterThan(1);
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "stream", seq_id: 2, segment_id: 0 }));
	expect(codec.replay()).toEqual(chunks.slice(1));
	codec.receive(JSON.stringify({ type: "ack", client_id: "phone", stream_id: "stream", seq_id: 2 }));
	expect(codec.replay()).toEqual([]);
});
test("initialize may deliberately reuse a sequence while ordinary replay remains deduplicated", () => {
	const codec = new RelayCodec();
	const initialize = envelope(4, { id: 1, method: "initialize", params: {} });
	expect(codec.receive(JSON.stringify(initialize))?.message).toEqual(initialize.message);
	expect(codec.receive(JSON.stringify(initialize))?.message).toEqual(initialize.message);
	const ordinary = envelope(4, { id: 2, method: "thread/list", params: {} });
	expect(codec.receive(JSON.stringify(ordinary))).toBeNull();
});
test("closing a stream clears its inbound replay cursor", () => {
	const codec = new RelayCodec();
	expect(codec.receive(JSON.stringify(envelope(8, { id: 1, method: "initialize", params: {} })))).not.toBeNull();
	expect(
		codec.receive(
			JSON.stringify({ type: "client_closed", client_id: "phone", stream_id: "stream", cursor: "closed" }),
		),
	).toMatchObject({ event: "client_closed" });
	expect(codec.cursor).toBe("closed");
	expect(codec.receive(JSON.stringify(envelope(1, { id: 2, method: "initialize", params: {} })))).not.toBeNull();
});
test("chunks reassemble UTF-8 at byte boundaries and discard duplicate chunks", () => {
	const message = { id: 4, method: "turn/start", params: { text: "水".repeat(80000) } };
	const outgoing = new RelayCodec().send("phone", "stream", message);
	expect(outgoing.length).toBeGreaterThan(1);
	const codec = new RelayCodec();
	let result: unknown;
	for (const frame of outgoing) {
		const inbound = frame.replace('"server_message_chunk"', '"client_message_chunk"');
		result = codec.receive(inbound);
		expect(codec.receive(inbound)).toBeNull();
	}
	expect(result).toMatchObject({ message });
});
test("rejects malformed frames and bounds pending output", () => {
	const codec = new RelayCodec(1024);
	expect(() => codec.receive("{")).toThrow("Invalid relay frame");
	expect(() => codec.receive(JSON.stringify({ type: "client_message", client_id: "phone", seq_id: -1 }))).toThrow(
		"Invalid relay frame",
	);
	expect(() => codec.receive(JSON.stringify({ ...envelope(1, {}), cursor: 42 }))).toThrow("Invalid relay frame");
	expect(() => codec.send("phone", "stream", { text: "x".repeat(2000) })).toThrow("Relay buffer limit");
	expect(codec.replay()).toEqual([]);
});
test("drops reordered chunks without executing a partial message and accepts a clean replay", () => {
	const frames = new RelayCodec().send("phone", "stream", { text: "x".repeat(200000) });
	const codec = new RelayCodec();
	expect(codec.receive(frames[1].replace('"server_message_chunk"', '"client_message_chunk"'))).toBeNull();
	let result = null;
	for (const frame of frames)
		result = codec.receive(frame.replace('"server_message_chunk"', '"client_message_chunk"'));
	expect(result?.message).toEqual({ text: "x".repeat(200000) });
});
test("invalid chunk metadata and base64 reset only that assembly", () => {
	const message = { text: "water".repeat(40000) };
	const frames = new RelayCodec().send("phone", "stream", message);
	const first = JSON.parse(frames[0].replace('"server_message_chunk"', '"client_message_chunk"'));
	const second = JSON.parse(frames[1].replace('"server_message_chunk"', '"client_message_chunk"'));
	const empty = new RelayCodec();
	expect(empty.receive(JSON.stringify({ ...first, message_chunk_base64: "" }))).toBeNull();
	let afterEmpty = null;
	for (const frame of frames)
		afterEmpty = empty.receive(frame.replace('"server_message_chunk"', '"client_message_chunk"'));
	expect(afterEmpty?.message).toEqual(message);

	const codec = new RelayCodec();
	expect(codec.receive(JSON.stringify(first))).toBeNull();
	expect(codec.receive(JSON.stringify({ ...second, message_chunk_base64: "%%%" }))).toBeNull();
	let result = null;
	for (const frame of frames)
		result = codec.receive(frame.replace('"server_message_chunk"', '"client_message_chunk"'));
	expect(result?.message).toEqual(message);
});
test("stale chunks do not displace a newer in-progress assembly", () => {
	const outgoing = new RelayCodec();
	outgoing.send("phone", "stream", { ignored: true });
	const newer = outgoing.send("phone", "stream", { text: "new".repeat(70000) });
	const stale = newer.map(frame => JSON.stringify({ ...JSON.parse(frame), seq_id: 1 }));
	const inbound = (frame: string) => frame.replace('"server_message_chunk"', '"client_message_chunk"');
	const codec = new RelayCodec();
	expect(codec.receive(inbound(newer[0]))).toBeNull();
	expect(codec.receive(inbound(stale[0]))).toBeNull();
	let result = null;
	for (const frame of newer.slice(1)) result = codec.receive(inbound(frame));
	expect(result?.message).toEqual({ text: "new".repeat(70000) });
});
test("the assembly bound evicts the oldest partial client without disconnecting the relay", () => {
	const codec = new RelayCodec();
	const messages = Array.from({ length: 17 }, (_, index) => ({ client: index, text: "x".repeat(200000) }));
	const chunks = messages.map((message, index) =>
		new RelayCodec()
			.send(`phone-${index}`, "stream", message)
			.map(frame => frame.replace('"server_message_chunk"', '"client_message_chunk"')),
	);
	for (const frames of chunks) expect(codec.receive(frames[0])).toBeNull();
	let newest = null;
	for (const frame of chunks.at(-1)!.slice(1)) newest = codec.receive(frame);
	expect(newest?.message).toEqual(messages.at(-1));
	expect(codec.receive(chunks[0][1])).toBeNull();
	let oldest = null;
	for (const frame of chunks[0]) oldest = codec.receive(frame);
	expect(oldest?.message).toEqual(messages[0]);
});
