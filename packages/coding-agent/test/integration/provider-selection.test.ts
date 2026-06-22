/**
 * Integration test: selectProvider auto-selects the extension provider when the
 * bridge is connected, and falls back to CdpBrowserProvider when not.
 *
 * Uses a REAL Unix-socket bridge + a mock client to exercise the actual socket
 * I/O path — not just mocked objects.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as net from "node:net";
import { type BridgeServer, startBridgeServer } from "@f5xc-salesdemos/xcsh/browser/extension-bridge";
import { ExtensionBrowserProvider } from "@f5xc-salesdemos/xcsh/browser/extension-provider";
import { CdpBrowserProvider, selectProvider } from "@f5xc-salesdemos/xcsh/browser/provider";

const SOCK = `/tmp/xcsh-test-bridge-${process.pid}.sock`;

describe("selectProvider", () => {
	let server: BridgeServer | null = null;
	let mockClient: net.Socket | null = null;

	afterEach(async () => {
		mockClient?.destroy();
		mockClient = null;
		await server?.close().catch(() => {});
		server = null;
	});

	it("returns ExtensionBrowserProvider when the bridge has a connected client", async () => {
		// Pre-create the bridge server on a test socket.
		server = await startBridgeServer(SOCK);

		// Connect a mock "native host" client — just a raw TCP connection, no data needed.
		mockClient = net.createConnection(SOCK);
		await new Promise<void>((resolve, reject) => {
			mockClient!.on("connect", resolve);
			mockClient!.on("error", reject);
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
