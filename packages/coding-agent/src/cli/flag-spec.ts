/**
 * The single source of truth for the root command's long flags.
 *
 * `xcsh --help` documented every long flag in the `=<value>` form while the parser matched only
 * `--flag value`, so `xcsh --model=opus` silently ran the configured default and
 * `xcsh --list-models=claude` fell through to the interactive TUI and hung (#2469). The two lived in
 * separate tables — `commands/launch.ts` for help, `cli/args.ts` for parsing — and drifted.
 *
 * Both now derive from `LAUNCH_FLAGS`: `buildCliFlags` renders help from it, and `parseArgs` consumes
 * it to resolve names and arity. Help and parser cannot disagree because they read the same datum.
 *
 * A leaf module on purpose — it imports only the thinking-effort list, so `commands/launch.ts` and
 * `cli/args.ts` can both depend on it without a cycle.
 */
import { THINKING_EFFORTS } from "@f5-sales-demo/pi-ai/model-thinking";
import { CliUsageError, type FlagDescriptor, Flags } from "@f5-sales-demo/pi-utils/cli";

export type FlagArity = "boolean" | "value" | "optional-value" | "repeatable-value";

export interface FlagSpec {
	arity: FlagArity;
	/** Single-character alias, as `-p` for `--print`. */
	char?: string;
	description: string;
	/** Enumerated legal values, validated by the parser and rendered into help. */
	options?: readonly string[];
	/** Accepted by the parser but omitted from help — aliases and internal plumbing. */
	hidden?: true;
}

/** Keeps the key names as literals (so `APPLY` must cover every one) while widening each value. */
const defineFlags = <T extends Record<string, FlagSpec>>(flags: T): { [K in keyof T]: FlagSpec } => flags;

/**
 * Every long flag the root command accepts.
 *
 * Where the old tables disagreed, the parser's behavior won, since that is what users observed:
 * `--resume` and `--list-models` take an optional value, and `--mode` accepts `acp`.
 */
export const LAUNCH_FLAGS = defineFlags({
	model: {
		arity: "value",
		description: 'Model to use (fuzzy match: "opus", "gpt-5.2", or "p-openai/gpt-5.2")',
	},
	smol: { arity: "value", description: "Smol/fast model for lightweight tasks (or PI_SMOL_MODEL env)" },
	slow: { arity: "value", description: "Slow/reasoning model for thorough analysis (or PI_SLOW_MODEL env)" },
	plan: { arity: "value", description: "Plan model for architectural planning (or PI_PLAN_MODEL env)" },
	provider: { arity: "value", description: "Provider to use (legacy; prefer --model)" },
	context: { arity: "value", description: "Bind this session to a named F5 XC context" },
	"api-key": { arity: "value", description: "API key (defaults to env vars)" },
	"system-prompt": { arity: "value", description: "System prompt (default: coding assistant prompt)" },
	"append-system-prompt": { arity: "value", description: "Append text or file contents to the system prompt" },
	"allow-home": { arity: "boolean", description: "Allow starting in ~ without auto-switching to a temp dir" },
	"no-sandbox": {
		arity: "boolean",
		description: "Disable the session filesystem discovery guard",
	},
	"allow-path": {
		arity: "repeatable-value",
		description: "Allow directory discovery at an additional path (repeatable)",
	},
	mode: {
		arity: "value",
		description: "Output mode: text (default), json, rpc, or acp",
		options: ["text", "json", "rpc", "acp"],
	},
	print: { arity: "boolean", char: "p", description: "Non-interactive mode: process prompt and exit" },
	continue: { arity: "boolean", char: "c", description: "Continue previous session" },
	resume: {
		arity: "optional-value",
		char: "r",
		description: "Resume a session (by ID prefix, path, or picker if omitted)",
	},
	session: { arity: "optional-value", description: "Alias of --resume", hidden: true },
	fork: { arity: "value", description: "Fork an existing session by ID prefix or path" },
	"session-dir": { arity: "value", description: "Directory for session storage and lookup" },
	"no-session": { arity: "boolean", description: "Don't save session (ephemeral)" },
	"no-memories": { arity: "boolean", description: "Disable project memory loading and maintenance" },
	"provider-session-id": { arity: "value", description: "Resume a provider-side session", hidden: true },
	models: { arity: "value", description: "Comma-separated model patterns for Ctrl+P cycling" },
	"no-tools": { arity: "boolean", description: "Disable all built-in tools" },
	"no-mcp": { arity: "boolean", description: "Disable MCP server discovery and tools" },
	"no-lsp": { arity: "boolean", description: "Disable LSP tools, formatting, and diagnostics" },
	"no-pty": { arity: "boolean", description: "Disable PTY-based interactive bash execution" },
	tools: { arity: "value", description: "Comma-separated list of tools to enable (default: all)" },
	thinking: {
		arity: "value",
		description: `Set thinking level: ${THINKING_EFFORTS.join(", ")}`,
		options: [...THINKING_EFFORTS],
	},
	hook: { arity: "repeatable-value", description: "Load a hook/extension file (can be used multiple times)" },
	extension: {
		arity: "repeatable-value",
		char: "e",
		description: "Load an extension file (can be used multiple times)",
	},
	"plugin-dir": { arity: "repeatable-value", description: "Load plugin from directory (repeatable)" },
	"no-extensions": {
		arity: "boolean",
		description: "Disable extension discovery (explicit -e paths still work)",
	},
	"no-skills": { arity: "boolean", description: "Disable skills discovery and loading" },
	skills: {
		arity: "value",
		description: "Comma-separated glob patterns to filter skills (e.g., git-*,docker)",
	},
	"no-rules": { arity: "boolean", description: "Disable rules discovery and loading" },
	export: { arity: "value", description: "Export session file to HTML and exit" },
	"list-models": { arity: "optional-value", description: "List available models (with optional fuzzy search)" },
	"no-title": { arity: "boolean", description: "Disable title auto-generation" },
	help: { arity: "boolean", char: "h", description: "Show help", hidden: true },
	version: { arity: "boolean", char: "v", description: "Show version", hidden: true },
});

export type LaunchFlagName = keyof typeof LAUNCH_FLAGS;

/** Long-flag name for a single-character alias, e.g. `p` -> `print`. */
const CHAR_ALIASES: ReadonlyMap<string, LaunchFlagName> = new Map(
	Object.entries(LAUNCH_FLAGS)
		.filter((entry): entry is [LaunchFlagName, FlagSpec & { char: string }] => "char" in entry[1])
		.map(([name, spec]) => [spec.char, name]),
);

export function flagSpec(name: string): FlagSpec | undefined {
	return (LAUNCH_FLAGS as Record<string, FlagSpec>)[name];
}

export function flagNameForChar(char: string): LaunchFlagName | undefined {
	return CHAR_ALIASES.get(char);
}

export function takesValue(spec: FlagSpec): boolean {
	return spec.arity !== "boolean";
}

/** Render the help table from the spec, so the documented syntax is the accepted syntax. */
export function buildCliFlags(): Record<string, FlagDescriptor> {
	const flags: Record<string, FlagDescriptor> = {};
	for (const [name, spec] of Object.entries(LAUNCH_FLAGS) as Array<[string, FlagSpec]>) {
		if (spec.hidden) continue;
		flags[name] =
			spec.arity === "boolean"
				? Flags.boolean({ char: spec.char, description: spec.description })
				: Flags.string({
						char: spec.char,
						description: spec.description,
						options: spec.options,
						multiple: spec.arity === "repeatable-value",
					});
	}
	return flags;
}

/** A `--name=value` token the parser could not attribute to any known flag. */
export interface UnrecognizedFlag {
	/** The token as written, including any `=value`, for the diagnostic. */
	token: string;
	/** The flag name without dashes or `=value`, for matching against extension flags. */
	name: string;
}

type ExtensionFlagSpec = ReadonlyMap<string, { type: "boolean" | "string" }>;

function inlineFlag(arg: string): { name: string; value: string } | undefined {
	const match = /^--([^=]+)=([\s\S]*)$/.exec(arg);
	if (!match) return undefined;
	return { name: match[1], value: match[2] };
}

/** Reject inline values for known boolean flags without loading the agent command. */
export function validateInlineFlagSyntax(args: readonly string[], extensionFlags?: ExtensionFlagSpec): void {
	for (const arg of args) {
		if (arg === "--") return;
		const inline = inlineFlag(arg);
		if (!inline) continue;

		const spec = flagSpec(inline.name);
		const isBoolean = spec?.arity === "boolean" || extensionFlags?.get(inline.name)?.type === "boolean";
		if (isBoolean) {
			throw new CliUsageError(`--${inline.name} is a boolean flag and does not take a value`);
		}
	}
}

/**
 * Rewrite `--name=value` into `["--name", "value"]` for every flag that takes a value.
 *
 * A boolean flag with `=` is an error rather than a guess: accepting `--no-sandbox=true` invites
 * `--no-sandbox=false`, which the parser has no way to express, and quietly reading it as "on" would
 * be exactly the class of bug #2469 reports. Unknown names are left intact so the unknown-flag path
 * can report the token as the user wrote it.
 *
 * Short forms are untouched: no shell convention makes `-p=x` mean `-p x`.
 */
export function normalizeFlagTokens(args: readonly string[], extensionFlags?: ExtensionFlagSpec): string[] {
	validateInlineFlagSyntax(args, extensionFlags);
	const normalized: string[] = [];
	let afterTerminator = false;

	for (const arg of args) {
		if (afterTerminator) {
			normalized.push(arg);
			continue;
		}
		if (arg === "--") {
			afterTerminator = true;
			normalized.push(arg);
			continue;
		}

		const inline = inlineFlag(arg);
		if (!inline) {
			normalized.push(arg);
			continue;
		}

		const { name, value } = inline;
		const spec = flagSpec(name);
		if (spec) {
			normalized.push(`--${name}`, value);
			continue;
		}

		const extension = extensionFlags?.get(name);
		if (extension) {
			normalized.push(`--${name}`, value);
			continue;
		}

		normalized.push(arg);
	}

	return normalized;
}
