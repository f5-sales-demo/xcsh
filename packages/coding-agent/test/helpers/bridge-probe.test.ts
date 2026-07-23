import { describe, expect, it } from "bun:test";
import { probe } from "./bridge-probe";

/**
 * Regression for #2207: the extension bridge multiplexes typed frames on one
 * WebSocket — `hello_ack` (the handshake answer) plus `span` TTFT telemetry.
 * During a cold worker spawn a `session_build` span can be pushed BEFORE the
 * `hello_ack`; probe() must return the ack, not whatever frame arrives first.
 */
describe("bridge probe() frame demultiplexing", () => {
	it("returns hello_ack even when a telemetry span races ahead of it", async () => {
		const ack = { type: "hello_ack", tenant: "acme", env: "staging", sessionId: "tab-1" };
		const span = { type: "span", stage: "session_build", ms: 745, sid: "tab-1", cold: true };
		const server = Bun.serve({
			port: 0,
			fetch(req, srv) {
				if (srv.upgrade(req)) return undefined;
				return new Response("expected websocket upgrade", { status: 400 });
			},
			websocket: {
				open(ws) {
					// Emit the span FIRST to reproduce the cold-start interleaving.
					ws.send(JSON.stringify(span));
					ws.send(JSON.stringify(ack));
				},
				message() {},
			},
		});
		try {
			const frame = await probe(server.port);
			expect(frame).toMatchObject({ type: "hello_ack", tenant: "acme", env: "staging" });
		} finally {
			server.stop(true);
		}
	});

	it("still returns hello_ack when it is the only frame", async () => {
		const ack = { type: "hello_ack", tenant: "acme", env: "prod", sessionId: "tab-2" };
		const server = Bun.serve({
			port: 0,
			fetch(req, srv) {
				if (srv.upgrade(req)) return undefined;
				return new Response("expected websocket upgrade", { status: 400 });
			},
			websocket: {
				open(ws) {
					ws.send(JSON.stringify(ack));
				},
				message() {},
			},
		});
		try {
			const frame = await probe(server.port);
			expect(frame).toMatchObject({ type: "hello_ack", tenant: "acme", env: "prod" });
		} finally {
			server.stop(true);
		}
	});
});
