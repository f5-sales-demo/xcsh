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
	const frame = envelope(1, { id: 1, method: "initialize", params: {} });
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
	expect(() => codec.send("phone", "stream", { text: "x".repeat(2000) })).toThrow("Relay buffer limit");
	expect(codec.replay()).toEqual([]);
});
test("rejects reordered chunks without executing a partial message", () => {
	const frames = new RelayCodec().send("phone", "stream", { text: "x".repeat(200000) });
	const codec = new RelayCodec();
	expect(() => codec.receive(frames[1].replace('"server_message_chunk"', '"client_message_chunk"'))).toThrow(
		"Invalid relay chunk order",
	);
});
