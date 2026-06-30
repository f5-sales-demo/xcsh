/**
 * Integration test: chat protocol round-trip over a REAL WebSocket.
 *
 * Tests the bridge server's `send()` and `onMessage()` extensions used by
 * the chat handler. A mock client sends a chat_request and verifies it is
 * forwarded to onMessage listeners; then the server sends chat_delta/chat_done
 * frames back and verifies the client receives them.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";

describe("Chat bridge round-trip", () => {
	let server: BridgeServer | null = null;
	let mockClient: WebSocket | null = null;

	afterEach(async () => {
		mockClient?.close();
		mockClient = null;
		await server?.close().catch(() => {});
		server = null;
	});

	it("forwards chat_request via onMessage and delivers chat_delta/chat_done via send()", async () => {
		server = new BridgeServer();
		server.listen(0, { skipOriginCheck: true });
		const port = (server as any).port;

		const received: Record<string, unknown>[] = [];
		server.onMessage(msg => received.push(msg));

		mockClient = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			mockClient!.onopen = () => resolve();
			mockClient!.onerror = () => reject(new Error("ws connect failed"));
		});

		const clientMessages: unknown[] = [];
		mockClient.onmessage = ev => {
			clientMessages.push(JSON.parse(String(ev.data)));
		};

		// Send a chat_request (not tool_result or ping, so it goes to onMessage)
		mockClient.send(
			JSON.stringify({
				type: "chat_request",
				id: "c-test-1",
				text: "hello",
				context: null,
				mode: "educational",
				history_hint: "conv-1",
			}),
		);

		// Wait for the message to be forwarded
		await new Promise(r => setTimeout(r, 100));
		expect(received.length).toBe(1);
		expect(received[0].type).toBe("chat_request");
		expect(received[0].id).toBe("c-test-1");

		// Server sends chat_delta and chat_done via send()
		server.send({ type: "chat_delta", id: "c-test-1", seq: 0, delta: "Hello" });
		server.send({ type: "chat_delta", id: "c-test-1", seq: 1, delta: " world" });
		server.send({ type: "chat_done", id: "c-test-1" });

		// Wait for the client to receive them
		await new Promise(r => setTimeout(r, 100));
		expect(clientMessages.length).toBe(3);
		expect(clientMessages[0]).toEqual({ type: "chat_delta", id: "c-test-1", seq: 0, delta: "Hello" });
		expect(clientMessages[1]).toEqual({ type: "chat_delta", id: "c-test-1", seq: 1, delta: " world" });
		expect(clientMessages[2]).toEqual({ type: "chat_done", id: "c-test-1" });
	});

	it("tool_result is still handled by the built-in router, not forwarded to onMessage", async () => {
		server = new BridgeServer();
		server.listen(0, { skipOriginCheck: true });
		const port = (server as any).port;

		const received: Record<string, unknown>[] = [];
		server.onMessage(msg => received.push(msg));

		mockClient = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			mockClient!.onopen = () => resolve();
			mockClient!.onerror = () => reject(new Error("ws connect failed"));
		});

		// Start a pending request so tool_result can resolve it
		const resultPromise = server.request("test_tool", {}, 5000);

		// Wait for the tool_request to be sent
		const toolRequest = await new Promise<{ id: string }>(resolve => {
			mockClient!.onmessage = ev => {
				const msg = JSON.parse(String(ev.data));
				if (msg.type === "tool_request") resolve(msg);
			};
		});

		// Send a tool_result (should be handled by the built-in router, not forwarded)
		mockClient.send(
			JSON.stringify({
				type: "tool_result",
				id: toolRequest.id,
				content: "ok",
				is_error: false,
			}),
		);

		const result = await resultPromise;
		expect(result.content).toBe("ok");

		// Verify tool_result was NOT forwarded to onMessage
		await new Promise(r => setTimeout(r, 50));
		expect(received.length).toBe(0);
	});
});
