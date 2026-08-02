import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { RpcClient } from "../src/modes/rpc/rpc-client";

describe("RpcClient.start", () => {
	test("rejects when RPC process exits immediately", async () => {
		using client = new RpcClient({
			cliPath: path.join(import.meta.dir, "fixtures", "rpc-exit-before-ready.ts"),
			cwd: import.meta.dir,
		});

		await expect(client.start()).rejects.toThrow(/intentional startup failure/);
	});
});
