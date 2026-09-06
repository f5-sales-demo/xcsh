import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import { connect } from "bun";
import { startServer } from "../src/server";

async function tcpConnects(hostname: string, port: number): Promise<boolean> {
	try {
		const socket = await connect({ hostname, port, socket: { data() {}, open() {}, close() {}, error() {} } });
		socket.end();
		return true;
	} catch {
		return false;
	}
}

describe("stats dashboard network boundary", () => {
	it("binds explicitly to IPv4 loopback without granting cross-origin reads", async () => {
		const server = await startServer(0);
		try {
			expect(server.hostname).toBe("127.0.0.1");
			const response = await fetch(`http://127.0.0.1:${server.port}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			expect(await tcpConnects("127.0.0.1", server.port)).toBe(true);
			expect(await tcpConnects("127.0.0.2", server.port)).toBe(false);

			const nonLoopback = Object.values(os.networkInterfaces())
				.flat()
				.find(address => address?.family === "IPv4" && !address.internal)?.address;
			if (nonLoopback) {
				expect(await tcpConnects(nonLoopback, server.port)).toBe(false);
			}
		} finally {
			server.stop();
		}
	});
});
