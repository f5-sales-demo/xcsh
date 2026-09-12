import { type AuthStorage, refreshOAuthToken } from "@f5-sales-demo/pi-ai";
import { getCodexAccountId } from "@f5-sales-demo/pi-ai/providers/openai-codex/constants";
import { RemoteControlError, type SubscriptionAuth } from "./enrollment";

/** Derive the account from the selected/refreshed token, never from a different stored entry. */
export async function loadRemoteSubscription(
	storage: Pick<AuthStorage, "getCredentialSource" | "getApiKey">,
	sessionId: string,
): Promise<SubscriptionAuth> {
	if (storage.getCredentialSource("openai-codex") !== "stored-oauth") {
		throw new RemoteControlError("Remote enrollment requires a selected xcsh ChatGPT subscription", {
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

/** Recover exactly the observed subscription row under the existing fenced refresh broker. */
export async function recoverRemoteSubscription(
	storage: Pick<
		AuthStorage,
		"getCredentialSource" | "getApiKey" | "reload" | "listStoredCredentials" | "refreshStoredOAuthCredential"
	>,
	sessionId: string,
	previous: SubscriptionAuth,
): Promise<SubscriptionAuth> {
	try {
		await storage.reload();
		const selected = storage
			.listStoredCredentials("openai-codex")
			.find(row => row.credential.type === "oauth" && row.credential.access === previous.accessToken);
		if (selected?.credential.type === "oauth") {
			await storage.refreshStoredOAuthCredential("openai-codex", {
				credentialId: selected.id,
				observedCredential: selected.credential,
				credentialFromRow: credential =>
					getCodexAccountId(credential.access) === previous.accountId ? credential : undefined,
				forceRefresh: true,
				keepCredentialOnRefreshFailure: true,
				refresh: (credential, signal) => refreshOAuthToken("openai-codex", credential, signal),
			});
			await storage.reload();
		}
		const current = await loadRemoteSubscription(storage, sessionId);
		if (current.accountId !== previous.accountId || current.accessToken === previous.accessToken) throw new Error();
		return current;
	} catch {
		throw new Error("ChatGPT subscription recovery unavailable");
	}
}
