import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage, type OAuthCredential } from "../src/auth-storage";
import { registerOAuthProvider, unregisterOAuthProviders } from "../src/utils/oauth";

const SOURCE_ID = "auth-storage-oauth-refresh-coordination-test";
const openStorages: AuthStorage[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
	unregisterOAuthProviders(SOURCE_ID);
	for (const storage of openStorages.splice(0)) storage.close();
	for (const tempDir of tempDirs.splice(0)) await fs.rm(tempDir, { recursive: true, force: true });
});

async function createStorage(): Promise<AuthStorage> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-coordination-"));
	tempDirs.push(tempDir);
	return createStorageAt(path.join(tempDir, "agent.db"));
}

async function createStorageAt(dbPath: string): Promise<AuthStorage> {
	const storage = await AuthStorage.create(dbPath);
	openStorages.push(storage);
	return storage;
}

describe("durable OAuth refresh coordination", () => {
	test("coalesces simultaneous refreshes of one stored row in a process", async () => {
		const storage = await createStorage();
		await storage.set("synthetic-rotating", {
			type: "oauth",
			access: "expired-access",
			refresh: "rotating-refresh-1",
			expires: Date.now() - 1,
		});

		let requestCount = 0;
		const bothStarted = Promise.withResolvers<void>();
		registerOAuthProvider({
			id: "synthetic-rotating",
			name: "Synthetic rotating OAuth",
			sourceId: SOURCE_ID,
			login: async () => "unused",
			refreshToken: async () => {
				requestCount += 1;
				if (requestCount === 2) bothStarted.resolve();
				await Promise.race([bothStarted.promise, Bun.sleep(250)]);
				return {
					access: "fresh-access",
					refresh: "rotating-refresh-2",
					expires: Date.now() + 60 * 60_000,
				};
			},
		});

		const [left, right] = await Promise.all([
			storage.getApiKey("synthetic-rotating", "left"),
			storage.getApiKey("synthetic-rotating", "right"),
		]);

		expect(requestCount).toBe(1);
		expect(left).toBe("fresh-access");
		expect(right).toBe("fresh-access");
		expect(storage.getOAuthCredential("synthetic-rotating")?.refresh).toBe("rotating-refresh-2");
	});

	test("does not let a fresh non-forced lookup swallow a simultaneous forced refresh", async () => {
		const storage = await createStorage();
		await storage.set("synthetic-forced", {
			type: "oauth",
			access: "current-access",
			refresh: "refresh-1",
			expires: Date.now() + 60 * 60_000,
		});
		const row = storage.listStoredCredentials("synthetic-forced")[0]!;
		if (row.credential.type !== "oauth") throw new Error("test setup failed");
		let calls = 0;
		const baseOptions = {
			credentialId: row.id,
			observedCredential: row.credential,
			credentialFromRow: (credential: OAuthCredential) => credential,
			refresh: async () => {
				calls += 1;
				return { access: "forced-access", refresh: "refresh-2", expires: Date.now() + 60 * 60_000 };
			},
		};

		const [ordinary, forced] = await Promise.all([
			storage.refreshStoredOAuthCredential("synthetic-forced", baseOptions),
			storage.refreshStoredOAuthCredential("synthetic-forced", { ...baseOptions, forceRefresh: true }),
		]);

		expect(calls).toBe(1);
		expect(ordinary.credential?.access).toBe("current-access");
		expect(forced.credential?.access).toBe("forced-access");
	});

	test("serializes two real Bun processes against a rotating token endpoint", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-subprocess-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const seed = await createStorageAt(dbPath);
		await seed.set("synthetic-subprocess", {
			type: "oauth",
			access: "expired-access",
			refresh: "rotating-refresh-1",
			expires: Date.now() - 1,
			accountId: "example-account",
		});

		let readyCount = 0;
		let tokenRequestCount = 0;
		const release = Promise.withResolvers<void>();
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/ready") {
					readyCount += 1;
					if (readyCount === 2) release.resolve();
					await release.promise;
					return new Response("ready");
				}
				if (url.pathname === "/token") {
					tokenRequestCount += 1;
					const body = (await request.json()) as { refresh?: string };
					if (body.refresh !== "rotating-refresh-1" || tokenRequestCount !== 1) {
						return Response.json({ error: "invalid_grant" }, { status: 400 });
					}
					return Response.json({
						access: "fresh-access",
						refresh: "rotating-refresh-2",
						expires: Date.now() + 60 * 60_000,
					});
				}
				return new Response("not found", { status: 404 });
			},
		});

		try {
			const worker = path.join(import.meta.dir, "fixtures", "oauth-refresh-worker.ts");
			const endpoint = `http://127.0.0.1:${server.port}`;
			const children = [0, 1].map(() =>
				Bun.spawn([process.execPath, worker, dbPath, endpoint], {
					stdout: "pipe",
					stderr: "pipe",
				}),
			);
			const outputs = await Promise.all(
				children.map(async child => {
					const [exitCode, stdout, stderr] = await Promise.all([
						child.exited,
						new Response(child.stdout).text(),
						new Response(child.stderr).text(),
					]);
					expect(exitCode, stderr).toBe(0);
					return JSON.parse(stdout) as { access?: string };
				}),
			);

			expect(tokenRequestCount).toBe(1);
			expect(outputs.map(output => output.access)).toEqual(["fresh-access", "fresh-access"]);
			await seed.reload();
			const winner = seed.getOAuthCredential("synthetic-subprocess");
			expect(winner?.refresh).toBe("rotating-refresh-2");
			expect(seed.listStoredCredentials("synthetic-subprocess")).toHaveLength(1);
		} finally {
			server.stop(true);
		}
	}, 15_000);

	test("recovers an expired lease left by a crashed owner", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-expired-lease-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const storage = await createStorageAt(dbPath);
		await storage.set("synthetic-expired-lease", {
			type: "oauth",
			access: "expired",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		});
		const row = storage.listStoredCredentials("synthetic-expired-lease")[0]!;
		const db = new Database(dbPath);
		db.run(
			"INSERT INTO auth_credential_refresh_leases (credential_id, owner, expires_at_ms, updated_at) VALUES (?, ?, ?, ?)",
			[row.id, "crashed-owner", Date.now() - 1, Math.floor(Date.now() / 1000)],
		);
		db.close();

		let calls = 0;
		const outcome = await storage.refreshStoredOAuthCredential("synthetic-expired-lease", {
			credentialId: row.id,
			observedCredential: row.credential.type === "oauth" ? row.credential : undefined,
			credentialFromRow: credential => credential,
			refresh: async () => {
				calls += 1;
				return { access: "fresh", refresh: "refresh-2", expires: Date.now() + 60_000 };
			},
		});

		expect(calls).toBe(1);
		expect(outcome.credential?.access).toBe("fresh");
	});

	test("a stale invalid_grant loser adopts the peer winner", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-stale-loser-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const loser = await createStorageAt(dbPath);
		const peer = await createStorageAt(dbPath);
		const stale: OAuthCredential = {
			type: "oauth",
			access: "stale-access",
			refresh: "stale-refresh",
			expires: Date.now() - 1,
			accountId: "example-account",
		};
		await loser.set("synthetic-stale-loser", stale);
		await peer.reload();
		const row = loser.listStoredCredentials("synthetic-stale-loser")[0]!;

		const outcome = await loser.refreshStoredOAuthCredential("synthetic-stale-loser", {
			credentialId: row.id,
			observedCredential: stale,
			credentialFromRow: credential => credential,
			refresh: async () => {
				await peer.set("synthetic-stale-loser", {
					...stale,
					access: "peer-access",
					refresh: "peer-refresh",
					expires: Date.now() + 60_000,
				});
				throw new Error("invalid_grant");
			},
			isDefinitiveFailure: error => String(error).includes("invalid_grant"),
		});

		expect(outcome.removed).toBeFalse();
		expect(outcome.reauthenticationRequired).toBeFalse();
		expect(outcome.credential?.refresh).toBe("peer-refresh");
		expect(loser.listStoredCredentials("synthetic-stale-loser")).toHaveLength(1);
	});

	test("returns explicit reauthentication-required for unchanged invalid_grant", async () => {
		const storage = await createStorage();
		await storage.set("synthetic-invalid-grant", {
			type: "oauth",
			access: "expired",
			refresh: "invalid-refresh",
			expires: Date.now() - 1,
		});
		const row = storage.listStoredCredentials("synthetic-invalid-grant")[0]!;
		let calls = 0;
		const outcome = await storage.refreshStoredOAuthCredential("synthetic-invalid-grant", {
			credentialId: row.id,
			credentialFromRow: credential => credential,
			refresh: async () => {
				calls += 1;
				throw new Error("invalid_grant");
			},
			isDefinitiveFailure: error => String(error).includes("invalid_grant"),
		});

		expect(calls).toBe(1);
		expect(outcome).toMatchObject({
			credential: undefined,
			refreshed: false,
			removed: true,
			reauthenticationRequired: true,
		});
		expect(storage.listStoredCredentials("synthetic-invalid-grant")).toHaveLength(0);
	});

	test("waits for an aborted refresh callback to settle and never persists its late result", async () => {
		const storage = await createStorage();
		await storage.set("synthetic-abort-settlement", {
			type: "oauth",
			access: "expired",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		});
		const row = storage.listStoredCredentials("synthetic-abort-settlement")[0]!;
		const startedAt = Date.now();

		await expect(
			storage.refreshStoredOAuthCredential("synthetic-abort-settlement", {
				credentialId: row.id,
				credentialFromRow: credential => credential,
				refreshTimeoutMs: 20,
				refresh: async (_credential, signal) => {
					await new Promise<void>(resolve => signal.addEventListener("abort", () => setTimeout(resolve, 40)));
					return { access: "late-access", refresh: "late-refresh", expires: Date.now() + 60_000 };
				},
			}),
		).rejects.toThrow("timed out");

		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(55);
		expect(storage.getOAuthCredential("synthetic-abort-settlement")?.refresh).toBe("refresh-1");
	});

	test("renews ownership while a slow rotating request is in flight", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-renewal-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const first = await createStorageAt(dbPath);
		const second = await createStorageAt(dbPath);
		await first.set("synthetic-slow", {
			type: "oauth",
			access: "expired",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		});
		await second.reload();
		const row = first.listStoredCredentials("synthetic-slow")[0]!;
		let calls = 0;
		const options = {
			credentialId: row.id,
			credentialFromRow: (credential: typeof row.credential) =>
				credential.type === "oauth" ? credential : undefined,
			refreshTimeoutMs: 20_000,
			refresh: async () => {
				calls += 1;
				await Bun.sleep(16_000);
				return { access: "fresh", refresh: "refresh-2", expires: Date.now() + 60 * 60_000 };
			},
		};

		const [left, right] = await Promise.all([
			first.refreshStoredOAuthCredential("synthetic-slow", options),
			second.refreshStoredOAuthCredential("synthetic-slow", options),
		]);

		expect(calls).toBe(1);
		expect(left.credential?.refresh).toBe("refresh-2");
		expect(right.credential?.refresh).toBe("refresh-2");
	}, 25_000);

	test("a stolen lease fences both update and terminal disable", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-fence-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const storage = await createStorageAt(dbPath);
		const original = {
			type: "oauth" as const,
			access: "expired",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		};
		await storage.set("synthetic-fence", original);
		const row = storage.listStoredCredentials("synthetic-fence")[0]!;

		const stealLease = (): void => {
			const db = new Database(dbPath);
			db.run("UPDATE auth_credential_refresh_leases SET owner = ?, expires_at_ms = ? WHERE credential_id = ?", [
				"peer-owner",
				Date.now() + 60_000,
				row.id,
			]);
			db.close();
		};
		const updateOutcome = await storage.refreshStoredOAuthCredential("synthetic-fence", {
			credentialId: row.id,
			credentialFromRow: credential => credential,
			refresh: async () => {
				stealLease();
				return { access: "unfenced", refresh: "unfenced", expires: Date.now() + 60_000 };
			},
		});
		expect(updateOutcome.refreshed).toBeFalse();
		expect(updateOutcome.credential?.refresh).toBe("refresh-1");

		const db = new Database(dbPath);
		db.run("DELETE FROM auth_credential_refresh_leases WHERE credential_id = ?", [row.id]);
		db.close();
		const disableOutcome = await storage.refreshStoredOAuthCredential("synthetic-fence", {
			credentialId: row.id,
			credentialFromRow: credential => credential,
			refresh: async () => {
				stealLease();
				throw new Error("invalid_grant");
			},
			isDefinitiveFailure: () => true,
		});
		expect(disableOutcome.removed).toBeFalse();
		expect(disableOutcome.credential?.refresh).toBe("refresh-1");
		expect(storage.listStoredCredentials("synthetic-fence")).toHaveLength(1);
	});

	test("coordinates independent account rows independently", async () => {
		const storage = await createStorage();
		await storage.set("synthetic-multi-account", [
			{
				type: "oauth",
				access: "expired-a",
				refresh: "refresh-a",
				expires: Date.now() - 1,
				accountId: "example-account-a",
			},
			{
				type: "oauth",
				access: "expired-b",
				refresh: "refresh-b",
				expires: Date.now() - 1,
				accountId: "example-account-b",
			},
		]);
		const rows = storage.listStoredCredentials("synthetic-multi-account");
		const started = Promise.withResolvers<void>();
		let calls = 0;
		const refreshRow = (row: (typeof rows)[number]) =>
			storage.refreshStoredOAuthCredential("synthetic-multi-account", {
				credentialId: row.id,
				credentialFromRow: credential => credential,
				refresh: async current => {
					calls += 1;
					if (calls === 2) started.resolve();
					await started.promise;
					return {
						...current,
						access: `fresh-${current.accountId}`,
						refresh: `rotated-${current.accountId}`,
						expires: Date.now() + 60_000,
					};
				},
			});
		const outcomes = await Promise.all(rows.map(refreshRow));

		expect(calls).toBe(2);
		expect(outcomes.map(outcome => outcome.credential?.accountId).sort()).toEqual([
			"example-account-a",
			"example-account-b",
		]);
	});

	test("coalesces concurrent model and usage refreshes", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-model-usage-"));
		tempDirs.push(tempDir);
		const seenUsageTokens: string[] = [];
		const storage = await AuthStorage.create(path.join(tempDir, "agent.db"), {
			usageProviderResolver: provider =>
				provider === "synthetic-model-usage"
					? {
							id: "synthetic-model-usage",
							async fetchUsage(params) {
								seenUsageTokens.push(params.credential.accessToken ?? "missing");
								return { provider, fetchedAt: Date.now(), limits: [] };
							},
						}
					: undefined,
		});
		openStorages.push(storage);
		await storage.set("synthetic-model-usage", {
			type: "oauth",
			access: "expired",
			refresh: "refresh-1",
			expires: Date.now() - 1,
		});
		let calls = 0;
		registerOAuthProvider({
			id: "synthetic-model-usage",
			name: "Synthetic model usage",
			sourceId: SOURCE_ID,
			login: async () => "unused",
			refreshToken: async () => {
				calls += 1;
				await Bun.sleep(30);
				return { access: "fresh", refresh: "refresh-2", expires: Date.now() + 60 * 60_000 };
			},
		});

		const [access, reports] = await Promise.all([
			storage.getApiKey("synthetic-model-usage", "model"),
			storage.fetchUsageReports(),
		]);
		expect(calls).toBe(1);
		expect(access).toBe("fresh");
		expect(reports).toHaveLength(1);
		expect(seenUsageTokens).toEqual(["fresh"]);
	});

	test("keeps usage refresh failures advisory", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-usage-advisory-"));
		tempDirs.push(tempDir);
		const storage = await AuthStorage.create(path.join(tempDir, "agent.db"), {
			usageProviderResolver: provider =>
				provider === "synthetic-usage-advisory"
					? {
							id: "synthetic-usage-advisory",
							async fetchUsage() {
								return { provider, fetchedAt: Date.now(), limits: [] };
							},
						}
					: undefined,
		});
		openStorages.push(storage);
		await storage.set("synthetic-usage-advisory", {
			type: "oauth",
			access: "expired-but-retained",
			refresh: "terminal-refresh",
			expires: Date.now() - 1,
		});
		registerOAuthProvider({
			id: "synthetic-usage-advisory",
			name: "Synthetic usage advisory",
			sourceId: SOURCE_ID,
			login: async () => "unused",
			refreshToken: async () => {
				throw new Error("invalid_grant");
			},
		});

		await storage.fetchUsageReports();
		expect(storage.listStoredCredentials("synthetic-usage-advisory")).toHaveLength(1);
		expect(storage.getOAuthCredential("synthetic-usage-advisory")?.refresh).toBe("terminal-refresh");
	});

	test("migrates schema v4 additively without changing credential rows", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-oauth-refresh-migration-"));
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "agent.db");
		const db = new Database(dbPath);
		db.run(`
			CREATE TABLE auth_schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
			INSERT INTO auth_schema_version(id, version) VALUES (1, 4);
			CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
			CREATE TABLE auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				disabled_cause TEXT DEFAULT NULL,
				identity_key TEXT DEFAULT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`);
		const credentialData = JSON.stringify({
			access: "preserved-access",
			refresh: "preserved-refresh",
			expires: 123,
			accountId: "example-account",
		});
		db.run(
			"INSERT INTO auth_credentials(provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
			["synthetic-migration", "oauth", credentialData, "account:example-account", 1, 1],
		);
		db.close();

		const storage = await createStorageAt(dbPath);
		await storage.reload();
		expect(storage.getOAuthCredential("synthetic-migration")?.refresh).toBe("preserved-refresh");
		const verification = new Database(dbPath);
		const version = verification.query("SELECT version FROM auth_schema_version WHERE id = 1").get() as {
			version: number;
		};
		const leaseTable = verification
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_credential_refresh_leases'")
			.get() as { name?: string } | null;
		verification.close();
		expect(version.version).toBe(5);
		expect(leaseTable?.name).toBe("auth_credential_refresh_leases");
	});
});
