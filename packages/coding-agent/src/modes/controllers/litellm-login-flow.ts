import type { ProbeResult } from "../../config/auto-config";
import { getAvailableLiteLLMLoginModelChoices, type LiteLLMLoginModelChoice } from "./login-model";

export interface LiteLLMLoginCredentials {
	baseUrl: string;
	apiKey: string;
}

export type LoginRecoveryAction = "retry" | "edit" | "cancel";
export type LiteLLMLoginStage = "probe" | "models" | "commit";

export interface LoginRecoveryRequest {
	stage: LiteLLMLoginStage;
	error: string;
	canEdit: boolean;
}

export interface LiteLLMLoginCommit {
	credentials: LiteLLMLoginCredentials;
	probe: ProbeResult;
	choice: LiteLLMLoginModelChoice;
}

export type LiteLLMLoginFlowResult = { status: "completed"; choice: LiteLLMLoginModelChoice } | { status: "cancelled" };

interface LiteLLMLoginFlowOptions {
	collectCredentials(): Promise<LiteLLMLoginCredentials | null>;
	probe(credentials: LiteLLMLoginCredentials): Promise<ProbeResult>;
	selectModel(choices: readonly LiteLLMLoginModelChoice[]): Promise<LiteLLMLoginModelChoice | null>;
	commit(input: LiteLLMLoginCommit): Promise<void>;
	recover(request: LoginRecoveryRequest): Promise<LoginRecoveryAction>;
	sleep?(milliseconds: number): Promise<void>;
	maxAutomaticRetries?: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAuthenticationError(message: string): boolean {
	return /\b(401|403|Unauthorized|Forbidden)\b/i.test(message);
}

/**
 * Coordinate LiteLLM discovery and selection without persisting anything until
 * the user has selected one of the certified models.
 */
export async function runLiteLLMLoginFlow(options: LiteLLMLoginFlowOptions): Promise<LiteLLMLoginFlowResult> {
	const sleep = options.sleep ?? Bun.sleep;
	const maxAutomaticRetries = options.maxAutomaticRetries ?? 2;

	credentialsLoop: while (true) {
		const credentials = await options.collectCredentials();
		if (!credentials) return { status: "cancelled" };

		let probe: ProbeResult;
		let automaticRetries = 0;
		while (true) {
			try {
				probe = await options.probe(credentials);
			} catch (error) {
				probe = { reachable: false, models: [], error: errorMessage(error) };
			}

			if (probe.reachable) break;
			const error = probe.error ?? "connection failed";
			if (!isAuthenticationError(error) && automaticRetries < maxAutomaticRetries) {
				await sleep(250 * 2 ** automaticRetries);
				automaticRetries += 1;
				continue;
			}

			const action = await options.recover({ stage: "probe", error, canEdit: true });
			if (action === "cancel") return { status: "cancelled" };
			if (action === "edit") continue credentialsLoop;
			automaticRetries = 0;
		}

		const choices = getAvailableLiteLLMLoginModelChoices(probe.models);
		if (choices.length === 0) {
			const action = await options.recover({
				stage: "models",
				error: "Neither GPT-5.6 Sol nor Claude Opus 5 is available from this proxy.",
				canEdit: true,
			});
			if (action === "cancel") return { status: "cancelled" };
			if (action === "edit") continue;
			continue;
		}

		const choice = await options.selectModel(choices);
		if (!choice) return { status: "cancelled" };

		while (true) {
			try {
				await options.commit({ credentials, probe, choice });
				return { status: "completed", choice };
			} catch (error) {
				const action = await options.recover({
					stage: "commit",
					error: errorMessage(error),
					canEdit: true,
				});
				if (action === "cancel") return { status: "cancelled" };
				if (action === "edit") continue credentialsLoop;
			}
		}
	}
}
