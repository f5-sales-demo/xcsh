import { Command } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { manifestResourceFlags } from "./resource-flags";

export default class Create extends Command {
	static description = "Create resources from manifests and fail if they already exist";
	static flags = manifestResourceFlags;

	async run(): Promise<void> {
		const { flags } = await this.parse(Create);
		await runResourceCli({
			operation: "create",
			filenames: flags.filename,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			recursive: flags.recursive,
			dryRun: flags["dry-run"] as "client" | undefined,
			resultFile: flags["result-file"],
		});
	}
}
