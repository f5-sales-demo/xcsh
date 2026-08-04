import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { targetResourceFlags } from "./resource-flags";

export default class Delete extends Command {
	static description = "Delete resources identified by manifests or kind and name";
	static args = {
		kind: Args.string({ description: "Resource kind" }),
		name: Args.string({ description: "Resource name" }),
	};
	static flags = {
		...targetResourceFlags,
		filename: Flags.string({ char: "f", description: "Manifest file, directory, or - for stdin", multiple: true }),
		recursive: Flags.boolean({ char: "R", description: "Read manifest directories recursively", default: false }),
		"dry-run": Flags.string({ description: "Validate deletion without mutation", options: ["client"] }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Delete);
		await runResourceCli({
			operation: "delete",
			filenames: flags.filename,
			kind: args.kind,
			name: args.name,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			recursive: flags.recursive,
			dryRun: flags["dry-run"] as "client" | undefined,
			resultFile: flags["result-file"],
		});
	}
}
