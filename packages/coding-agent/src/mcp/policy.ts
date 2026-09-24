import { CliUsageError } from "@f5-sales-demo/pi-utils/cli";

export interface CliMCPPolicyInput {
	mcp?: boolean;
	noMcp?: boolean;
	noTools?: boolean;
	userEnabled: boolean;
}

export function resolveCliMCPEnabled(input: CliMCPPolicyInput): boolean {
	if (input.mcp && input.noMcp) throw new CliUsageError("--mcp cannot be combined with --no-mcp");
	if (input.mcp && input.noTools) throw new CliUsageError("--mcp cannot be combined with --no-tools");
	if (input.noMcp || input.noTools) return false;
	if (input.mcp) return true;
	return input.userEnabled;
}

export function resolveSDKMCPEnabled(enableMCP: boolean | undefined): boolean {
	return enableMCP === true;
}

export function resolveACPMCPEnabled(servers: readonly unknown[] | undefined): boolean {
	return (servers?.length ?? 0) > 0;
}
