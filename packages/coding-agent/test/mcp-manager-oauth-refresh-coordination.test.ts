import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@f5-sales-demo/pi-ai";
import { MCPManager } from "../src/mcp/manager";
import type { MCPServerConfig } from "../src/mcp/types";

const storages: AuthStorage[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
	for (const storage of storages.splice(0)) storage.close();
	for (const tempDir of tempDirs.splice(0)) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("MCP OAuth refresh coordination", () => {
	test("coalesces proactive and forced refreshes across manager instances", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-mcp-oauth-refresh-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const leftStorage = await AuthStorage.create(dbPath);
		const rightStorage = await AuthStorage.create(dbPath);
		storages.push(leftStorage, rightStorage);
		await leftStorage.set("mcp-test-credential", {
			type: "oauth",
			access: "expired-access",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		});
		await rightStorage.reload();

		let requests = 0;
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				requests += 1;
				const body = new URLSearchParams(await request.text());
				const expected = `refresh-${requests}`;
				if (body.get("refresh_token") !== expected) {
					return Response.json({ error: "invalid_grant" }, { status: 400 });
				}
				return Response.json({
					access_token: `access-${requests + 1}`,
					refresh_token: `refresh-${requests + 1}`,
					expires_in: 3600,
				});
			},
		});
		try {
			const config: MCPServerConfig = {
				type: "http",
				url: "https://mcp.example.test",
				auth: {
					type: "oauth",
					credentialId: "mcp-test-credential",
					tokenUrl: `http://127.0.0.1:${server.port}/token`,
					clientId: "client-id",
				},
			};
			const leftManager = new MCPManager(tempDir);
			const rightManager = new MCPManager(tempDir);
			leftManager.setAuthStorage(leftStorage);
			rightManager.setAuthStorage(rightStorage);

			const proactive = await Promise.all([leftManager.prepareConfig(config), rightManager.prepareConfig(config)]);
			expect(requests).toBe(1);
			expect(proactive.map(item => item.type === "http" && item.headers?.Authorization)).toEqual([
				"Bearer access-2",
				"Bearer access-2",
			]);

			const forced = await Promise.all([
				leftManager.prepareConfig(config, true),
				rightManager.prepareConfig(config, true),
			]);
			expect(requests).toBe(2);
			expect(forced.map(item => item.type === "http" && item.headers?.Authorization)).toEqual([
				"Bearer access-3",
				"Bearer access-3",
			]);
			await leftStorage.reload();
			expect(leftStorage.getOAuthCredential("mcp-test-credential")?.refresh).toBe("refresh-3");
		} finally {
			server.stop(true);
		}
	});

	test("adopts a peer rotation instead of disabling it after stale invalid_grant", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-mcp-oauth-stale-invalid-grant-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const storage = await AuthStorage.create(dbPath);
		const peer = await AuthStorage.create(dbPath);
		storages.push(storage, peer);
		await storage.set("mcp-stale-credential", {
			type: "oauth",
			access: "expired-access",
			refresh: "stale-refresh",
			expires: Date.now() - 1,
			accountId: "example-account",
		});
		await peer.reload();

		let requests = 0;
		const server = Bun.serve({
			port: 0,
			async fetch() {
				requests += 1;
				await peer.set("mcp-stale-credential", {
					type: "oauth",
					access: "peer-access",
					refresh: "peer-refresh",
					expires: Date.now() + 60 * 60_000,
					accountId: "example-account",
				});
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			},
		});
		try {
			const manager = new MCPManager(tempDir);
			manager.setAuthStorage(storage);
			const resolved = await manager.prepareConfig({
				type: "http",
				url: "https://mcp.example.test",
				auth: {
					type: "oauth",
					credentialId: "mcp-stale-credential",
					tokenUrl: `http://127.0.0.1:${server.port}/token`,
				},
			});

			expect(requests).toBe(1);
			expect(resolved.type === "http" && resolved.headers?.Authorization).toBe("Bearer peer-access");
			expect(storage.listStoredCredentials("mcp-stale-credential")).toHaveLength(1);
			expect(storage.getOAuthCredential("mcp-stale-credential")?.refresh).toBe("peer-refresh");
		} finally {
			server.stop(true);
		}
	});

	test("disables an unchanged terminal MCP credential and requires reauthentication", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-mcp-oauth-terminal-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const storage = await AuthStorage.create(dbPath);
		storages.push(storage);
		await storage.set("mcp-terminal-credential", {
			type: "oauth",
			access: "expired-access",
			refresh: "invalid-refresh",
			expires: Date.now() - 1,
		});

		let requests = 0;
		const server = Bun.serve({
			port: 0,
			fetch() {
				requests += 1;
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			},
		});
		try {
			const manager = new MCPManager(tempDir);
			manager.setAuthStorage(storage);
			const resolved = await manager.prepareConfig({
				type: "http",
				url: "https://mcp.example.test",
				auth: {
					type: "oauth",
					credentialId: "mcp-terminal-credential",
					tokenUrl: `http://127.0.0.1:${server.port}/token`,
				},
			});

			expect(requests).toBe(1);
			expect(resolved.type === "http" && resolved.headers?.Authorization).toBeUndefined();
			expect(storage.listStoredCredentials("mcp-terminal-credential")).toHaveLength(0);
		} finally {
			server.stop(true);
		}
	});
});
