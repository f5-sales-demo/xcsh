import { describe, expect, it, vi } from "bun:test";
import type { VllmProbeResult } from "../src/config/vllm-config";
import {
	type LoginRecoveryAction,
	runVllmLoginFlow,
	type VllmLoginCredentials,
} from "../src/modes/controllers/vllm-login-flow";

const CREDENTIALS: VllmLoginCredentials = { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "" };
const ONE_MODEL: VllmProbeResult = { models: [{ id: "local-tool-model", contextWindow: 32_768 }] };

describe("runVllmLoginFlow", () => {
	it("auto-selects one discovered model without opening the chooser", async () => {
		const selectModel = vi.fn(async () => null);
		const commit = vi.fn(async () => {});
		const result = await runVllmLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe: async () => ONE_MODEL,
			selectModel,
			commit,
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(result).toMatchObject({ status: "completed", choice: { provider: "vllm", modelId: "local-tool-model" } });
		expect(selectModel).not.toHaveBeenCalled();
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it("uses a vLLM-only chooser for multiple discovered models", async () => {
		const selectModel = vi.fn(async choices => choices[1] ?? null);
		const result = await runVllmLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe: async () => ({ models: [{ id: "first" }, { id: "second" }] }),
			selectModel,
			commit: async () => {},
			recover: async () => "cancel",
			sleep: async () => {},
		});

		expect(selectModel.mock.calls[0]?.[0].map((choice: { modelId: string }) => choice.modelId)).toEqual([
			"first",
			"second",
		]);
		expect(result).toMatchObject({ status: "completed", choice: { provider: "vllm", modelId: "second" } });
	});

	it("retries transient probes before offering edit and recollecting credentials", async () => {
		const edited = { baseUrl: "https://vllm.example.test/v1", apiKey: "correct" };
		const collectCredentials = vi
			.fn<() => Promise<VllmLoginCredentials | null>>()
			.mockResolvedValueOnce(CREDENTIALS)
			.mockResolvedValueOnce(edited);
		const probe = vi
			.fn<(credentials: VllmLoginCredentials) => Promise<VllmProbeResult>>()
			.mockRejectedValueOnce(new Error("network reset"))
			.mockRejectedValueOnce(new Error("network reset"))
			.mockRejectedValueOnce(new Error("vLLM rejected the API key (HTTP 401)"))
			.mockResolvedValueOnce(ONE_MODEL);
		const recover = vi.fn(async (): Promise<LoginRecoveryAction> => "edit");

		const result = await runVllmLoginFlow({
			collectCredentials,
			probe,
			selectModel: async choices => choices[0] ?? null,
			commit: async () => {},
			recover,
			sleep: async () => {},
		});

		expect(result.status).toBe("completed");
		expect(collectCredentials).toHaveBeenCalledTimes(2);
		expect(probe.mock.calls[3]).toEqual([edited]);
		expect(recover).toHaveBeenCalledWith(expect.objectContaining({ stage: "probe", canEdit: true }));
	});

	it("rolls no state forward when the user cancels", async () => {
		const commit = vi.fn(async () => {});
		const result = await runVllmLoginFlow({
			collectCredentials: async () => CREDENTIALS,
			probe: async () => {
				throw new Error("vLLM connection failed");
			},
			selectModel: async choices => choices[0] ?? null,
			commit,
			recover: async () => "cancel",
			sleep: async () => {},
			maxAutomaticRetries: 0,
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(commit).not.toHaveBeenCalled();
	});
});
