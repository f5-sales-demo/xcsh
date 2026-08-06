import { describe, expect, it, vi } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";
import {
	captureEnterpriseOAuthLoginState,
	restoreEnterpriseOAuthLoginState,
} from "../src/modes/controllers/enterprise-oauth-login-transaction";

const PREVIOUS_CREDENTIAL = {
	type: "oauth" as const,
	refresh: "previous-refresh",
	access: "previous-access",
	expires: 123,
	projectId: "previous-project",
};

function createSession(previousCredential: typeof PREVIOUS_CREDENTIAL | null = PREVIOUS_CREDENTIAL) {
	const previousModel = { provider: "litellm", id: "gpt-5.6-sol" } as Model;
	let credential = previousCredential ?? undefined;
	let modelRoles = { default: "litellm/gpt-5.6-sol:medium", smol: "other/smol" };
	const authStorage = {
		get: vi.fn(() => credential),
		set: vi.fn(async (_provider: string, value: typeof PREVIOUS_CREDENTIAL) => {
			credential = value;
		}),
		remove: vi.fn(async () => {
			credential = undefined;
		}),
	};
	const refresh = vi.fn(async () => {});
	const setModelTemporary = vi.fn(async () => {});
	const setThinkingLevel = vi.fn();
	const settings = {
		getModelRoles: vi.fn(() => modelRoles),
		set: vi.fn((_key: "modelRoles", value: Record<string, string>) => {
			modelRoles = value as typeof modelRoles;
		}),
	};
	return {
		previousModel,
		authStorage,
		refresh,
		setModelTemporary,
		setThinkingLevel,
		settings,
		getCredential: () => credential,
		getModelRoles: () => modelRoles,
		session: {
			model: previousModel,
			thinkingLevel: ThinkingLevel.Medium,
			modelRegistry: { authStorage, refresh },
			settings,
			setModelTemporary,
			setThinkingLevel,
		},
	};
}

describe("enterprise OAuth login transaction state", () => {
	it("captures and restores the canonical credential, persisted model roles, and active model", async () => {
		const state = createSession();
		const snapshot = captureEnterpriseOAuthLoginState(state.session);
		await state.authStorage.set("google-antigravity", {
			...PREVIOUS_CREDENTIAL,
			access: "new-access",
			projectId: "new-project",
		});
		state.settings.set("modelRoles", { default: "google-antigravity/gemini-3.6-flash-high:high" });

		await restoreEnterpriseOAuthLoginState(state.session, snapshot);

		expect(state.getCredential()).toEqual(PREVIOUS_CREDENTIAL);
		expect(state.authStorage.set).toHaveBeenLastCalledWith("google-antigravity", PREVIOUS_CREDENTIAL);
		expect(state.getModelRoles()).toEqual({ default: "litellm/gpt-5.6-sol:medium", smol: "other/smol" });
		expect(state.refresh).toHaveBeenCalledWith("online");
		expect(state.setModelTemporary).toHaveBeenCalledWith(state.previousModel, ThinkingLevel.Medium);
	});

	it("removes a newly-created credential when there was no prior enterprise login", async () => {
		const state = createSession(null);
		const snapshot = captureEnterpriseOAuthLoginState(state.session);
		await state.authStorage.set("google-antigravity", PREVIOUS_CREDENTIAL);

		await restoreEnterpriseOAuthLoginState(state.session, snapshot);

		expect(state.getCredential()).toBeUndefined();
		expect(state.authStorage.remove).toHaveBeenCalledWith("google-antigravity");
	});

	it("reports all rollback failures instead of claiming state was restored", async () => {
		const state = createSession();
		const snapshot = captureEnterpriseOAuthLoginState(state.session);
		state.authStorage.set.mockRejectedValueOnce(new Error("credential restore failed"));
		state.settings.set.mockImplementationOnce(() => {
			throw new Error("settings restore failed");
		});

		await expect(restoreEnterpriseOAuthLoginState(state.session, snapshot)).rejects.toThrow(
			"Enterprise OAuth rollback was incomplete",
		);
		expect(state.refresh).toHaveBeenCalledWith("online");
	});
});
