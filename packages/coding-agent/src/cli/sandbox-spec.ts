import { Args, CliUsageError, Flags } from "@f5-sales-demo/pi-utils/cli";
import { findCommandLaunchFlags, launchFlagScopeMessage } from "./root-command-routing";

export const sandboxArgs = {
	action: Args.string({
		description: "Sandbox action",
		required: true,
		options: ["check"],
	}),
};

export const sandboxFlags = {
	json: Flags.boolean({ description: "Output JSON" }),
	verbose: Flags.boolean({ char: "v", description: "Show failure details" }),
};

export function validateSandboxInvocation(argv: readonly string[], bin: string): void {
	const launchFlags = findCommandLaunchFlags(argv, sandboxFlags);
	if (launchFlags.length > 0) {
		throw new CliUsageError(launchFlagScopeMessage(launchFlags, "sandbox", argv, bin));
	}
}
