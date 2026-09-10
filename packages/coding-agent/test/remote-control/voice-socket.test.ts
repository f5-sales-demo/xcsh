import { expect, test } from "bun:test";
import { openVoiceSocket } from "../../src/remote-control/voice-socket";

const handlers = { message: (_data: string) => {}, closed: () => {} };
test.each([401, 403, 404, 410, 429, 503])(
	"native voice handshake classifies rejection %s without inventing status or exposing contents",
	async status => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("private fixture body", { status }),
		});
		try {
			const error = await openVoiceSocket(
				`ws://127.0.0.1:${server.port}`,
				{ Authorization: "Bearer fixture-secret" },
				handlers,
			).catch(error => error);
			expect(error).toBeInstanceOf(Error);
			expect(error.message).toBe("Realtime WebSocket upgrade rejected");
		} finally {
			server.stop(true);
		}
	},
);
test("voice handshake does not follow redirects or forward subscription headers", async () => {
	let reached = false;
	const target = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => {
			reached = true;
			return new Response("unexpected");
		},
	});
	const source = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${target.port}` } }),
	});
	try {
		await expect(
			openVoiceSocket(`ws://127.0.0.1:${source.port}`, { Authorization: "Bearer fixture-secret" }, handlers),
		).rejects.toThrow("Realtime WebSocket upgrade rejected");
		expect(reached).toBe(false);
	} finally {
		source.stop(true);
		target.stop(true);
	}
});
test("native voice socket delivers text frames and reports transport closure", async () => {
	const messages: string[] = [];
	let closed = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return;
			return new Response(null, { status: 400 });
		},
		websocket: {
			message(socket, message) {
				socket.send(message);
				socket.close();
			},
		},
	});
	try {
		const socket = await openVoiceSocket(
			`ws://127.0.0.1:${server.port}`,
			{},
			{
				message: data => {
					messages.push(data);
				},
				closed: () => {
					closed = true;
				},
			},
		);
		socket.send("fixture frame");
		const deadline = Date.now() + 1000;
		while (!closed && Date.now() < deadline) await Bun.sleep(5);
		expect(messages).toEqual(["fixture frame"]);
		expect(closed).toBe(true);
		socket.close();
	} finally {
		server.stop(true);
	}
});
