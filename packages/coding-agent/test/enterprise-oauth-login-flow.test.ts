import { describe, expect, it, vi } from "bun:test";
import {
	type EnterpriseOAuthRecoveryAction,
	runEnterpriseOAuthLoginFlow,
} from "../src/modes/controllers/enterprise-oauth-login-flow";

const SNAPSHOT = { credential: "previous", model: "previous-model" };

describe("runEnterpriseOAuthLoginFlow", () => {
	it("retries transient authentication twice with rollback before succeeding", async () => {
		const authenticate = vi
			.fn<(action: "initial" | EnterpriseOAuthRecoveryAction) => Promise<void>>()
			.mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
			.mockRejectedValueOnce(new Error("HTTP 503 unavailable"))
			.mockResolvedValueOnce();
		const restore = vi.fn(async () => {});
		const sleep = vi.fn(async () => {});
		const recover = vi.fn(async (): Promise<EnterpriseOAuthRecoveryAction> => "cancel");

		const result = await runEnterpriseOAuthLoginFlow({
			capture: () => SNAPSHOT,
			authenticate,
			applyModel: async () => true,
			restore,
			recover,
			sleep,
		});

		expect(result).toEqual({ status: "completed" });
		expect(authenticate.mock.calls.map(call => call[0])).toEqual(["initial", "retry", "retry"]);
		expect(restore).toHaveBeenCalledTimes(2);
		expect(restore).toHaveBeenNthCalledWith(1, SNAPSHOT);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(recover).not.toHaveBeenCalled();
	});

	it("offers edit immediately for an enterprise policy failure", async () => {
		const authenticate = vi
			.fn<(action: "initial" | EnterpriseOAuthRecoveryAction) => Promise<void>>()
			.mockRejectedValueOnce(new Error("standard-tier is not available"))
			.mockResolvedValueOnce();
		const recover = vi.fn(async (): Promise<EnterpriseOAuthRecoveryAction> => "edit");

		const result = await runEnterpriseOAuthLoginFlow({
			capture: () => SNAPSHOT,
			authenticate,
			applyModel: async () => true,
			restore: async () => {},
			recover,
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "completed" });
		expect(authenticate.mock.calls.map(call => call[0])).toEqual(["initial", "edit"]);
		expect(recover).toHaveBeenCalledWith({
			stage: "authenticate",
			error: "standard-tier is not available",
			canEdit: true,
		});
	});

	it("restores state and retries when the Gemini profile cannot be applied", async () => {
		const applyModel = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const restore = vi.fn(async () => {});
		const recover = vi.fn(async (): Promise<EnterpriseOAuthRecoveryAction> => "retry");

		const result = await runEnterpriseOAuthLoginFlow({
			capture: () => SNAPSHOT,
			authenticate: async () => {},
			applyModel,
			restore,
			recover,
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "completed" });
		expect(restore).toHaveBeenCalledWith(SNAPSHOT);
		expect(recover).toHaveBeenCalledWith({
			stage: "apply",
			error: "Gemini 3.6 Flash High is unavailable after authentication",
			canEdit: true,
		});
	});

	it("treats browser cancellation as cancellation after restoring state", async () => {
		const cancellation = new Error("Login cancelled");
		cancellation.name = "AbortError";
		const restore = vi.fn(async () => {});
		const recover = vi.fn(async (): Promise<EnterpriseOAuthRecoveryAction> => "retry");

		const result = await runEnterpriseOAuthLoginFlow({
			capture: () => SNAPSHOT,
			authenticate: async () => {
				throw cancellation;
			},
			applyModel: async () => true,
			restore,
			recover,
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(restore).toHaveBeenCalledWith(SNAPSHOT);
		expect(recover).not.toHaveBeenCalled();
	});

	it("returns cancellation from recovery without retaining the failed login", async () => {
		const restore = vi.fn(async () => {});
		const result = await runEnterpriseOAuthLoginFlow({
			capture: () => SNAPSHOT,
			authenticate: async () => {
				throw new Error("standard-tier is not available");
			},
			applyModel: async () => true,
			restore,
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(restore).toHaveBeenCalledWith(SNAPSHOT);
	});

	it("fails closed when rollback itself is incomplete", async () => {
		await expect(
			runEnterpriseOAuthLoginFlow({
				capture: () => SNAPSHOT,
				authenticate: async () => {
					throw new Error("standard-tier is not available");
				},
				applyModel: async () => true,
				restore: async () => {
					throw new Error("credential restore failed");
				},
				recover: async () => "retry",
				sleep: async () => {},
			}),
		).rejects.toThrow("Enterprise login failed and rollback was incomplete");
	});
});
