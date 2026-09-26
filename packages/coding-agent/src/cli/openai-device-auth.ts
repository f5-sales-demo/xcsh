import { AuthCredentialStore } from "@f5-sales-demo/pi-ai/auth-storage";
import { loginOpenAICodex, type OpenAICodexLoginOptions } from "@f5-sales-demo/pi-ai/utils/oauth/openai-codex";
import type { OAuthAuthInfo, OAuthCredentials, OAuthPrompt } from "@f5-sales-demo/pi-ai/utils/oauth/types";

type CredentialStore = Pick<AuthCredentialStore, "close" | "saveOAuth">;

export type OpenAIDeviceAuthDependencies = {
	openStore?: () => Promise<CredentialStore>;
	login?: (options: OpenAICodexLoginOptions) => Promise<OAuthCredentials>;
	onAuth?: (info: OAuthAuthInfo) => void;
	onProgress?: (message: string) => void;
	onPrompt?: (prompt: OAuthPrompt) => Promise<string>;
};

function reportAuth(info: OAuthAuthInfo): void {
	if (info.kind === "device" && info.userCode) {
		process.stdout.write(`Open ${info.url} and enter the one-time code: ${info.userCode}\n`);
		return;
	}
	process.stdout.write(`Open this URL in your browser:\n${info.url}\n`);
}

/** Run the ChatGPT device-code flow without starting a local callback listener. */
export async function runOpenAIDeviceAuthLogin(dependencies: OpenAIDeviceAuthDependencies = {}): Promise<void> {
	const store = await (dependencies.openStore ?? (() => AuthCredentialStore.open()))();
	try {
		const credentials = await (dependencies.login ?? loginOpenAICodex)({
			method: "device",
			onAuth: dependencies.onAuth ?? reportAuth,
			onProgress: dependencies.onProgress ?? (message => process.stdout.write(`${message}\n`)),
			onPrompt: dependencies.onPrompt,
		});
		store.saveOAuth("openai-codex", credentials);
		process.stdout.write("ChatGPT credentials saved.\n");
	} finally {
		store.close();
	}
}
