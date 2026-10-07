import { type ArgDescriptor, Args, CliUsageError, Command, renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { writeCliOutput } from "@f5-sales-demo/pi-utils/cli-output";
import { flagsForBlindfold } from "./blindfold-args";
export function showBlindfoldHelp(argv: string[], bin: string): void {
	const compatibility = argv[0] === "request";
	const leaf = compatibility ? argv[2] : argv[1];
	const operation =
		(
			{ "get-public-key": "public-key", "get-policy-document": "policy", encrypt: "encrypt" } as Record<
				string,
				string
			>
		)[leaf ?? ""] ?? (!compatibility ? leaf : undefined);
	if (compatibility && argv[1] && !["secrets", "-h", "--help"].includes(argv[1])) {
		writeCliOutput(process.stderr, "Error: Only request secrets is supported\n");
		process.exitCode = 2;
		return;
	}
	if (!operation || ["--help", "-h"].includes(operation)) {
		writeCliOutput(
			process.stdout,
			`${bin} ${compatibility ? "request secrets" : "blindfold"} ${compatibility ? "get-public-key | get-policy-document | encrypt" : "public-key | policy | encrypt | certificate | create | replace"}\nUse an operation followed by --help. Authentication uses xcsh context.\n`,
		);
		return;
	}
	try {
		if (
			!["public-key", "policy", "encrypt", "certificate", "create", "replace"].includes(operation) ||
			(compatibility && !["get-public-key", "get-policy-document", "encrypt"].includes(leaf!))
		)
			throw new CliUsageError("Unknown Blindfold operation");
		class Help extends Command {
			static description =
				operation === "encrypt"
					? "Encrypt an input file or redirected stdin; paired public material files select offline operation"
					: operation === "policy"
						? "Retrieve a secret policy document; namespace/name select the policy"
						: "Native Blindfold operation";
			static flags = flagsForBlindfold(operation!);
			static args: Record<string, ArgDescriptor> =
				operation === "encrypt"
					? { file: Args.string({ description: "Filename or -; omit for redirected stdin" }) }
					: {};
			async run() {}
		}
		renderCommandHelp(bin, argv.slice(0, compatibility ? 3 : 2).join(" "), Help);
	} catch (error) {
		writeCliOutput(process.stderr, `Error: ${error instanceof Error ? error.message : "invalid operation"}\n`);
		process.exitCode = 2;
	}
}
