import { describe, expect, test } from "bun:test";
import type { BridgeServer } from "../src/browser/extension-bridge";
import { BROWSER_TOOL_NAMES } from "../src/browser/extension-bridge-tools";
import {
	type HeadlessBridgeDeps,
	sessionInfoForOfficeServe,
	startHeadlessChatBridge,
} from "../src/browser/headless-bridge";

/** A minimal BridgeServer double recording the calls the bootstrap makes. */
function makeFakeBridge() {
	const calls: string[] = [];
	const fake = {
		port: 19222,
		wssPort: 19322,
		setSessionInfo: () => calls.push("setSessionInfo"),
		broadcastTenantChanged: () => {},
		onConnected: () => {},
		onMessage: () => {},
		send: () => {},
		close: async () => {
			calls.push("close");
		},
	};
	return { bridge: fake as unknown as BridgeServer, calls };
}

/** Build injected deps around a fake bridge + fake ChatHandler, recording order. */
function makeDeps(opts: { tls?: unknown } = {}) {
	const { bridge, calls } = makeFakeBridge();
	const log: string[] = [];
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
			log.push("setShared");
			calls.push(b === bridge ? "setShared:same" : "setShared:other");
		}) as HeadlessBridgeDeps["setSharedBridgeServer"],
		createExtensionBridgeTools: (() => [
			"extension-tool",
		]) as unknown as HeadlessBridgeDeps["createExtensionBridgeTools"],
		createAgentSession: (async (o: Record<string, unknown>) => {
			log.push("createSession");
			sessionOpts = o;
			return { session: { id: "s" } };
		}) as unknown as HeadlessBridgeDeps["createAgentSession"],
		ChatHandlerCtor: FakeChatHandler as unknown as HeadlessBridgeDeps["ChatHandlerCtor"],
	};
	return {
		deps,
		bridge,
		calls,
		log,
		handler,
		sessionOpts: () => sessionOpts,
		bridgeOpts: () => bridgeOpts,
		chatCtor: () => chatCtor,
	};
}

describe("startHeadlessChatBridge", () => {
	test("wires bridge → shared → session (browser tools, headless) → ChatHandler.attach", async () => {
		const h = makeDeps({ tls: { key: "k", cert: "c" } });
		const running = await startHeadlessChatBridge(h.deps);

		// Bridge started WITH the tls opts, published as the shared bridge, session info set.
		expect(h.bridgeOpts()).toEqual({ tls: { key: "k", cert: "c" } });
		expect(h.calls).toContain("setShared:same");
		expect(h.calls).toContain("setSessionInfo");

		// ONE headless session, scoped to the browser tools, no MCP/LSP/discovery.
		const o = h.sessionOpts();
		expect(o?.hasUI).toBe(false);
		expect(o?.enableMCP).toBe(false);
		expect(o?.enableLsp).toBe(false);
		expect(o?.disableExtensionDiscovery).toBe(true);
		expect(o?.customTools).toEqual(["extension-tool"]);
		for (const name of BROWSER_TOOL_NAMES) expect(o?.toolNames as string[]).toContain(name);

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

	test("starts ws-only (no tls opts) when the cert can't be provisioned", async () => {
		const h = makeDeps({ tls: undefined });
		await startHeadlessChatBridge(h.deps);
		expect(h.bridgeOpts()).toBeUndefined();
	});

	test("dispose() disposes the ChatHandler and closes the bridge", async () => {
		const h = makeDeps();
		const running = await startHeadlessChatBridge(h.deps);
		await running.dispose();
		expect(h.handler.disposed).toBe(true);
		expect(h.calls).toContain("close");
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
