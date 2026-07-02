import { describe, expect, it } from "bun:test";
import { BridgeServer } from "../../src/browser/extension-bridge";

describe("BridgeServer multi-client", () => {
	it("tracks connected count (not just boolean)", () => {
		const b = new BridgeServer();
		expect(b.connected).toBe(false);
		expect(b.connectedCount).toBe(0);
	});

	it("request rejects when no client is connected", async () => {
		const b = new BridgeServer();
		await expect(b.request("ping", {})).rejects.toThrow("no client connected");
	});

	it("request with a channelId rejects when that channel is not connected", async () => {
		const b = new BridgeServer();
		await expect(b.request("ping", {}, 5000, "ch-99")).rejects.toThrow("channel");
	});
});
