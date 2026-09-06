import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";
import type { CredentialRankingStrategy, UsageProvider, UsageReport } from "../src/usage";

const HOUR_MS = 60 * 60 * 1000;

describe("AuthStorage API-key usage reset", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;
	let nowMs = Date.UTC(2026, 8, 6, 12, 0, 0);
	const resetByKey = new Map<string, number>();

	const usageProvider: UsageProvider = {
		id: "zai",
		async fetchUsage(params): Promise<UsageReport | null> {
			const apiKey = params.credential.apiKey;
			const resetsAt = apiKey ? resetByKey.get(apiKey) : undefined;
			if (!apiKey || resetsAt === undefined) return null;
			return {
				provider: "zai",
				fetchedAt: nowMs,
				limits: [
					{
						id: `zai:${apiKey}`,
						label: "Weekly quota",
						scope: { provider: "zai", windowId: "7d", shared: true },
						window: { id: "7d", label: "Weekly", durationMs: 7 * 24 * HOUR_MS, resetsAt },
						amount: { unit: "requests", used: 100, limit: 100, remaining: 0, usedFraction: 1 },
						status: "exhausted",
					},
				],
			};
		},
	};
	const rankingStrategy: CredentialRankingStrategy = {
		findWindowLimits: report => ({ primary: report.limits[0], secondary: report.limits[0] }),
		windowDefaults: { primaryMs: HOUR_MS, secondaryMs: 7 * 24 * HOUR_MS },
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-api-key-reset-"));
		store = await AuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store, {
			usageProviderResolver: provider => (provider === "zai" ? usageProvider : undefined),
			rankingStrategyResolver: provider => (provider === "zai" ? rankingStrategy : undefined),
		});
		resetByKey.clear();
		nowMs = Date.UTC(2026, 8, 6, 12, 0, 0);
		vi.spyOn(Date, "now").mockImplementation(() => nowMs);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("keeps each API key blocked until its live usage reset", async () => {
		if (!authStorage) throw new Error("test setup failed");
		await authStorage.set("zai", [
			{ type: "api_key", key: "zai-first" },
			{ type: "api_key", key: "zai-second" },
		]);

		const sessionId = "api-key-reset-session";
		const first = await authStorage.getApiKey("zai", sessionId);
		if (!first) throw new Error("expected first API key");
		const second = first === "zai-first" ? "zai-second" : "zai-first";
		resetByKey.set(first, nowMs + 24 * HOUR_MS);
		resetByKey.set(second, nowMs + HOUR_MS);

		expect(await authStorage.markUsageLimitReached("zai", sessionId)).toBe(true);
		expect(await authStorage.getApiKey("zai", sessionId)).toBe(second);
		expect(await authStorage.markUsageLimitReached("zai", sessionId)).toBe(false);

		nowMs += 2 * HOUR_MS;
		expect(await authStorage.getApiKey("zai", sessionId)).toBe(second);
	});
});
