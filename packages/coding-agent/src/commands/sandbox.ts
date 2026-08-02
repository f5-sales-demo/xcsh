/** Run installed-binary sandbox diagnostics. */
import { APP_NAME } from "@f5-sales-demo/pi-utils";
import { Args, CliUsageError, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { findCommandLaunchFlags, launchFlagScopeMessage } from "../cli/root-command-routing";
import { runSandboxCheck } from "../cli/sandbox-check";

export default class Sandbox extends Command {
	static description = "Verify the installed filesystem sandbox";

	static args = {
		action: Args.string({
			description: "Sandbox action",
			required: true,
			options: ["check"],
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON" }),
		verbose: Flags.boolean({ char: "v", description: "Show failure details" }),
	};

	async run(): Promise<void> {
		const launchFlags = findCommandLaunchFlags(this.argv, Sandbox.flags);
		if (launchFlags.length > 0) {
			throw new CliUsageError(launchFlagScopeMessage(launchFlags, "sandbox", this.argv, APP_NAME));
		}
		const { flags } = await this.parse(Sandbox);
		const report = await runSandboxCheck({ json: flags.json, verbose: flags.verbose });
		if (report.summary.failed > 0 || report.summary.errors > 0) process.exitCode = 1;
	}
}
