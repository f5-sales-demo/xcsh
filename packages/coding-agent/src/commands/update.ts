import { CliUsageError, Command, Flags, parseCommandArgv } from "@f5-sales-demo/pi-utils/cli";
import { runResourceCli } from "../cli/resource-cli";
import { runUpdateCommand } from "../cli/update-cli";
import { initTheme } from "../modes/theme/theme";
import { manifestResourceFlags } from "./resource-flags";

const updateFlags = {
	...manifestResourceFlags,
	force: Flags.boolean({
		description: "Force executable update (short -f is reserved for resource manifests)",
		default: false,
	}),
	check: Flags.boolean({ char: "c", description: "Check for executable updates without installing", default: false }),
};

type ResourceOutputFormat = "json" | "yaml" | "table" | "wide";

export type UpdateInvocation =
	| { mode: "executable"; force: boolean; check: boolean }
	| {
			mode: "resource";
			filenames: string[] | undefined;
			namespace: string | undefined;
			outputFormat: ResourceOutputFormat;
			recursive: boolean;
			dryRun: "client" | undefined;
			resultFile: string | undefined;
	  };

function explicitlyRequestsDefaultOutput(argv: readonly string[]): boolean {
	return argv.some(arg => arg === "--output" || arg.startsWith("--output=") || arg === "-o");
}

/** Resolve the backward-compatible `update` command before either updater can perform I/O. */
export function parseUpdateInvocation(argv: readonly string[]): UpdateInvocation {
	if (argv.length === 1 && argv[0] === "-f") {
		throw new CliUsageError(
			"Ambiguous -f: use 'xcsh update --force' or 'xcsh self-update -f' for executable updates; otherwise provide a resource manifest",
		);
	}
	const parsed = parseCommandArgv(argv, { flags: updateFlags });
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
		force: boolean;
		check: boolean;
	};
	const executableRequested = flags.force || flags.check;
	const resourceRequested =
		flags.filename !== undefined ||
		flags.namespace !== undefined ||
		flags.recursive ||
		flags["dry-run"] !== undefined ||
		flags["result-file"] !== undefined ||
		flags.output !== "table" ||
		explicitlyRequestsDefaultOutput(argv);

	if (executableRequested && resourceRequested) {
		throw new CliUsageError("update cannot combine executable-update and resource-update flags");
	}
	if (!resourceRequested) {
		return { mode: "executable", force: flags.force, check: flags.check };
	}
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
	static description = "Update the xcsh executable or existing resources from manifests";
	static flags = updateFlags;
	static examples = [
		"xcsh update                         # update the executable",
		"xcsh update --check                 # check the executable version",
		"xcsh update --force                 # force an executable reinstall",
		"xcsh self-update -f                 # short force form for the executable",
		"xcsh update -f manifest.yaml        # update resources from a manifest",
	];

	async run(): Promise<void> {
		const invocation = parseUpdateInvocation(this.argv);
		if (invocation.mode === "executable") {
			await initTheme();
			await runUpdateCommand({ force: invocation.force, check: invocation.check });
			return;
		}
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
