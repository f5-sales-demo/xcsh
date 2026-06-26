/**
 * Integration test: BridgeServer request/response round-trip over a REAL Unix socket.
 *
 * A mock "native host" client connects to the bridge, receives a tool_request,
 * and replies with a tool_result — exercising the actual socket I/O, NDJSON
 * framing, and PendingRequests id-correlation end-to-end.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as net from "node:net";
import { type BridgeServer, startBridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";

const SOCK = `/tmp/xcsh-test-roundtrip-${process.pid}.sock`;

describe("BridgeServer round-trip", () => {
	let server: BridgeServer | null = null;
	let mockClient: net.Socket | null = null;

	afterEach(async () => {
		mockClient?.destroy();
		mockClient = null;
		await server?.close().catch(() => {});
		server = null;
	});

	it("sends a tool_request and receives a tool_result via the real Unix socket", async () => {
		server = await startBridgeServer(SOCK);

		// Connect a mock native-host client.
		mockClient = net.createConnection(SOCK);
		await new Promise<void>((resolve, reject) => {
			mockClient!.on("connect", resolve);
			mockClient!.on("error", reject);
		});

		// The mock client echoes any tool_request as a pong-like tool_result.
		let buf = "";
		mockClient.on("data", (chunk: Buffer) => {
			buf += chunk.toString();
			const lines = buf.split("\n");
			buf = lines.pop()!; // keep incomplete tail
			for (const line of lines) {
				if (!line.trim()) continue;
				const msg = JSON.parse(line);
				if (msg.type === "tool_request") {
					const reply = JSON.stringify({
						type: "tool_result",
						id: msg.id,
						content: { echo: msg.tool, params: msg.params },
						is_error: false,
					});
					mockClient!.write(`${reply}\n`);
				}
			}
		});

		// Send a request from the server side and await the correlated response.
		const result = await server.request("test_tool", { foo: "bar" }, 5000);
		expect(result.is_error).toBe(false);
		expect(result.content).toEqual({ echo: "test_tool", params: { foo: "bar" } });
	});

	it("rejects with timeout when no response arrives", async () => {
		server = await startBridgeServer(SOCK);

		// Connect but never reply.
		mockClient = net.createConnection(SOCK);
		await new Promise<void>((resolve, reject) => {
			mockClient!.on("connect", resolve);
			mockClient!.on("error", reject);
		});

		await expect(server.request("no_reply", {}, 500)).rejects.toThrow(/timed out/);
	});
});
