import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { BridgeServer } from "../src/browser/extension-bridge";
import { resetWorkerIdentity, sessionInfoForWorker, setWorkerIdentity } from "../src/commands/worker";
import { ContextService } from "../src/services/xcsh-context";
import { BROWSER_HELLO, OFFICE_HELLO } from "./helpers/extension-bridge-fixture";

/**
 * Characterization tests for the per-tab extension SESSION contract.
 *
 * A per-tab "session" is a worker process the manager spawns (Bun.spawn, keyed
 * `tab-<id>`); the extension correlates that tab to its worker through the
 * hello/hello_ack handshake. These pin the handshake + session-identity behavior a
 * future startup/session-load optimization MUST preserve — the "don't lose required
 * functionality" guard (the extension-side sibling of the extension-loading contract
 * from #1856). Tested in isolation: no worker spawn, no model, no network.
 */

/** The hello_ack frame the extension consumes (extension-bridge.ts). */
interface HelloAck {
	type: string;
	sessionId: string | null;
	contractVersion?: string;
	tenant: string | null;
	env: string | null;
	contextBound: boolean;
	host?: string | null;
	serveKind?: string;
	version?: string;
	canConfigureProvider?: boolean;
}

/** Open a fake client, send the transport's exact hello, and resolve the parsed acknowledgement. */
function handshake(port: number, hello: Record<string, unknown> = BROWSER_HELLO): Promise<HelloAck> {
	const acknowledgement = Promise.withResolvers<HelloAck>();
	const ws = new WebSocket(`ws://127.0.0.1:${port}`);
	const timer = setTimeout(() => {
		ws.close();
		acknowledgement.reject(new Error("hello_ack timeout"));
	}, 5_000);
	ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
	ws.addEventListener("message", ev => {
		let msg: HelloAck;
		try {
			msg = JSON.parse(String(ev.data));
		} catch {
			return;
		}
		if (msg.type !== "hello_ack") return;
		clearTimeout(timer);
		ws.close();
		acknowledgement.resolve(msg);
	});
	ws.addEventListener("error", () => {
		clearTimeout(timer);
		acknowledgement.reject(new Error("ws error"));
	});
	return acknowledgement.promise;
}

describe("extension session contract", () => {
	// sessionInfoForWorker consults the ContextService SINGLETON before the env fallback.
	// 13 other test files init that singleton, and Bun runs the suite in one process — so
	// pin it to a fresh EMPTY config dir here (no stored contexts → activeApiUrl null,
	// no active context) to make the contextless env-parsing path deterministic regardless
	// of file load order. (init() re-points the singleton, matching how the context tests
	// isolate themselves.)
	let ctxDir: TempDir;
	beforeEach(() => {
		ctxDir = TempDir.createSync("@pi-session-ctx-");
		ContextService.init(ctxDir.path());
	});
	afterEach(() => {
		ctxDir.removeSync();
	});

	// --- sessionInfoForWorker: the per-tab routing key derived from spawn env ---

	describe("sessionInfoForWorker", () => {
		let saved: Record<string, string | undefined>;
		beforeEach(() => {
			saved = {
				XCSH_SESSION_ID: process.env.XCSH_SESSION_ID,
				XCSH_SESSION_TENANT: process.env.XCSH_SESSION_TENANT,
				XCSH_API_URL: process.env.XCSH_API_URL,
			};
			process.env.XCSH_SESSION_ID = "tab-7";
			process.env.XCSH_SESSION_TENANT = "example-corp|staging";
			delete process.env.XCSH_API_URL;
		});
		afterEach(() => {
			// setWorkerIdentity mutates module state — clear it so env-seeded cases stay deterministic.
			resetWorkerIdentity();
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		});

		it("echoes XCSH_SESSION_ID as the tab-correlation sessionId and parses the tenant", () => {
			const info = sessionInfoForWorker();
			expect(info.sessionId).toBe("tab-7");
			expect(info.tenant).toBe("example-corp");
			expect(info.env).toBe("staging");
			expect(info.apiUrl).toBeNull();
			expect(info.contextBound).toBe(false);
		});

		it("advertises the 'spare' sentinel sessionId when unbound (no env, no bind)", () => {
			delete process.env.XCSH_SESSION_ID;
			delete process.env.XCSH_SESSION_TENANT;
			const info = sessionInfoForWorker();
			expect(info.sessionId).toBe("spare");
			expect(info.tenant).toBeNull();
			expect(info.env).toBeNull();
			expect(info.contextBound).toBe(false);
		});

		it("reports the bound identity after setWorkerIdentity (late-bind)", () => {
			delete process.env.XCSH_SESSION_ID;
			delete process.env.XCSH_SESSION_TENANT;
			setWorkerIdentity("tab-7", "example-corp|staging");
			const info = sessionInfoForWorker();
			expect(info.sessionId).toBe("tab-7");
			expect(info.tenant).toBe("example-corp");
			expect(info.env).toBe("staging");
		});
	});

	// --- hello/hello_ack handshake in isolation (BridgeServer is a pure transport) ---

	describe("hello_ack handshake", () => {
		let server: BridgeServer;
		let saved: Record<string, string | undefined>;
		beforeEach(() => {
			saved = {
				XCSH_SESSION_ID: process.env.XCSH_SESSION_ID,
				XCSH_SESSION_TENANT: process.env.XCSH_SESSION_TENANT,
				XCSH_API_URL: process.env.XCSH_API_URL,
			};
			process.env.XCSH_SESSION_ID = "tab-7";
			process.env.XCSH_SESSION_TENANT = "example-corp|staging";
			delete process.env.XCSH_API_URL;
			server = new BridgeServer({ serveKind: "browser", sessionInfo: sessionInfoForWorker });
			// port 0 = OS-ephemeral; skipOriginCheck so a non-extension client may connect.
			expect(server.listen(0, { skipOriginCheck: true })).toBe(true);
		});
		afterEach(async () => {
			await server.close();
			resetWorkerIdentity();
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		});

		it("answers hello with the worker's session identity and a major-2 contract", async () => {
			const ack = await handshake(server.port);

			expect(ack.type).toBe("hello_ack");
			expect(ack.sessionId).toBe("tab-7");
			expect(ack.tenant).toBe("example-corp");
			expect(ack.env).toBe("staging");
			expect(ack.contextBound).toBe(false);
			// The clean-break extension requires contract major 2 to bind and route.
			expect(Number(ack.contractVersion?.split(".")[0])).toBe(2);
			expect(ack).not.toHaveProperty("pid");
			expect(ack).not.toHaveProperty("apiUrl");
		});

		it("does not expose Office identity fields to the Chrome extension", async () => {
			const ack = await handshake(server.port);
			expect("host" in ack).toBe(false);
			expect("version" in ack).toBe(false);
			expect("canConfigureProvider" in ack).toBe(false);
		});

		it("does not advertise the Office-only serveKind on a browser bridge", async () => {
			const ack = await handshake(server.port);
			expect("serveKind" in ack).toBe(false);
		});

		it("echoes a valid announced client host on an Office bridge", async () => {
			await server.close();
			server = new BridgeServer({ serveKind: "office", sessionInfo: sessionInfoForWorker });
			expect(server.listen(0, { skipOriginCheck: true })).toBe(true);
			const ack = await handshake(server.port, OFFICE_HELLO);
			expect(ack.host).toBe("excel");
			expect(ack.serveKind).toBe("office");
			expect(ack.canConfigureProvider).toBe(true);
			expect(server.clientHost).toBe("excel");
		});

		// --- Perf guard (catastrophic-regression only; NOT a tight budget) ---
		it("completes the handshake within a generous time budget", async () => {
			const start = Bun.nanoseconds();
			const ack = await handshake(server.port);
			const elapsedMs = (Bun.nanoseconds() - start) / 1e6;

			expect(ack.type).toBe("hello_ack");
			// Generous bound — guards against a pathological handshake regression, not micro-perf.
			expect(elapsedMs).toBeLessThan(5_000);
		});
	});
});
