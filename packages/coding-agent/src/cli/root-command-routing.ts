import { flagNameForChar, flagSpec, type LaunchFlagName } from "./flag-spec";

export interface PrefixedCommandRoute {
	command: string;
	commandArgs: string[];
	prefixFlags: LaunchFlagName[];
}

function optionalValue(token: string | undefined): token is string {
	return token !== undefined && !token.startsWith("-") && !token.startsWith("@");
}

/**
 * Find a registered command after root launch flags without changing their scope.
 *
 * Root flags configure an agent launch. They are not global options for every command, so callers use
 * this result to report the scope error instead of treating the command and its arguments as prompt
 * text. `--` deliberately stops command discovery and keeps everything after it as launch content.
 */
export function findPrefixedCommand(
	argv: readonly string[],
	isCommand: (token: string) => boolean,
): PrefixedCommandRoute | undefined {
	const prefixFlags: LaunchFlagName[] = [];
	let index = 0;
	while (index < argv.length) {
		const token = argv[index];
		if (token === "--") return undefined;
		if (!token.startsWith("-") || token === "-") {
			if (prefixFlags.length === 0 || !isCommand(token)) return undefined;
			return {
				command: token,
				commandArgs: argv.slice(index + 1),
				prefixFlags,
			};
		}

		const [longName, inlineValue] = token.startsWith("--") ? token.slice(2).split("=", 2) : [undefined, undefined];
		const name = longName ?? flagNameForChar(token.slice(1));
		const spec = name === undefined ? undefined : flagSpec(name);
		if (name === undefined || spec === undefined) return undefined;
		prefixFlags.push(name as LaunchFlagName);

		// Keep invalid boolean `=value` forms on the launch parser's diagnostic path instead of
		// replacing that syntax error with a subcommand-scope error.
		if (spec.arity === "boolean") {
			if (inlineValue !== undefined) return undefined;
			index++;
			continue;
		}
		if (inlineValue !== undefined) {
			index++;
			continue;
		}
		// Optional values and subcommands are otherwise ambiguous. A registered command wins; an
		// operator who means the same token as a value can state that unambiguously with `=`.
		if (spec.arity === "optional-value" && isCommand(argv[index + 1] ?? "")) {
			return {
				command: argv[index + 1],
				commandArgs: argv.slice(index + 2),
				prefixFlags,
			};
		}
		if (spec.arity === "optional-value") {
			index += optionalValue(argv[index + 1]) ? 2 : 1;
			continue;
		}
		if (argv[index + 1] === undefined) return undefined;
		index += 2;
	}
	return undefined;
}
