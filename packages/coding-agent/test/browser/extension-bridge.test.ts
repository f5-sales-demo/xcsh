import { describe, expect, it, test } from "bun:test";
import {
	PendingRequests,
	PORT_RANGE_END,
	PORT_RANGE_START,
	portCandidates,
	resolveForcedPort,
} from "@f5-sales-demo/xcsh/browser/extension-bridge";

describe("PendingRequests", () => {
	it("resolves the matching id and ignores unknown ids", async () => {
		const p = new PendingRequests();
		const { id, promise } = p.create(1000);
		expect(p.resolve("nope", { content: 1, is_error: false })).toBe(false);
		expect(p.resolve(id, { content: "ok", is_error: false })).toBe(true);
		expect(await promise).toEqual({ content: "ok", is_error: false });
	});
	it("generates unique ids", () => {
		const p = new PendingRequests();
		const a = p.create(1000);
		const b = p.create(1000);
		expect(a.id).not.toBe(b.id);
		// Clean up: reject + swallow so their timers don't fire as unhandled errors after the test.
		p.rejectAll(new Error("cleanup"));
		a.promise.catch(() => {});
		b.promise.catch(() => {});
	});
	it("rejectAll fails outstanding promises", async () => {
		const p = new PendingRequests();
		const { promise } = p.create(1000);
		p.rejectAll(new Error("disconnected"));
		await expect(promise).rejects.toThrow(/disconnected/);
	});
});

describe("port selection helpers", () => {
	test("portCandidates is the full inclusive range", () => {
		const c = portCandidates();
		expect(c[0]).toBe(PORT_RANGE_START);
		expect(c.at(-1)).toBe(PORT_RANGE_END);
		expect(c.length).toBe(PORT_RANGE_END - PORT_RANGE_START + 1);
	});

	test("resolveForcedPort: explicit arg wins", () => {
		expect(resolveForcedPort(20000)).toBe(20000);
	});

	test("resolveForcedPort: env when no arg", () => {
		const prev = process.env.XCSH_BRIDGE_PORT;
		process.env.XCSH_BRIDGE_PORT = "19230";
		try {
			expect(resolveForcedPort()).toBe(19230);
		} finally {
			if (prev === undefined) delete process.env.XCSH_BRIDGE_PORT;
			else process.env.XCSH_BRIDGE_PORT = prev;
		}
	});

	test("resolveForcedPort: null when neither set", () => {
		const prev = process.env.XCSH_BRIDGE_PORT;
		delete process.env.XCSH_BRIDGE_PORT;
		try {
			expect(resolveForcedPort()).toBeNull();
		} finally {
			if (prev !== undefined) process.env.XCSH_BRIDGE_PORT = prev;
		}
	});
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { startBridgeServer, WSS_PORT_OFFSET } from "../../src/browser/extension-bridge";

describe("auto-select bind", () => {
	test("two servers land on different ports in range", async () => {
		const a = await startBridgeServer(undefined, { skipOriginCheck: true });
		const b = await startBridgeServer(undefined, { skipOriginCheck: true });
		try {
			expect(a.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(b.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(a.port).not.toBe(b.port);
		} finally {
			await a.close();
			await b.close();
		}
	});

	test("forced port that is taken fails loud", async () => {
		const a = await startBridgeServer(undefined, { skipOriginCheck: true });
		try {
			await expect(startBridgeServer(a.port, { skipOriginCheck: true })).rejects.toThrow();
		} finally {
			await a.close();
		}
	});
});

/** Mint an ephemeral self-signed cert (SAN incl. 127.0.0.1) for the wss listener. No bypass. */
function makeFixtureCert(): { cert: string; key: string } {
	const dir = mkdtempSync(join(tmpdir(), "xcsh-bridge-cert-"));
	const certFile = join(dir, "cert.pem");
	const keyFile = join(dir, "key.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-sha256",
			"-days",
			"2",
			"-nodes",
			"-keyout",
			keyFile,
			"-out",
			certFile,
			"-subj",
			"/CN=localhost",
			"-addext",
			"subjectAltName=DNS:localhost,IP:127.0.0.1",
			"-addext",
			"extendedKeyUsage=serverAuth",
			"-addext",
			"basicConstraints=critical,CA:FALSE",
		],
		{ stdio: "ignore" },
	);
	return { cert: readFileSync(certFile, "utf8"), key: readFileSync(keyFile, "utf8") };
}

/** Drive one `hello` → `hello_ack` round-trip over a WebSocket URL, resolving the ack frame. */
function helloRoundTrip(url: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("hello_ack timeout"));
		}, 5000);
		ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "hello" })));
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as Record<string, unknown>;
			if (msg.type === "hello_ack") {
				clearTimeout(timer);
				ws.close();
				resolve(msg);
			}
		});
		ws.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("ws error"));
		});
	});
}

describe("dual-listen ws + wss", () => {
	test("binds ws in range AND wss at port + WSS_PORT_OFFSET", async () => {
		const server = await startBridgeServer(undefined, { skipOriginCheck: true, tls: makeFixtureCert() });
		try {
			expect(server.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(server.port).toBeLessThanOrEqual(PORT_RANGE_END);
			expect(WSS_PORT_OFFSET).toBe(100);
			expect(server.wssPort).toBe(server.port + WSS_PORT_OFFSET);
		} finally {
			await server.close();
		}
	});

	// Regression guard for the Chrome extension path: plain ws:// must keep working
	// unchanged even with the wss listener enabled.
	test("plain ws:// hello handshake is unchanged", async () => {
		const server = await startBridgeServer(undefined, { skipOriginCheck: true, tls: makeFixtureCert() });
		try {
			const ack = await helloRoundTrip(`ws://127.0.0.1:${server.port}`);
			expect(ack.type).toBe("hello_ack");
			expect(ack.pid).toBe(process.pid);
			expect(ack.wssPort).toBe(server.wssPort);
		} finally {
			await server.close();
		}
	});

	// TLS correctness with NO bypass: a client that explicitly TRUSTS the fixture cert
	// as its CA must find the wss listener's presented cert `authorized === true`.
	test("wss listener presents a cert that validates against the injected CA", async () => {
		const fixture = makeFixtureCert();
		const server = await startBridgeServer(undefined, { skipOriginCheck: true, tls: fixture });
		try {
			const authorized = await new Promise<boolean>((resolve, reject) => {
				const socket = tlsConnect(
					{ host: "127.0.0.1", port: server.wssPort, ca: fixture.cert, servername: "127.0.0.1" },
					() => {
						const ok = socket.authorized;
						socket.end();
						resolve(ok);
					},
				);
				socket.on("error", reject);
			});
			expect(authorized).toBe(true);
		} finally {
			await server.close();
		}
	});

	// A bridge started WITHOUT cert material stays ws-only (no wss listener, no crash).
	test("no tls → ws-only, wssPort is 0", async () => {
		const server = await startBridgeServer(undefined, { skipOriginCheck: true });
		try {
			expect(server.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(server.wssPort).toBe(0);
		} finally {
			await server.close();
		}
	});
});
