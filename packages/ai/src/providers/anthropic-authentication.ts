import type { ClientOptions } from "@anthropic-ai/sdk";
import { $env } from "@f5-sales-demo/pi-utils";
import type { Model } from "../types";

export type AnthropicAuthentication = Pick<ClientOptions, "authToken" | "credentials" | "config" | "profile">;

/** Explicit credentials override ambient credentials. Let the SDK exchange and cache federation tokens. */
export function resolveAnthropicAuthentication(
	model: Model<"anthropic-messages">,
	explicit?: AnthropicAuthentication,
	apiKey?: string,
): AnthropicAuthentication | undefined {
	if (explicit) {
		const methods = Object.entries(explicit).filter(([, value]) => value != null);
		if (methods.length !== 1) throw new Error("Anthropic authentication requires exactly one credential method");
		return explicit;
	}
	if (model.provider !== "anthropic" || apiKey) return undefined;
	if ($env.ANTHROPIC_AUTH_TOKEN) return { authToken: $env.ANTHROPIC_AUTH_TOKEN };
	if ($env.ANTHROPIC_PROFILE) return { profile: $env.ANTHROPIC_PROFILE };
	const organizationId = $env.ANTHROPIC_ORGANIZATION_ID;
	const federationRuleId = $env.ANTHROPIC_FEDERATION_RULE_ID;
	const identityTokenFile = $env.ANTHROPIC_IDENTITY_TOKEN_FILE;
	if (!organizationId || !federationRuleId || !identityTokenFile) return undefined;
	return {
		config: {
			organization_id: organizationId,
			workspace_id: $env.ANTHROPIC_WORKSPACE_ID,
			authentication: {
				type: "oidc_federation",
				federation_rule_id: federationRuleId,
				service_account_id: $env.ANTHROPIC_SERVICE_ACCOUNT_ID,
				identity_token: { source: "file", path: identityTokenFile },
			},
		},
	};
}
