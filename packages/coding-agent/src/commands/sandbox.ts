/** Run installed-binary sandbox diagnostics. */
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
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
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Sandbox);
		const report = await runSandboxCheck({ json: flags.json });
		if (report.summary.failed > 0) process.exitCode = 1;
	}
}
