import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";
import * as antigravityModule from "../src/utils/oauth/google-antigravity";

const CREDENTIALS = {
	refresh: "refresh-token",
	access: "access-token",
	expires: Date.now() + 60_000,
	projectId: "enterprise-project",
	tierId: "standard-tier",
	email: "developer@example.test",
};

describe("AuthStorage Antigravity enterprise alias", () => {
	let temporaryDirectory = "";
	let store: AuthCredentialStore | undefined;
	let authStorage: AuthStorage | undefined;

	beforeEach(async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-antigravity-enterprise-"));
		store = await AuthCredentialStore.open(path.join(temporaryDirectory, "agent.db"));
		authStorage = new AuthStorage(store);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = undefined;
		authStorage = undefined;
		if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
	});

	it("persists enterprise login under the canonical provider without duplicates", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");
		const login = vi.spyOn(antigravityModule, "loginAntigravity").mockResolvedValue(CREDENTIALS);
		const callbacks = { onAuth: () => {}, onPrompt: async () => "enterprise-project" };

		await authStorage.login("google-antigravity-enterprise", callbacks);
		await authStorage.login("google-antigravity-enterprise", callbacks);

		expect(login).toHaveBeenCalledTimes(2);
		expect(login.mock.calls[0]?.[1]).toMatchObject({
			enterpriseRequired: true,
			projectSources: { environment: {} },
		});
		expect(store.listAuthCredentials("google-antigravity")).toHaveLength(1);
		expect(store.listAuthCredentials("google-antigravity")[0]?.credential).toMatchObject({
			type: "oauth",
			projectId: "enterprise-project",
			tierId: "standard-tier",
		});
		expect(store.listAuthCredentials("google-antigravity-enterprise")).toHaveLength(0);
		expect(authStorage.list()).toEqual(["google-antigravity"]);
		expect(authStorage.get("google-antigravity-enterprise")).toEqual({ type: "oauth", ...CREDENTIALS });
		expect(authStorage.hasAuth("google-antigravity-enterprise")).toBe(true);
		expect(authStorage.hasOAuth("google-antigravity-enterprise")).toBe(true);

		const reopened = await AuthStorage.create(path.join(temporaryDirectory, "agent.db"));
		try {
			await reopened.reload();
			expect(reopened.get("google-antigravity")).toMatchObject({
				type: "oauth",
				projectId: "enterprise-project",
				tierId: "standard-tier",
			});
		} finally {
			reopened.close();
		}
	});

	it("logs out the canonical credential through the enterprise alias", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");
		vi.spyOn(antigravityModule, "loginAntigravity").mockResolvedValue(CREDENTIALS);
		await authStorage.login("google-antigravity-enterprise", {
			onAuth: () => {},
			onPrompt: async () => "enterprise-project",
		});

		await authStorage.logout("google-antigravity-enterprise");

		expect(store.listAuthCredentials("google-antigravity")).toHaveLength(0);
		expect(authStorage.hasAuth("google-antigravity")).toBe(false);
		expect(authStorage.hasAuth("google-antigravity-enterprise")).toBe(false);
	});
});
