import { getProviderReleaseLookup, type ProviderReleaseMetadata } from "./provider-release";

export function classifyTerraformPreflight(text: string, previousTerraform: boolean): boolean {
	if (/\b(?:terraform|hcl)\b|\b[\w.-]+\.tf\b|xcsh:\/\/terraform-documentation\//i.test(text)) return true;
	if (!previousTerraform) return false;
	if (/\b(?:poem|time|weather|api|json|unrelated|new topic)\b/i.test(text)) return false;
	return /\b(?:it|its|that|this|same|those|them|also|continue|yes|no|files?|variables?|outputs?|provider|version|lock|validate|format|init|schema|constraint|pin|keep|retain)\b/i.test(
		text,
	);
}

export interface TerraformPreflightOptions {
	readonly previousTerraform: boolean;
	readonly signal?: AbortSignal;
}

export async function runTerraformPreflight(
	text: string,
	options: TerraformPreflightOptions,
): Promise<ProviderReleaseMetadata | null> {
	if (!classifyTerraformPreflight(text, options.previousTerraform)) return null;
	return getProviderReleaseLookup().refresh(options.signal);
}
