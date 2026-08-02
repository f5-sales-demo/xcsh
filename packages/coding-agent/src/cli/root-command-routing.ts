import type { FlagDescriptor } from "@f5-sales-demo/pi-utils/cli";
import { flagNameForChar, flagSpec, type LaunchFlagName } from "./flag-spec";

export interface PrefixedCommandRoute {
	command: string;
	commandArgs: string[];
	prefixFlags: LaunchFlagName[];
}

function uniqueFlags(flags: readonly LaunchFlagName[]): LaunchFlagName[] {
	return [...new Set(flags)];
}

/**
 * Find agent-launch flags in a registered command's argv while preserving that command's own flags.
 *
 * `--` ends option parsing. Long and short command flags both take precedence over identically named
 * launch flags, so `sandbox check -v` remains the sandbox check's verbose mode.
 */
export function findCommandLaunchFlags(
	argv: readonly string[],
	commandFlags: Readonly<Record<string, FlagDescriptor>>,
): LaunchFlagName[] {
	const shortCommandFlags = new Set(
		Object.values(commandFlags)
			.map(descriptor => descriptor.char)
			.filter((char): char is string => char !== undefined),
	);
	const found: LaunchFlagName[] = [];

	for (const token of argv) {
		if (token === "--") break;
		if (token.startsWith("--")) {
			const name = token.slice(2).split("=", 1)[0];
			if (commandFlags[name] !== undefined) continue;
			if (flagSpec(name) !== undefined) found.push(name as LaunchFlagName);
			continue;
		}
		if (!token.startsWith("-") || token === "-") continue;
		const char = token.slice(1);
		if (shortCommandFlags.has(char)) continue;
		const name = flagNameForChar(char);
		if (name !== undefined) found.push(name);
	}

	return uniqueFlags(found);
}

/** Render the single scope diagnostic used for launch flags on either side of a subcommand. */
export function launchFlagScopeMessage(
	flags: readonly LaunchFlagName[],
	command: string,
	commandArgs: readonly string[],
	bin: string,
): string {
	const unique = uniqueFlags(flags);
	const names = unique.map(flag => `--${flag}`).join(", ");
	const singular = unique.length === 1;
	if (command === "sandbox" && commandArgs[0] === "check") {
		return (
			`Launch ${singular ? "flag" : "flags"} ${names} ${singular ? "applies" : "apply"} to an agent session, not to \`sandbox check\`. ` +
			`Run \`${bin} sandbox check\` without launch flags; its \`explicit grant restores parent enumeration\` probe verifies grant behavior.`
		);
	}
	return (
		`Launch ${singular ? "flag" : "flags"} ${names} ${singular ? "applies" : "apply"} to an agent session, not to the ` +
		`\`${command}\` subcommand. Start an agent session with launch flags before its prompt.`
	);
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
