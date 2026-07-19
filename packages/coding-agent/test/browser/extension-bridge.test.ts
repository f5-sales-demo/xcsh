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
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import {
	ADDIN_ALLOWED_ORIGIN_SUFFIXES,
	isAllowedBridgeOrigin,
	startBridgeServer,
	WSS_PORT_OFFSET,
} from "../../src/browser/extension-bridge";
import { EXTENSION_ID } from "../../src/cli/chrome-cli";

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

describe("isAllowedBridgeOrigin (pure predicate)", () => {
	test("the Chrome extension origin is allowed (unchanged behavior)", () => {
		expect(isAllowedBridgeOrigin(`chrome-extension://${EXTENSION_ID}`)).toBe(true);
	});

	test("https *.local-ip.sh add-in origins are allowed", () => {
		expect(isAllowedBridgeOrigin("https://x.local-ip.sh")).toBe(true);
		expect(isAllowedBridgeOrigin("https://127-0-0-1.local-ip.sh:8443")).toBe(true);
	});

	test("look-alike host without the dot-prefixed suffix is rejected", () => {
		expect(isAllowedBridgeOrigin("https://evil-local-ip.sh")).toBe(false);
	});

	test("non-https local-ip.sh origin is rejected (must be https)", () => {
		expect(isAllowedBridgeOrigin("http://x.local-ip.sh")).toBe(false);
	});

	test("an unrelated https origin is rejected", () => {
		expect(isAllowedBridgeOrigin("https://random.example.com")).toBe(false);
	});

	test("null / empty / undefined is rejected", () => {
		expect(isAllowedBridgeOrigin(null)).toBe(false);
		expect(isAllowedBridgeOrigin("")).toBe(false);
		expect(isAllowedBridgeOrigin(undefined)).toBe(false);
	});

	test("the allowlist is seeded with local-ip.sh and is never a wildcard", () => {
		expect(ADDIN_ALLOWED_ORIGIN_SUFFIXES).toContain("local-ip.sh");
		expect(ADDIN_ALLOWED_ORIGIN_SUFFIXES).not.toContain("*");
	});
});

interface UpgradeResult {
	status: number;
	headers: Record<string, string | string[] | undefined>;
}

/**
 * Drive a raw WebSocket upgrade handshake and resolve the response status +
 * headers WITHOUT exchanging frames. For wss, the client TRUSTS the fixture cert
 * as its CA (explicit `ca`) — NEVER `rejectUnauthorized:false` / any TLS bypass.
 */
function upgradeHandshake(o: { secure: boolean; port: number; origin?: string; ca?: string }): Promise<UpgradeResult> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {
			Connection: "Upgrade",
			Upgrade: "websocket",
			"Sec-WebSocket-Key": randomBytes(16).toString("base64"),
			"Sec-WebSocket-Version": "13",
		};
		if (o.origin) headers.Origin = o.origin;
		const common = { host: "127.0.0.1", port: o.port, path: "/", headers };
		const req = o.secure ? httpsRequest({ ...common, ca: o.ca, servername: "127.0.0.1" }) : httpRequest(common);
		const timer = setTimeout(() => {
			req.destroy();
			reject(new Error("upgrade timeout"));
		}, 5000);
		req.on("upgrade", (res, socket) => {
			clearTimeout(timer);
			socket.destroy();
			resolve({ status: res.statusCode ?? 0, headers: res.headers });
		});
		req.on("response", res => {
			clearTimeout(timer);
			res.resume();
			resolve({ status: res.statusCode ?? 0, headers: res.headers });
		});
		req.on("error", err => {
			clearTimeout(timer);
			reject(err);
		});
		req.end();
	});
}

describe("bridge origin gate (real listeners, gate ENABLED)", () => {
	test("wss upgrade with an allowed add-in Origin succeeds + carries PNA + scoped ACAO", async () => {
		const fixture = makeFixtureCert();
		const server = await startBridgeServer(undefined, { tls: fixture });
		try {
			const res = await upgradeHandshake({
				secure: true,
				port: server.wssPort,
				origin: "https://x.local-ip.sh",
				ca: fixture.cert,
			});
			expect(res.status).toBe(101);
			expect(res.headers["access-control-allow-private-network"]).toBe("true");
			expect(res.headers["access-control-allow-origin"]).toBe("https://x.local-ip.sh");
		} finally {
			await server.close();
		}
	});

	test("a disallowed Origin is rejected with 403", async () => {
		const fixture = makeFixtureCert();
		const server = await startBridgeServer(undefined, { tls: fixture });
		try {
			const res = await upgradeHandshake({
				secure: true,
				port: server.wssPort,
				origin: "https://random.example.com",
				ca: fixture.cert,
			});
			expect(res.status).toBe(403);
		} finally {
			await server.close();
		}
	});

	// Regression: the Chrome extension origin STILL passes the gate on the ws
	// listener, and its response behavior is unchanged (no PNA / scoped-ACAO).
	test("the chrome-extension origin still passes the gate (ws), unchanged response", async () => {
		const server = await startBridgeServer(undefined, {});
		try {
			const res = await upgradeHandshake({
				secure: false,
				port: server.port,
				origin: `chrome-extension://${EXTENSION_ID}`,
			});
			expect(res.status).toBe(101);
			expect(res.headers["access-control-allow-private-network"]).toBeUndefined();
			expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		} finally {
			await server.close();
		}
	});
});
