import { Command } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { manifestResourceFlags } from "./resource-flags";

export default class Apply extends Command {
	static description = "Apply manifests by creating, updating, or preserving resources";
	static flags = manifestResourceFlags;

	async run(): Promise<void> {
		const { flags } = await this.parse(Apply);
		await runResourceCli({
			operation: "apply",
			filenames: flags.filename,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			recursive: flags.recursive,
			dryRun: flags["dry-run"] as "client" | undefined,
			resultFile: flags["result-file"],
		});
	}
}
