import type { AuthStorage } from "@f5-sales-demo/pi-ai";
import { getCodexAccountId } from "@f5-sales-demo/pi-ai/providers/openai-codex/constants";
import { RemoteControlError, type SubscriptionAuth } from "./enrollment";

/** Derive the account from the selected/refreshed token, never from a different stored entry. */
export async function loadRemoteSubscription(
	storage: Pick<AuthStorage, "getCredentialSource" | "getApiKey">,
	sessionId: string,
): Promise<SubscriptionAuth> {
	if (storage.getCredentialSource("openai-codex") !== "stored-oauth") {
		throw new RemoteControlError("Remote enrollment requires a selected XCSH ChatGPT subscription", {
			stage: "enrollment",
		});
	}
	let accessToken: string | undefined;
	try {
		accessToken = await storage.getApiKey("openai-codex", sessionId);
	} catch {
		throw new RemoteControlError("ChatGPT subscription credential unavailable", { stage: "enrollment" });
	}
	const accountId = accessToken && getCodexAccountId(accessToken);
	if (!accessToken || typeof accountId !== "string" || !accountId) {
		throw new RemoteControlError("ChatGPT subscription account unavailable", { stage: "enrollment" });
	}
	return { accessToken, accountId };
}
