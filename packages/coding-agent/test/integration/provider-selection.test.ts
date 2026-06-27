/**
 * Integration test: selectProvider auto-selects the extension provider when the
 * bridge is connected, and falls back to CdpBrowserProvider when not.
 *
 * Uses a REAL WebSocket bridge + a mock client to exercise the actual WS
 * path — not just mocked objects.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { type BridgeServer, startBridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import { ExtensionBrowserProvider } from "@f5-sales-demo/xcsh/browser/extension-provider";
import { CdpBrowserProvider, selectProvider } from "@f5-sales-demo/xcsh/browser/provider";

describe("selectProvider", () => {
	let server: BridgeServer | null = null;
	let mockClient: WebSocket | null = null;

	afterEach(async () => {
		mockClient?.close();
		mockClient = null;
		await server?.close().catch(() => {});
		server = null;
	});

	it("returns ExtensionBrowserProvider when the bridge has a connected client", async () => {
		server = await startBridgeServer(0);

		// Connect a mock extension client via WebSocket.
		mockClient = new WebSocket(`ws://127.0.0.1:${server.port}`);
		await new Promise<void>((resolve, reject) => {
			mockClient!.onopen = () => resolve();
			mockClient!.onerror = () => reject(new Error("ws connect failed"));
		});
		expect(server.connected).toBe(true);

		// Inject the pre-created, pre-connected server into selectProvider.
		const provider = await selectProvider({ get: () => undefined }, { probeTimeoutMs: 2000, bridgeServer: server });
		expect(provider).toBeInstanceOf(ExtensionBrowserProvider);
	});

	it("falls back to CdpBrowserProvider when no extension connects", async () => {
		const provider = await selectProvider({ get: () => undefined }, { probeTimeoutMs: 500 });
		expect(provider).toBeInstanceOf(CdpBrowserProvider);
	});
});
