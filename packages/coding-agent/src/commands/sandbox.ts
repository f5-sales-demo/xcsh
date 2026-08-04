/** Run installed-binary sandbox diagnostics. */
import { APP_NAME } from "@f5-sales-demo/pi-utils";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { runSandboxCheck } from "../cli/sandbox-check";
import { sandboxArgs, sandboxFlags, validateSandboxInvocation } from "../cli/sandbox-spec";

export default class Sandbox extends Command {
	static description = "Verify the installed filesystem sandbox";

	static args = sandboxArgs;

	static flags = sandboxFlags;

	async run(): Promise<void> {
		validateSandboxInvocation(this.argv, APP_NAME);
		const { flags } = await this.parse(Sandbox);
		const report = await runSandboxCheck({ json: flags.json, verbose: flags.verbose });
		if (report.summary.failed > 0 || report.summary.errors > 0) process.exitCode = 1;
	}
}
