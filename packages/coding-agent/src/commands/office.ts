/**
 * Serve, print, or sideload the embedded xcsh Office task pane.
 */
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { OFFICE_ACTIONS, OFFICE_APPS, type OfficeAction, type OfficeApp, runOfficeCommand } from "../cli/office-cli";

export default class Office extends Command {
	static description = "Serve, print, or sideload the embedded xcsh Office task pane";

	static args = {
		action: Args.string({
			description: "serve | manifest | sideload",
			required: false,
			options: OFFICE_ACTIONS,
		}),
		app: Args.string({
			description: "Office app for sideload (excel | powerpoint | word)",
			required: false,
			options: OFFICE_APPS,
		}),
	};

	static flags = {
		out: Flags.string({ char: "o", description: "Write manifest.json to this path (manifest action)" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Office);
		if (!args.action) {
			console.log(`Usage: xcsh office <${OFFICE_ACTIONS.join("|")}>`);
			console.log("  serve     Start the https://127-0-0-1.local-ip.sh:8444 task-pane listener");
			console.log("  manifest  Print (or -o write) the add-in manifest.json");
			console.log("  sideload  Sideload the add-in into a desktop Office app");
			return;
		}
		await runOfficeCommand({
			action: args.action as OfficeAction,
			app: args.app as OfficeApp | undefined,
			out: flags.out,
		});
	}
}
