/**
 * Inspect or arrange the Chrome session xcsh drives for console automation.
 */
import { Args, Command } from "@f5-sales-demo/pi-utils/cli";
import { type ChromeAction, runChromeCommand } from "../cli/chrome-cli";
import { Settings, settings } from "../config/settings";

const ACTIONS: ChromeAction[] = ["status", "relaunch", "setup"];

export default class Chrome extends Command {
	static description = "Inspect or arrange the Chrome session xcsh drives for console automation";

	static args = {
		action: Args.string({
			description: "status | relaunch | setup",
			required: false,
			options: ACTIONS,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Chrome);
		const action = (args.action ?? "status") as ChromeAction;
		await Settings.init();
		// eslint-disable-next-line no-console
		console.log(await runChromeCommand(action, settings));
	}
}
