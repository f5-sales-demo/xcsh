import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
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

	test("can launch a compiled/native RPC executable without the Bun runtime prefix", async () => {
		const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-rpc-native-launch-"));
		const executablePath = path.join(temporaryDirectory, "rpc-fixture");
		try {
			await fs.writeFile(
				executablePath,
				'#!/bin/sh\nprintf \'{"type":"ready"}\\n\'\nwhile IFS= read -r line; do :; done\n',
				{ mode: 0o700 },
			);
			using client = new RpcClient({
				cliPath: executablePath,
				cwd: temporaryDirectory,
				launchMode: "native",
			});

			await expect(client.start()).resolves.toBeUndefined();
		} finally {
			await fs.rm(temporaryDirectory, { recursive: true, force: true });
		}
	});
});
