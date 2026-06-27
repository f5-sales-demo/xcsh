/**
 * Integration test: BridgeServer request/response round-trip over a REAL WebSocket.
 *
 * A mock extension client connects via WebSocket, receives a tool_request,
 * and replies with a tool_result — exercising the actual WS I/O, JSON framing,
 * and PendingRequests id-correlation end-to-end.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { type BridgeServer, startBridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";

describe("BridgeServer round-trip", () => {
	let server: BridgeServer | null = null;
	let mockClient: WebSocket | null = null;

	afterEach(async () => {
		mockClient?.close();
		mockClient = null;
		await server?.close().catch(() => {});
		server = null;
	});

	it("sends a tool_request and receives a tool_result via WebSocket", async () => {
		server = await startBridgeServer(0);
		const port = (server as any).port;

		mockClient = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			mockClient!.onopen = () => resolve();
			mockClient!.onerror = () => reject(new Error("ws connect failed"));
		});

		// The mock client echoes any tool_request as a tool_result.
		mockClient.onmessage = ev => {
			const msg = JSON.parse(String(ev.data));
			if (msg.type === "tool_request") {
				mockClient!.send(
					JSON.stringify({
						type: "tool_result",
						id: msg.id,
						content: { echo: msg.tool, params: msg.params },
						is_error: false,
					}),
				);
			}
		};

		const result = await server.request("test_tool", { foo: "bar" }, 5000);
		expect(result.is_error).toBe(false);
		expect(result.content).toEqual({ echo: "test_tool", params: { foo: "bar" } });
	});

	it("rejects with timeout when no response arrives", async () => {
		server = await startBridgeServer(0);
		const port = (server as any).port;

		// Connect but never reply.
		mockClient = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			mockClient!.onopen = () => resolve();
			mockClient!.onerror = () => reject(new Error("ws connect failed"));
		});

		await expect(server.request("no_reply", {}, 500)).rejects.toThrow(/timed out/);
	});
});
