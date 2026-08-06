import { describe, expect, it, vi } from "bun:test";
import type { ProbeResult } from "../src/config/auto-config";
import {
	type LiteLLMLoginCredentials,
	type LoginRecoveryAction,
	runLiteLLMLoginFlow,
} from "../src/modes/controllers/litellm-login-flow";
import { LITELLM_LOGIN_MODEL_CHOICES } from "../src/modes/controllers/login-model";

const CREDENTIALS: LiteLLMLoginCredentials = {
	baseUrl: "https://litellm.example.test",
	apiKey: "sk-test",
};
const GPT = LITELLM_LOGIN_MODEL_CHOICES.find(choice => choice.modelId === "gpt-5.6-sol")!;
const SUCCESS: ProbeResult = {
	reachable: true,
	models: ["claude-opus-5", "unrelated", "gpt-5.6-sol"],
	apiBasePath: "/v1",
};

describe("runLiteLLMLoginFlow", () => {
	it("discovers, selects, and commits one certified model in deterministic order", async () => {
		const calls: string[] = [];
		const selectModel = vi.fn(async choices => {
			calls.push("select");
			expect(choices).toEqual([GPT, LITELLM_LOGIN_MODEL_CHOICES[1]]);
			return choices[0] ?? null;
		});
		const commit = vi.fn(async () => {
			calls.push("commit");
		});

		const result = await runLiteLLMLoginFlow({
			collectCredentials: async () => {
				calls.push("collect");
				return CREDENTIALS;
			},
			probe: async () => {
				calls.push("probe");
				return SUCCESS;
			},
			selectModel,
			commit,
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "completed", choice: GPT });
		expect(calls).toEqual(["collect", "probe", "select", "commit"]);
		expect(commit).toHaveBeenCalledWith({ credentials: CREDENTIALS, probe: SUCCESS, choice: GPT });
	});

	it("performs no commit when model selection is cancelled", async () => {
		const commit = vi.fn(async () => {});
		const result = await runLiteLLMLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe: async () => SUCCESS,
			selectModel: async () => null,
			commit,
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(commit).not.toHaveBeenCalled();
	});

	it("retries transient discovery twice before asking for recovery", async () => {
		const probe = vi
			.fn<(credentials: LiteLLMLoginCredentials) => Promise<ProbeResult>>()
			.mockResolvedValueOnce({ reachable: false, models: [], error: "network reset" })
			.mockResolvedValueOnce({ reachable: false, models: [], error: "gateway timeout" })
			.mockResolvedValueOnce(SUCCESS);
		const recover = vi.fn(async (): Promise<LoginRecoveryAction> => "cancel");
		const sleep = vi.fn(async () => {});

		const result = await runLiteLLMLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe,
			selectModel: async choices => choices[0] ?? null,
			commit: async () => {},
			recover,
			sleep,
		});

		expect(result.status).toBe("completed");
		expect(probe).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(recover).not.toHaveBeenCalled();
	});

	it("offers retry after automatic attempts are exhausted", async () => {
		const probe = vi
			.fn<(credentials: LiteLLMLoginCredentials) => Promise<ProbeResult>>()
			.mockResolvedValueOnce({ reachable: false, models: [], error: "network reset" })
			.mockResolvedValueOnce({ reachable: false, models: [], error: "network reset" })
			.mockResolvedValueOnce({ reachable: false, models: [], error: "network reset" })
			.mockResolvedValueOnce(SUCCESS);
		const recover = vi.fn(async (): Promise<LoginRecoveryAction> => "retry");

		const result = await runLiteLLMLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe,
			selectModel: async choices => choices[0] ?? null,
			commit: async () => {},
			recover,
			sleep: async () => {},
		});

		expect(result.status).toBe("completed");
		expect(recover).toHaveBeenCalledWith(expect.objectContaining({ stage: "probe", canEdit: true }));
		expect(probe).toHaveBeenCalledTimes(4);
	});

	it("edits credentials immediately after an authentication failure", async () => {
		const edited = { baseUrl: CREDENTIALS.baseUrl, apiKey: "sk-corrected" };
		const collectCredentials = vi
			.fn<() => Promise<LiteLLMLoginCredentials | null>>()
			.mockResolvedValueOnce(CREDENTIALS)
			.mockResolvedValueOnce(edited);
		const probe = vi
			.fn<(credentials: LiteLLMLoginCredentials) => Promise<ProbeResult>>()
			.mockResolvedValueOnce({ reachable: false, models: [], error: "HTTP 401 Unauthorized" })
			.mockResolvedValueOnce(SUCCESS);
		const recover = vi.fn(async (): Promise<LoginRecoveryAction> => "edit");

		const result = await runLiteLLMLoginFlow({
			collectCredentials,
			probe,
			selectModel: async choices => choices[0] ?? null,
			commit: async () => {},
			recover,
			sleep: async () => {},
		});

		expect(result.status).toBe("completed");
		expect(collectCredentials).toHaveBeenCalledTimes(2);
		expect(probe.mock.calls[1]).toEqual([edited]);
		expect(recover).toHaveBeenCalledTimes(1);
	});

	it("returns cancellation after exhausted retries without persisting", async () => {
		const commit = vi.fn(async () => {});
		const result = await runLiteLLMLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe: async () => ({ reachable: false, models: [], error: "network reset" }),
			selectModel: async choices => choices[0] ?? null,
			commit,
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(commit).not.toHaveBeenCalled();
	});
});
