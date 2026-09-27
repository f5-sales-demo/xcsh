import { CliUsageError, Command, parseCommandArgv } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { manifestResourceFlags } from "./resource-flags";

type ResourceOutputFormat = "json" | "yaml" | "table" | "wide";

export type UpdateInvocation = {
	mode: "resource";
	filenames: string[] | undefined;
	namespace: string | undefined;
	outputFormat: ResourceOutputFormat;
	recursive: boolean;
	dryRun: "client" | undefined;
	resultFile: string | undefined;
};

/** Parse the resource-update command before it can perform I/O. */
export function parseUpdateInvocation(argv: readonly string[]): UpdateInvocation {
	const parsed = parseCommandArgv(argv, { flags: manifestResourceFlags });
	if (parsed.argv.length > 0) {
		throw new CliUsageError(`Unexpected argument${parsed.argv.length === 1 ? "" : "s"}: ${parsed.argv.join(" ")}`);
	}

	const flags = parsed.flags as {
		filename?: string[];
		namespace?: string;
		output: ResourceOutputFormat;
		recursive: boolean;
		"dry-run"?: "client";
		"result-file"?: string;
	};
	return {
		mode: "resource",
		filenames: flags.filename,
		namespace: flags.namespace,
		outputFormat: flags.output,
		recursive: flags.recursive,
		dryRun: flags["dry-run"],
		resultFile: flags["result-file"],
	};
}

export default class Update extends Command {
	static description = "Update F5 Distributed Cloud resources from manifests";
	static flags = manifestResourceFlags;
	static examples = [
		"xcsh update -f manifest.yaml        # update resources from a manifest",
		"xcsh update -f manifests/ -R        # update resources from a manifest directory",
	];

	async run(): Promise<void> {
		const invocation = parseUpdateInvocation(this.argv);
		await runResourceCli({
			operation: "update",
			filenames: invocation.filenames,
			namespace: invocation.namespace,
			outputFormat: invocation.outputFormat,
			recursive: invocation.recursive,
			dryRun: invocation.dryRun,
			resultFile: invocation.resultFile,
		});
	}
}
