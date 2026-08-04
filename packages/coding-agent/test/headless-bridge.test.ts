import { describe, expect, test } from "bun:test";
import { type BridgeServer, OFFICE_PORT_RANGE } from "../src/browser/extension-bridge";
import { BROWSER_TOOL_NAMES, OFFICE_TOOL_NAMES } from "../src/browser/extension-bridge-tools";
import {
	type HeadlessBridgeDeps,
	sessionInfoForOfficeServe,
	startHeadlessChatBridge,
} from "../src/browser/headless-bridge";
import type { PickResult } from "../src/browser/native-picker";

/** A minimal BridgeServer double recording the calls the bootstrap makes. */
function makeFakeBridge() {
	const calls: string[] = [];
	const sent: Record<string, unknown>[] = [];
	const msgHandlers: Array<(m: Record<string, unknown>) => void> = [];
	const fake = {
		port: 19242,
		wssPort: 19342,
		broadcastTenantChanged: () => {},
		onConnected: () => {},
		onMessage: (cb: (m: Record<string, unknown>) => void) => msgHandlers.push(cb),
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		close: async () => {
			calls.push("close");
		},
	};
	// Fan a frame out to every subscriber (the real bridge multi-subscriber behavior).
	const fire = (m: Record<string, unknown>) => {
		for (const cb of msgHandlers) cb(m);
	};
	return { bridge: fake as unknown as BridgeServer, calls, sent, fire };
}

/** Build injected deps around a fake bridge + fake ChatHandler, recording order. */
function makeDeps(opts: { tls?: unknown; sessionThrows?: boolean; pick?: PickResult } = {}) {
	const { bridge, calls, sent, fire } = makeFakeBridge();
	const log: string[] = [];
	const pickCalls: Array<"file" | "folder"> = [];
	let sessionOpts: Record<string, unknown> | undefined;
	let chatCtor: { bridge: unknown; session: unknown } | undefined;
	const handler = { attached: false, disposed: false };

	class FakeChatHandler {
		constructor(b: unknown, s: unknown) {
			chatCtor = { bridge: b, session: s };
		}
		attach() {
			handler.attached = true;
			log.push("attach");
		}
		dispose() {
			handler.disposed = true;
			log.push("dispose");
		}
	}

	let bridgeOpts: unknown;
	const deps: HeadlessBridgeDeps = {
		initEnv: async () => ({ cwd: "/tmp/office-serve" }),
		resolveBridgeTls: (async () => opts.tls) as HeadlessBridgeDeps["resolveBridgeTls"],
		startBridgeServer: (async (_port?: number, o?: unknown) => {
			bridgeOpts = o;
			return bridge;
		}) as HeadlessBridgeDeps["startBridgeServer"],
		setSharedBridgeServer: ((b: unknown) => {
			log.push(b === null ? "clearShared" : "setShared");
			calls.push(b === null ? "setShared:null" : b === bridge ? "setShared:same" : "setShared:other");
		}) as HeadlessBridgeDeps["setSharedBridgeServer"],
		createAgentSession: (async (o: Record<string, unknown>) => {
			log.push("createSession");
			sessionOpts = o;
			if (opts.sessionThrows) throw new Error("createAgentSession failed (bad provider)");
			return { session: { id: "s" } };
		}) as unknown as HeadlessBridgeDeps["createAgentSession"],
		ChatHandlerCtor: FakeChatHandler as unknown as HeadlessBridgeDeps["ChatHandlerCtor"],
		pickPath: (async (mode: "file" | "folder") => {
			pickCalls.push(mode);
			return opts.pick ?? { ok: true, path: "/picked/dir" };
		}) as HeadlessBridgeDeps["pickPath"],
	};
	return {
		deps,
		bridge,
		calls,
		sent,
		fire,
		log,
		handler,
		pickCalls,
		sessionOpts: () => sessionOpts,
		bridgeOpts: () => bridgeOpts,
		chatCtor: () => chatCtor,
	};
}

describe("startHeadlessChatBridge", () => {
	test("wires bridge → shared → session (browser tools, headless) → ChatHandler.attach", async () => {
		const h = makeDeps({ tls: { key: "k", cert: "c" } });
		const running = await startHeadlessChatBridge(h.deps);

		// Bridge started WITH the tls opts AND the dedicated office range, published as
		// the shared bridge, session info set, and serveKind advertised as "office".
		expect(h.bridgeOpts()).toMatchObject({
			tls: { key: "k", cert: "c" },
			range: OFFICE_PORT_RANGE,
			serveKind: "office",
			sessionInfo: expect.any(Function),
		});
		expect(h.calls).toContain("setShared:same");

		// ONE headless Office session, scoped to the minimal general tool set (NO
		// browser builtin tools — they'd be hallucinated in a document task pane;
		// document tools arrive at runtime via set_host_tools), no MCP/LSP/discovery.
		const o = h.sessionOpts();
		expect(o?.hasUI).toBe(false);
		expect(o?.enableMCP).toBe(false);
		expect(o?.enableLsp).toBe(false);
		expect(o?.disableExtensionDiscovery).toBe(true);
		// Office session carries NO browser tools — no builtins beyond OFFICE_TOOL_NAMES
		// and no bridge-proxying browser custom tools (they'd be hallucinated in a pane).
		expect(o?.customTools).toEqual([]);
		expect(o?.toolNames).toEqual([...OFFICE_TOOL_NAMES]);
		// Full CLI-parity tools ARE scoped in (bash/read/write for az/gh + file work).
		for (const name of ["bash", "read", "write", "edit"]) {
			expect(o?.toolNames as string[]).toContain(name);
		}
		// No browser builtin tool leaks into the Office session.
		for (const name of BROWSER_TOOL_NAMES) expect(o?.toolNames as string[]).not.toContain(name);
		// The bundled filesystem sandbox loads even though discovery is disabled —
		// the CLI's safety net for the now-enabled bash/read/write tools.
		expect(o?.bundledExtensions).toEqual(["sandbox-guard"]);
		// Office prompts and replies can contain document/customer data. The headless
		// pane session must never inherit the SDK's file-backed default.
		const sessionManager = o?.sessionManager as
			| { isPersisted(): boolean; getSessionFile(): string | undefined }
			| undefined;
		expect(sessionManager?.isPersisted()).toBe(false);
		expect(sessionManager?.getSessionFile()).toBeUndefined();

		// ChatHandler constructed with (bridge, session) and attached.
		expect(h.chatCtor()?.bridge).toBe(h.bridge);
		expect(h.chatCtor()?.session).toEqual({ id: "s" });
		expect(h.handler.attached).toBe(true);

		expect(running.bridge).toBe(h.bridge);
	});

	test("bridge listens before the session is created (pane can connect immediately)", async () => {
		const h = makeDeps();
		await startHeadlessChatBridge(h.deps);
		// setShared (right after startBridgeServer) precedes createSession precedes attach.
		expect(h.log.indexOf("setShared")).toBeLessThan(h.log.indexOf("createSession"));
		expect(h.log.indexOf("createSession")).toBeLessThan(h.log.indexOf("attach"));
	});

	test("starts ws-only (no tls) but STILL binds the office range when the cert can't be provisioned", async () => {
		const h = makeDeps({ tls: undefined });
		await startHeadlessChatBridge(h.deps);
		// No tls key, but the office range is always passed (structural isolation).
		expect(h.bridgeOpts()).toMatchObject({
			range: OFFICE_PORT_RANGE,
			serveKind: "office",
			sessionInfo: expect.any(Function),
		});
	});

	test("starvation guard: office-serve fixes serveKind to 'office' before bind", async () => {
		const h = makeDeps({ tls: undefined });
		await startHeadlessChatBridge(h.deps);
		expect(h.bridgeOpts()).toMatchObject({ serveKind: "office" });
	});

	test("serves pick_path: opens the native picker and replies path_picked with the chosen path", async () => {
		const h = makeDeps({ tls: { key: "k", cert: "c" }, pick: { ok: true, path: "/tmp/example-context" } });
		await startHeadlessChatBridge(h.deps);
		h.fire({ type: "pick_path", mode: "folder" });
		await Bun.sleep(0); // async pick handler
		expect(h.pickCalls).toEqual(["folder"]);
		expect(h.sent.find(m => m.type === "path_picked")).toMatchObject({ path: "/tmp/example-context" });
	});

	test("pick_path cancel replies path_picked with canceled and no path", async () => {
		const h = makeDeps({ tls: { key: "k", cert: "c" }, pick: { ok: false, canceled: true } });
		await startHeadlessChatBridge(h.deps);
		h.fire({ type: "pick_path", mode: "file" });
		await Bun.sleep(0);
		const reply = h.sent.find(m => m.type === "path_picked");
		expect(reply?.canceled).toBe(true);
		expect(reply?.path).toBeUndefined();
	});

	test("after dispose, a late pick_path is ignored (no reply on a closed bridge)", async () => {
		const h = makeDeps({ tls: { key: "k", cert: "c" } });
		const running = await startHeadlessChatBridge(h.deps);
		await running.dispose();
		h.fire({ type: "pick_path", mode: "folder" });
		await Bun.sleep(0);
		expect(h.pickCalls).toHaveLength(0);
		expect(h.sent.find(m => m.type === "path_picked")).toBeUndefined();
	});

	test("dispose() disposes the ChatHandler and closes the bridge", async () => {
		const h = makeDeps();
		const running = await startHeadlessChatBridge(h.deps);
		await running.dispose();
		expect(h.handler.disposed).toBe(true);
		expect(h.calls).toContain("close");
	});

	test("no leak: a session-bootstrap failure AFTER bind closes the bridge + clears the shared global, then rethrows", async () => {
		const h = makeDeps({ sessionThrows: true });
		// The bridge bound, then createAgentSession threw — the error propagates.
		await expect(startHeadlessChatBridge(h.deps)).rejects.toThrow(/createAgentSession failed/);
		// The bound listener is closed (no leaked ws/wss port) and the shared global
		// is cleared (no dangling ref for a later selectProvider to reuse).
		expect(h.calls).toContain("close");
		expect(h.calls).toContain("setShared:null");
	});
});

describe("sessionInfoForOfficeServe", () => {
	test("is contextless-friendly: reports env apiUrl + contextBound=false when no context", () => {
		const prev = process.env.XCSH_API_URL;
		process.env.XCSH_API_URL = "https://tenant.console.ves.volterra.io";
		try {
			const info = sessionInfoForOfficeServe();
			expect(info.apiUrl).toBe("https://tenant.console.ves.volterra.io");
			expect(info.contextBound).toBe(false);
			expect(info.sessionId).toBeNull();
		} finally {
			if (prev === undefined) delete process.env.XCSH_API_URL;
			else process.env.XCSH_API_URL = prev;
		}
	});
});
