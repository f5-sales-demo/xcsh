import { expect, test } from "bun:test";
import { clientProtocolEvents } from "../../src/remote-control/trace-client";

test("client baseline keeps separate subscriber deliveries and request identities", () => {
	const frame = (sequence: number, client: string, direction: string, message: unknown) => ({
		kind: "event",
		sequence,
		elapsedMs: sequence,
		layer: "relay",
		direction,
		message: {
			client_id: { $ref: client },
			stream_id: { $ref: "stream" },
			type: direction === "in" ? "client_message" : "server_message",
			message,
		},
	});
	const event = { method: "thread/realtime/item/started", params: { item: { id: { $ref: "item" } } } };
	const rows = [
		frame(1, "phone", "in", { id: { $ref: "request" }, method: "thread/realtime/start" }),
		frame(2, "monitor", "out", event),
		frame(3, "phone", "out", event),
		frame(4, "phone", "out", { id: { $ref: "request" }, result: {} }),
	];
	const selected = clientProtocolEvents(rows, { $ref: "phone" });
	expect(selected.events.map(row => row.sourceSequence)).toEqual([1, 3, 4]);
	expect(selected.events.map(row => row.layer)).toEqual(["rpc", "rpc", "rpc"]);
	expect(selected.events.filter(row => row.message.method === "thread/realtime/item/started")).toHaveLength(1);
	expect(selected.unresolvedChunks).toBe(0);
});

test("redacted chunk payloads remain an explicit coverage gap", () => {
	const row = {
		kind: "event",
		layer: "relay",
		direction: "in",
		message: {
			client_id: { $ref: "phone" },
			type: "client_message_chunk",
			message_chunk_base64: { $redacted: "string" },
		},
	};
	expect(clientProtocolEvents([row], { $ref: "phone" }).unresolvedChunks).toBe(1);
});
