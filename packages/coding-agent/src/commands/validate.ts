import { Command } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { manifestInputFlags } from "./resource-flags";

export default class Validate extends Command {
	static description = "Validate manifests locally without API credentials";
	static flags = manifestInputFlags;

	async run(): Promise<void> {
		const { flags } = await this.parse(Validate);
		await runResourceCli({
			operation: "validate",
			filenames: flags.filename,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			recursive: flags.recursive,
			resultFile: flags["result-file"],
		});
	}
}
