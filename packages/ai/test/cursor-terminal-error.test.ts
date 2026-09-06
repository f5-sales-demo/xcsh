import { afterEach, describe, expect, it } from "bun:test";
import * as http2 from "node:http2";
import { create, toBinary } from "@bufbuild/protobuf";
import { streamCursor } from "../src/providers/cursor";
import {
	AgentServerMessageSchema,
	InteractionUpdateSchema,
	TextDeltaUpdateSchema,
	TurnEndedUpdateSchema,
} from "../src/providers/cursor/gen/agent_pb";
import type { Context, Model } from "../src/types";

const CONNECT_END_STREAM_FLAG = 0b00000010;

type Scenario =
	| "success"
	| "connect-error-after-turn"
	| "grpc-trailer-after-turn"
	| "end-before-turn"
	| "hang-after-turn";

let server: http2.Http2Server | undefined;
const sessions = new Set<http2.Http2Session>();
let scenario: Scenario = "success";

function frameConnectMessage(data: Uint8Array, flags = 0): Buffer {
	const frame = Buffer.alloc(5 + data.length);
	frame[0] = flags;
	frame.writeUInt32BE(data.length, 1);
	frame.set(data, 5);
	return frame;
}

function textDeltaFrame(text: string): Buffer {
	const message = create(AgentServerMessageSchema, {
		message: {
			case: "interactionUpdate",
			value: create(InteractionUpdateSchema, {
				message: { case: "textDelta", value: create(TextDeltaUpdateSchema, { text }) },
			}),
		},
	});
	return frameConnectMessage(toBinary(AgentServerMessageSchema, message));
}

function turnEndedFrame(): Buffer {
	const message = create(AgentServerMessageSchema, {
		message: {
			case: "interactionUpdate",
			value: create(InteractionUpdateSchema, {
				message: { case: "turnEnded", value: create(TurnEndedUpdateSchema, {}) },
			}),
		},
	});
	return frameConnectMessage(toBinary(AgentServerMessageSchema, message));
}

function connectEndErrorFrame(code: string, message: string): Buffer {
	return frameConnectMessage(
		Buffer.from(JSON.stringify({ error: { code, message } }), "utf8"),
		CONNECT_END_STREAM_FLAG,
	);
}

async function startServer(): Promise<string> {
	server = http2.createServer();
	server.on("session", session => {
		sessions.add(session);
		session.on("close", () => sessions.delete(session));
	});
	server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
		stream.on("data", () => {});
		if (headers[":path"] !== "/agent.v1.AgentService/Run") {
			stream.respond({ ":status": 404 });
			stream.end();
			return;
		}

		if (scenario === "grpc-trailer-after-turn") {
			stream.respond({ ":status": 200, "content-type": "application/connect+proto" }, { waitForTrailers: true });
			stream.on("wantTrailers", () => {
				stream.sendTrailers({
					"grpc-status": "13",
					"grpc-message": encodeURIComponent("post-turn trailer failure"),
				});
			});
			stream.write(textDeltaFrame("hello"));
			stream.write(turnEndedFrame());
			stream.end();
			return;
		}

		stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
		if (scenario === "end-before-turn") {
			stream.write(textDeltaFrame("partial"));
			stream.end();
			return;
		}

		stream.write(Buffer.concat([textDeltaFrame("hello"), turnEndedFrame()]));
		if (scenario === "connect-error-after-turn") {
			stream.write(connectEndErrorFrame("unavailable", "post-turn connect failure"));
			stream.end();
			return;
		}
		if (scenario !== "hang-after-turn") stream.end();
	});

	const listening = Promise.withResolvers<void>();
	server.once("error", listening.reject);
	server.listen(0, "127.0.0.1", listening.resolve);
	await listening.promise;
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected fixture server to bind a TCP port");
	return `http://127.0.0.1:${address.port}`;
}

function makeModel(baseUrl: string): Model<"cursor-agent"> {
	return {
		id: "cursor-terminal-fixture",
		name: "Cursor terminal fixture",
		api: "cursor-agent",
		provider: "cursor",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1,
		maxTokens: 1,
	};
}

const context: Context = {
	messages: [{ role: "user", content: "terminal lifecycle", timestamp: 1 }],
};

async function collectStream(model: Model<"cursor-agent">, options?: { signal?: AbortSignal }) {
	const stream = streamCursor(model, context, { apiKey: "test-token", signal: options?.signal });
	const eventTypes: string[] = [];
	for await (const event of stream) eventTypes.push(event.type);
	return { eventTypes, result: await stream.result() };
}

async function stopServer(): Promise<void> {
	for (const session of sessions) session.destroy();
	sessions.clear();
	if (!server) return;
	const closing = server;
	server = undefined;
	const closed = Promise.withResolvers<void>();
	closing.close(error => (error ? closed.reject(error) : closed.resolve()));
	await closed.promise;
}

afterEach(async () => {
	scenario = "success";
	await stopServer();
});

describe("Cursor terminal lifecycle after turnEnded", () => {
	it("emits done only after turnEnded and a clean protocol end", async () => {
		const { eventTypes, result } = await collectStream(makeModel(await startServer()));
		expect(eventTypes).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(result.stopReason).toBe("stop");
		expect(result.errorMessage).toBeUndefined();
	});

	it("surfaces CONNECT end-stream errors that arrive after turnEnded", async () => {
		scenario = "connect-error-after-turn";
		const { eventTypes, result } = await collectStream(makeModel(await startServer()));
		expect(eventTypes.at(-1)).toBe("error");
		expect(eventTypes).not.toContain("done");
		expect(result.errorMessage).toContain("Connect error unavailable: post-turn connect failure");
	});

	it("surfaces nonzero gRPC trailers that arrive after turnEnded", async () => {
		scenario = "grpc-trailer-after-turn";
		const { eventTypes, result } = await collectStream(makeModel(await startServer()));
		expect(eventTypes.at(-1)).toBe("error");
		expect(eventTypes).not.toContain("done");
		expect(result.errorMessage).toContain("gRPC error 13: post-turn trailer failure");
	});

	it("rejects when the stream ends before turnEnded", async () => {
		scenario = "end-before-turn";
		const { eventTypes, result } = await collectStream(makeModel(await startServer()));
		expect(eventTypes.at(-1)).toBe("error");
		expect(eventTypes).not.toContain("done");
		expect(result.errorMessage).toContain("Cursor stream ended before turnEnded");
	});

	it("aborts without emitting done when the signal fires", async () => {
		scenario = "hang-after-turn";
		const controller = new AbortController();
		const stream = streamCursor(makeModel(await startServer()), context, {
			apiKey: "test-token",
			signal: controller.signal,
		});
		const eventTypes: string[] = [];
		for await (const event of stream) {
			eventTypes.push(event.type);
			if (event.type === "text_delta") controller.abort();
		}
		const result = await stream.result();
		expect(eventTypes.at(-1)).toBe("error");
		expect(eventTypes).not.toContain("done");
		expect(result.stopReason).toBe("aborted");
	});
});
