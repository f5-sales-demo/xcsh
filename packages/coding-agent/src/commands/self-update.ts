/** Check for executable updates and follow the detected installation channel. */
import { Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runUpdateCommand } from "../cli/update-cli";
import { initTheme } from "../modes/theme/theme";

export default class SelfUpdate extends Command {
	static description = "Check for xcsh updates and follow the detected installation channel";
	static flags = {
		force: Flags.boolean({
			char: "f",
			description: "Show or perform the channel-owned action when current",
			default: false,
		}),
		check: Flags.boolean({ char: "c", description: "Report the channel without changing files", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(SelfUpdate);
		await initTheme();
		const exitCode = await runUpdateCommand({ force: flags.force, check: flags.check });
		if (exitCode !== 0) process.exitCode = exitCode;
	}
}
