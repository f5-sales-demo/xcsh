import type { VllmProbeResult } from "../../config/vllm-config";
import { getVllmLoginModelChoices, type LoginModelChoice } from "./login-model";

export interface VllmLoginCredentials {
	baseUrl: string;
	apiKey: string;
}

export type LoginRecoveryAction = "retry" | "edit" | "cancel";
export type VllmLoginStage = "probe" | "commit";

export interface VllmLoginRecoveryRequest {
	stage: VllmLoginStage;
	error: string;
	canEdit: boolean;
}

export interface VllmLoginCommit {
	credentials: VllmLoginCredentials;
	probe: VllmProbeResult;
	choice: LoginModelChoice;
}

export type VllmLoginFlowResult = { status: "completed"; choice: LoginModelChoice } | { status: "cancelled" };

interface VllmLoginFlowOptions {
	collectCredentials(): Promise<VllmLoginCredentials | null>;
	probe(credentials: VllmLoginCredentials): Promise<VllmProbeResult>;
	selectModel(choices: readonly LoginModelChoice[]): Promise<LoginModelChoice | null>;
	commit(input: VllmLoginCommit): Promise<void>;
	recover(request: VllmLoginRecoveryRequest): Promise<LoginRecoveryAction>;
	sleep?(milliseconds: number): Promise<void>;
	maxAutomaticRetries?: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAuthenticationError(message: string): boolean {
	return /\b(401|403|Unauthorized|Forbidden|API key)\b/i.test(message);
}

export async function runVllmLoginFlow(options: VllmLoginFlowOptions): Promise<VllmLoginFlowResult> {
	const sleep = options.sleep ?? Bun.sleep;
	const maxAutomaticRetries = options.maxAutomaticRetries ?? 2;

	credentialsLoop: while (true) {
		const credentials = await options.collectCredentials();
		if (!credentials) return { status: "cancelled" };

		let probe: VllmProbeResult;
		let automaticRetries = 0;
		while (true) {
			try {
				probe = await options.probe(credentials);
				break;
			} catch (error) {
				const message = errorMessage(error);
				if (!isAuthenticationError(message) && automaticRetries < maxAutomaticRetries) {
					await sleep(250 * 2 ** automaticRetries);
					automaticRetries += 1;
					continue;
				}
				const action = await options.recover({ stage: "probe", error: message, canEdit: true });
				if (action === "cancel") return { status: "cancelled" };
				if (action === "edit") continue credentialsLoop;
				automaticRetries = 0;
			}
		}

		const choices = getVllmLoginModelChoices(probe.models);
		const choice = choices.length === 1 ? choices[0] : await options.selectModel(choices);
		if (!choice) return { status: "cancelled" };

		while (true) {
			try {
				await options.commit({ credentials, probe, choice });
				return { status: "completed", choice };
			} catch (error) {
				const action = await options.recover({ stage: "commit", error: errorMessage(error), canEdit: true });
				if (action === "cancel") return { status: "cancelled" };
				if (action === "edit") continue credentialsLoop;
			}
		}
	}
}
