import { Command } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { manifestResourceFlags } from "./resource-flags";

export default class Update extends Command {
	static description = "Update existing resources from manifests";
	static flags = manifestResourceFlags;

	async run(): Promise<void> {
		const { flags } = await this.parse(Update);
		await runResourceCli({
			operation: "update",
			filenames: flags.filename,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			recursive: flags.recursive,
			dryRun: flags["dry-run"] as "client" | undefined,
			resultFile: flags["result-file"],
		});
	}
}
