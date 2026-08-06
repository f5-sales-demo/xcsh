export type EnterpriseOAuthRecoveryAction = "retry" | "edit" | "cancel";
export type EnterpriseOAuthLoginAction = "initial" | EnterpriseOAuthRecoveryAction;
export type EnterpriseOAuthLoginStage = "authenticate" | "apply";

export interface EnterpriseOAuthRecoveryRequest {
	stage: EnterpriseOAuthLoginStage;
	error: string;
	canEdit: true;
}

export type EnterpriseOAuthLoginResult = { status: "completed" } | { status: "cancelled" };

interface EnterpriseOAuthLoginFlowOptions<TSnapshot> {
	capture(): Promise<TSnapshot> | TSnapshot;
	authenticate(action: EnterpriseOAuthLoginAction): Promise<void>;
	applyModel(): Promise<boolean>;
	restore(snapshot: TSnapshot): Promise<void>;
	recover(request: EnterpriseOAuthRecoveryRequest): Promise<EnterpriseOAuthRecoveryAction>;
	sleep?(milliseconds: number): Promise<void>;
	maxAutomaticRetries?: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isCancellation(error: unknown): boolean {
	return (
		(error instanceof Error && error.name === "AbortError") ||
		/\b(login |authentication )?cancelled\b/i.test(errorMessage(error))
	);
}

function isTransientAuthenticationError(error: unknown): boolean {
	return /\b(fetch|network|timeout|timed out|ECONN(?:RESET|REFUSED)|EAI_AGAIN|429|5\d\d)\b/i.test(errorMessage(error));
}

async function restoreOrThrow<TSnapshot>(
	options: EnterpriseOAuthLoginFlowOptions<TSnapshot>,
	snapshot: TSnapshot,
	originalError: unknown,
): Promise<void> {
	try {
		await options.restore(snapshot);
	} catch (rollbackError) {
		throw new AggregateError([originalError, rollbackError], "Enterprise login failed and rollback was incomplete");
	}
}

/** Coordinate enterprise OAuth, model application, bounded retries, and rollback. */
export async function runEnterpriseOAuthLoginFlow<TSnapshot>(
	options: EnterpriseOAuthLoginFlowOptions<TSnapshot>,
): Promise<EnterpriseOAuthLoginResult> {
	const snapshot = await options.capture();
	const sleep = options.sleep ?? Bun.sleep;
	const maxAutomaticRetries = options.maxAutomaticRetries ?? 2;
	let action: EnterpriseOAuthLoginAction = "initial";
	let automaticRetries = 0;

	while (true) {
		let stage: EnterpriseOAuthLoginStage = "authenticate";
		try {
			await options.authenticate(action);
			stage = "apply";
			if (!(await options.applyModel())) {
				throw new Error("Gemini 3.6 Flash High is unavailable after authentication");
			}
			return { status: "completed" };
		} catch (error) {
			await restoreOrThrow(options, snapshot, error);
			if (isCancellation(error)) return { status: "cancelled" };

			if (
				stage === "authenticate" &&
				isTransientAuthenticationError(error) &&
				automaticRetries < maxAutomaticRetries
			) {
				await sleep(250 * 2 ** automaticRetries);
				automaticRetries += 1;
				action = "retry";
				continue;
			}

			const recoveryAction = await options.recover({
				stage,
				error: errorMessage(error),
				canEdit: true,
			});
			if (recoveryAction === "cancel") return { status: "cancelled" };
			action = recoveryAction;
			automaticRetries = 0;
		}
	}
}
