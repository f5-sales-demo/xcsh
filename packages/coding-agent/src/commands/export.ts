import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { targetResourceFlags } from "./resource-flags";

export default class Export extends Command {
	static description = "Export live resources as manifests";
	static args = {
		kind: Args.string({ description: "Resource kind" }),
		name: Args.string({ description: "Resource name" }),
	};
	static flags = {
		...targetResourceFlags,
		output: Flags.string({
			char: "o",
			description: "Manifest output format",
			options: ["json", "yaml"],
			default: "yaml",
		}),
		all: Flags.boolean({ description: "Export every supported resource kind", default: false }),
		file: Flags.string({ char: "f", description: "Write formatted output to a file" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Export);
		await runResourceCli({
			operation: "export",
			kind: args.kind,
			name: args.name,
			all: flags.all,
			namespace: flags.namespace,
			outputFormat: flags.output as "json" | "yaml" | "table" | "wide",
			resultFile: flags["result-file"],
			outputFile: flags.file,
		});
	}
}
