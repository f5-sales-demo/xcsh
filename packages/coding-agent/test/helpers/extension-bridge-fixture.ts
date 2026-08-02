import { EXTENSION_CONTRACT_VERSION } from "../../src/browser/capabilities.generated";
import type { BridgeListenOpts, BridgeSessionInfo, StartBridgeOptions } from "../../src/browser/extension-bridge";
import { EXTENSION_ID } from "../../src/browser/extension-identity";

const BROWSER_SESSION: BridgeSessionInfo = {
	tenant: "example-corp",
	env: "staging",
	contextBound: true,
	sessionId: "tab-7",
};

const OFFICE_SESSION: BridgeSessionInfo = {
	tenant: "example-corp",
	env: "staging",
	contextBound: true,
	sessionId: null,
};

export const BROWSER_HELLO = {
	type: "hello",
	contractVersion: EXTENSION_CONTRACT_VERSION,
	extensionId: EXTENSION_ID,
} as const;

export const OFFICE_HELLO = { type: "hello", version: "1", host: "excel" } as const;

export function browserBridgeOptions(options: BridgeListenOpts = {}): StartBridgeOptions {
	return { ...options, serveKind: "browser", sessionInfo: () => BROWSER_SESSION };
}

export function officeBridgeOptions(options: BridgeListenOpts = {}): StartBridgeOptions {
	return { ...options, serveKind: "office", sessionInfo: () => OFFICE_SESSION };
}

export function sendBrowserHello(ws: WebSocket): void {
	ws.send(JSON.stringify(BROWSER_HELLO));
}

export function authenticateBrowserSocket(ws: WebSocket): Promise<Record<string, unknown>> {
	const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
	ws.addEventListener(
		"message",
		event => {
			try {
				resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
			} catch {
				reject(new Error("bridge returned malformed JSON"));
			}
		},
		{ once: true },
	);
	sendBrowserHello(ws);
	return promise;
}
