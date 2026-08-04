/** Check for and install xcsh executable updates. */
import { Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runUpdateCommand } from "../cli/update-cli";
import { initTheme } from "../modes/theme/theme";

export default class SelfUpdate extends Command {
	static description = "Check for and install xcsh executable updates";
	static flags = {
		force: Flags.boolean({ char: "f", description: "Force update", default: false }),
		check: Flags.boolean({ char: "c", description: "Check for updates without installing", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(SelfUpdate);
		await initTheme();
		await runUpdateCommand({ force: flags.force, check: flags.check });
	}
}
