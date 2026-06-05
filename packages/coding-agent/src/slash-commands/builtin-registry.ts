import * as os from "node:os";
import * as path from "node:path";

import { getOAuthProviders } from "@f5xc-salesdemos/pi-ai";
import type { AutocompleteItem } from "@f5xc-salesdemos/pi-tui";
import { getConfigDirName } from "@f5xc-salesdemos/pi-utils";
import { invalidate as invalidateFsCache } from "../capability/fs";
import type { SettingPath, SettingValue } from "../config/settings";
import { settings } from "../config/settings";
import {
	clearXcshPluginRootsCache,
	resolveActiveProjectRegistryPath,
	resolveOrDefaultProjectRegistryPath,
} from "../discovery/helpers.js";
import { PluginManager } from "../extensibility/plugins";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../extensibility/plugins/marketplace";
import type { InteractiveModeContext } from "../modes/types";
import { ContextService } from "../services/f5xc-context";
import { parseMarketplaceInstallArgs, parsePluginScopeArgs } from "./marketplace-install-parser";

function tryGetContextService(): ContextService | null {
	try {
		return ContextService.instance;
	} catch (err) {
		// Expected only when the service hasn't been init()'d yet. Any other error
		// is surfaced by rethrowing so the TUI's unhandled-rejection path logs it.
		if (err instanceof Error && err.message.includes("not initialized")) {
			return null;
		}
		throw err;
	}
}

function refreshStatusLine(ctx: InteractiveModeContext): void {
	ctx.statusLine.invalidate();
	ctx.updateEditorTopBorder();
	ctx.ui.requestRender();
}

/** Declarative subcommand definition for commands like /mcp. */
export interface SubcommandDef {
	name: string;
	description: string;
	/** Usage hint shown as dim ghost text, e.g. "<name> [--scope project|user]". */
	usage?: string;
	/**
	 * Optional sync provider for dynamic completions of this subcommand's arguments.
	 *
	 * `argumentPrefix` is the text after the subcommand name and its trailing space.
	 * For multi-token arguments (e.g. `/context unset KEY1 KEY2`), the provider
	 * receives the full tail (`"KEY1 KEY2"`) and must return items whose `value`
	 * contains the complete replacement for that tail — including any already-typed
	 * tokens the user should keep. The infrastructure prepends `<subcommand> ` to
	 * each returned `value` before handing items to `applyCompletion`.
	 *
	 * Return `null` or `[]` to signal "no dropdown"; both are treated identically.
	 */
	getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
}

/** Declarative builtin slash command definition used by autocomplete and help UI. */
export interface BuiltinSlashCommand {
	name: string;
	description: string;
	/** Subcommands for dropdown completion (e.g. /mcp add, /mcp list). */
	subcommands?: SubcommandDef[];
	/** Static inline hint when command takes a simple argument (no subcommands). */
	inlineHint?: string;
	getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
}

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

interface BuiltinSlashCommandSpec extends BuiltinSlashCommand {
	aliases?: string[];
	allowArgs?: boolean;
	/**
	 * Handle the command. Return a string to pass remaining text through as prompt input.
	 * Return void/undefined to consume the input entirely.
	 */
	handle: (
		command: ParsedBuiltinSlashCommand,
		runtime: BuiltinSlashCommandRuntime,
		// biome-ignore lint/suspicious/noConfusingVoidType: void needed so handlers returning nothing are assignable
	) => Promise<string | undefined> | string | void;
}

export interface BuiltinSlashCommandRuntime {
	ctx: InteractiveModeContext;
	handleBackgroundCommand: () => void;
}

function parseBuiltinSlashCommand(text: string): ParsedBuiltinSlashCommand | null {
	if (!text.startsWith("/")) return null;
	const body = text.slice(1);
	if (!body) return null;

	const firstWhitespace = body.search(/\s/);
	const firstColon = body.indexOf(":");
	const firstSeparator =
		firstWhitespace === -1 ? firstColon : firstColon === -1 ? firstWhitespace : Math.min(firstWhitespace, firstColon);

	if (firstSeparator === -1) {
		return {
			name: body,
			args: "",
			text,
		};
	}

	return {
		name: body.slice(0, firstSeparator),
		args: body.slice(firstSeparator + 1).trim(),
		text,
	};
}

const shutdownHandler = (_command: ParsedBuiltinSlashCommand, runtime: BuiltinSlashCommandRuntime): void => {
	runtime.ctx.editor.setText("");
	void runtime.ctx.shutdown();
};

const CONTEXT_SUBCOMMANDS: SubcommandDef[] = [
	{ name: "list", description: "List all contexts" },
	{
		name: "activate",
		description: "Switch to a named context",
		usage: "<name>",
		getArgumentCompletions(prefix: string) {
			if (prefix.includes(" ")) return null;
			const svc = tryGetContextService();
			if (!svc) return null;
			const lower = prefix.toLowerCase();
			const items = svc
				.listContextNamesCached()
				.filter(n => n.toLowerCase().startsWith(lower))
				.map(n => {
					const hint = svc.getContextHint(n);
					const parts: string[] = [];
					if (hint?.apiUrl) parts.push(hint.apiUrl);
					if (hint?.incompatible && hint.schemaVersion !== undefined) {
						parts.push(`incompatible: v${hint.schemaVersion}`);
					}
					return {
						value: n,
						label: n,
						description: parts.length > 0 ? parts.join(" · ") : undefined,
					};
				});
			return items.length > 0 ? items : null;
		},
	},
	{
		name: "validate",
		description: "Validate credentials for a context without activating",
		usage: "<name>",
		getArgumentCompletions(prefix: string) {
			if (prefix.includes(" ")) return null;
			const svc = tryGetContextService();
			if (!svc) return null;
			const lower = prefix.toLowerCase();
			const items = svc
				.listContextNamesCached()
				.filter(n => n.toLowerCase().startsWith(lower))
				.map(n => {
					const hint = svc.getContextHint(n);
					const parts: string[] = [];
					if (hint?.apiUrl) parts.push(hint.apiUrl);
					if (hint?.incompatible && hint.schemaVersion !== undefined) {
						parts.push(`incompatible: v${hint.schemaVersion}`);
					}
					return {
						value: n,
						label: n,
						description: parts.length > 0 ? parts.join(" · ") : undefined,
					};
				});
			return items.length > 0 ? items : null;
		},
	},
	{ name: "show", description: "Show context details (masked)", usage: "[name]" },
	{ name: "status", description: "Show current auth status" },
	{ name: "create", description: "Create a new context", usage: "<name> <url> <token> [namespace]" },
	{ name: "delete", description: "Delete a context", usage: "<name> --confirm" },
	{
		name: "rename",
		description: "Rename a context",
		usage: "<old> <new>",
		getArgumentCompletions(prefix: string) {
			if (prefix.includes(" ")) return null;
			const svc = tryGetContextService();
			if (!svc) return null;
			const lower = prefix.toLowerCase();
			const items = svc
				.listContextNamesCached()
				.filter(n => n.toLowerCase().startsWith(lower))
				.map(n => ({ value: n, label: n }));
			return items.length > 0 ? items : null;
		},
	},
	{
		name: "export",
		description: "Export a context (or all contexts) as JSON",
		usage: "[name] [--include-token]",
		getArgumentCompletions(prefix: string) {
			const svc = tryGetContextService();
			if (!svc) return null;
			const tokens = prefix.split(/\s+/).filter(Boolean);
			const hasIncludeToken = tokens.includes("--include-token");
			const positionalsTyped = tokens.filter(t => !t.startsWith("--"));
			// Last token is "in-progress" if the prefix does not end with space.
			const trailingSpace = prefix.endsWith(" ") || prefix === "";
			const typedPositionalCount = trailingSpace
				? positionalsTyped.length
				: Math.max(0, positionalsTyped.length - 1);
			const completingToken = trailingSpace ? "" : (tokens[tokens.length - 1] ?? "");
			// `head` is every already-typed token EXCEPT the one being
			// completed. getArgumentCompletions.value replaces the whole
			// argument tail, so value must carry every token the user
			// should keep — otherwise accepting a suggestion silently
			// drops the other args. Contract: see SubcommandDef JSDoc
			// above (line ~58).
			const headTokens = trailingSpace ? tokens : tokens.slice(0, -1);
			const head = headTokens.length > 0 ? `${headTokens.join(" ")} ` : "";

			const items: { value: string; label: string; description?: string }[] = [];

			// Offer context names only if no positional has been filled yet.
			// No startsWith("--") guard: context names legitimately allow
			// leading dashes (the regex is /^[a-zA-Z0-9_-]{1,64}$/), and
			// the handler's splitArgs uses a known-flags allowlist that
			// treats only --include-token as a flag. So a context like
			// `--prod` is valid; the completion filters by prefix and
			// matches it naturally. When the user types `--in`, the
			// flag-completion branch below matches `--include-token` by
			// prefix; if there's ALSO a context starting with `--in` it
			// is offered here. Both lists are disjoint by filter so
			// there's no double-offer of the same token.
			if (typedPositionalCount === 0) {
				const lower = completingToken.toLowerCase();
				for (const n of svc.listContextNamesCached()) {
					if (!n.toLowerCase().startsWith(lower)) continue;
					const hint = svc.getContextHint(n);
					items.push({
						value: `${head}${n}`,
						label: n,
						description: hint?.apiUrl,
					});
				}
			}

			// Offer --include-token unless already present. Match is
			// case-sensitive because the handler's flag check uses
			// exact-match `flags.has("--include-token")` — offering
			// the suggestion for mis-cased prefixes (e.g. `--INCLUDE`)
			// would produce a suggestion the handler then ignores.
			if (!hasIncludeToken && "--include-token".startsWith(completingToken)) {
				items.push({
					value: `${head}--include-token`,
					label: "--include-token",
					description: "emit unmasked tokens",
				});
			}

			return items.length > 0 ? items : null;
		},
	},
	{
		name: "import",
		description: "Import contexts from a file path or inline JSON",
		usage: "<path-or-json> [--overwrite]",
		// No dynamic completion — paths are hard to complete correctly,
		// and faking it would only mislead. Users pre-expand paths in
		// their shell.
	},
	{
		name: "namespace",
		description: "Switch namespace within active context",
		usage: "<namespace>",
		getArgumentCompletions(prefix: string) {
			if (prefix.includes(" ")) return null;
			const svc = tryGetContextService();
			if (!svc) return null;
			// setNamespace() requires an active context. Don't offer completions that
			// would lead the user into a command path that cannot succeed (e.g. an
			// env-backed session where cached namespaces came from startup validation
			// but there is no active context to apply them to).
			if (!svc.getStatus().activeContextName) return null;
			const lower = prefix.toLowerCase();
			const items = svc
				.getCachedNamespaces()
				.filter(n => n.toLowerCase().startsWith(lower))
				.map(n => ({ value: n, label: n }));
			return items.length > 0 ? items : null;
		},
	},
	{ name: "env", description: "Manage environment variables", usage: "set|unset|list [KEY=VALUE ...]" },
	{ name: "set", description: "Set environment variable(s)", usage: "KEY=VALUE [KEY2=VALUE2 ...]" },
	{
		name: "unset",
		description: "Remove environment variable(s)",
		usage: "KEY [KEY2 ...]",
		getArgumentCompletions(prefix: string) {
			const lastSpace = prefix.lastIndexOf(" ");
			const headRaw = lastSpace === -1 ? "" : prefix.slice(0, lastSpace + 1);
			const tail = lastSpace === -1 ? prefix : prefix.slice(lastSpace + 1);
			const svc = tryGetContextService();
			if (!svc) return null;
			const knownKeys = svc.getActiveEnvKeys();
			const knownExact = new Set(knownKeys);
			// Group known keys by their lowercased form so we can detect
			// case-distinct collisions (e.g. both `Foo` and `FOO` present).
			const variantsByLower = new Map<string, string[]>();
			for (const k of knownKeys) {
				const lower = k.toLowerCase();
				const existing = variantsByLower.get(lower);
				if (existing) existing.push(k);
				else variantsByLower.set(lower, [k]);
			}
			// Normalization priority:
			//   1. Exact-case match → preserve user's token verbatim
			//   2. Lowercase maps to exactly one canonical → rewrite (the common
			//      "user typed lowercase, context has uppercase" path)
			//   3. Lowercase maps to multiple canonicals (ambiguous) → preserve
			//      as-typed. Auto-picking one would silently target the wrong
			//      variable. The handler will match nothing and report a no-op,
			//      letting the user retype the exact case they meant.
			//   4. No match → preserve as-typed so typos surface via handler.
			const typedTokens = headRaw.trim().split(/\s+/).filter(Boolean);
			const normalizedTokens = typedTokens.map(t => {
				if (knownExact.has(t)) return t;
				const variants = variantsByLower.get(t.toLowerCase());
				if (variants && variants.length === 1) return variants[0];
				return t;
			});
			const head = normalizedTokens.length > 0 ? `${normalizedTokens.join(" ")} ` : "";
			const alreadyExact = new Set(normalizedTokens);
			const items = knownKeys
				.filter(k => !alreadyExact.has(k))
				.filter(k => k.toLowerCase().startsWith(tail.toLowerCase()))
				.map(k => ({
					value: `${head}${k} `,
					label: k,
					description: "env var on active context",
				}));
			return items.length > 0 ? items : null;
		},
	},
	{ name: "wizard", description: "Guided interactive context setup" },
];

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<BuiltinSlashCommandSpec> = [
	{
		name: "settings",
		description: "Open settings menu",
		handle: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "plan",
		description: "Toggle plan mode (agent plans before executing)",
		inlineHint: "[prompt]",
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handlePlanModeCommand(command.args || undefined);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "model",
		aliases: ["models"],
		description: "Select model (opens selector UI)",
		handle: (_command, runtime) => {
			runtime.ctx.showModelSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fast",
		description: "Toggle fast mode (OpenAI service tier priority)",
		subcommands: [
			{ name: "on", description: "Enable fast mode" },
			{ name: "off", description: "Disable fast mode" },
			{ name: "status", description: "Show fast mode status" },
		],
		allowArgs: true,
		handle: (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg || arg === "toggle") {
				const enabled = runtime.ctx.session.toggleFastMode();
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus(`Fast mode ${enabled ? "enabled" : "disabled"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "on") {
				runtime.ctx.session.setFastMode(true);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus("Fast mode enabled.");
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "off") {
				runtime.ctx.session.setFastMode(false);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus("Fast mode disabled.");
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "status") {
				const enabled = runtime.ctx.session.isFastModeEnabled();
				runtime.ctx.showStatus(`Fast mode is ${enabled ? "on" : "off"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Usage: /fast [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "export",
		description: "Export session to HTML file",
		inlineHint: "[path]",
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handleExportCommand(command.text);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "dump",
		description: "Copy session transcript to clipboard",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleDumpCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "share",
		description: "Share session as a secret GitHub gist",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleShareCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "browser",
		description: "Toggle browser headless vs visible mode",
		subcommands: [
			{ name: "headless", description: "Switch to headless mode" },
			{ name: "visible", description: "Switch to visible mode" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			const current = settings.get("browser.headless" as SettingPath) as boolean;
			let next = current;
			if (!(settings.get("browser.enabled" as SettingPath) as boolean)) {
				runtime.ctx.showWarning("Browser tool is disabled (enable in settings)");
				runtime.ctx.editor.setText("");
				return;
			}
			if (!arg) {
				next = !current;
			} else if (["headless", "hidden"].includes(arg)) {
				next = true;
			} else if (["visible", "show", "headful"].includes(arg)) {
				next = false;
			} else {
				runtime.ctx.showStatus("Usage: /browser [headless|visible]");
				runtime.ctx.editor.setText("");
				return;
			}
			settings.set("browser.headless" as SettingPath, next as SettingValue<SettingPath>);
			const tool = runtime.ctx.session.getToolByName("browser");
			if (tool && "restartForModeChange" in tool) {
				try {
					await (tool as { restartForModeChange: () => Promise<void> }).restartForModeChange();
				} catch (error) {
					runtime.ctx.showWarning(
						`Failed to restart browser: ${error instanceof Error ? error.message : String(error)}`,
					);
					runtime.ctx.editor.setText("");
					return;
				}
			}
			runtime.ctx.showStatus(`Browser mode: ${next ? "headless" : "visible"}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "copy",
		description: "Copy last agent message to clipboard",
		subcommands: [
			{ name: "last", description: "Copy full last agent message" },
			{ name: "code", description: "Copy last code block" },
			{ name: "all", description: "Copy all code blocks from last message" },
			{ name: "cmd", description: "Copy last bash/python command" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const sub = command.args.trim().toLowerCase() || undefined;
			await runtime.ctx.handleCopyCommand(sub);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "session",
		description: "Session management commands",
		subcommands: [
			{ name: "info", description: "Show session info and stats" },
			{ name: "delete", description: "Delete current session and return to selector" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const sub = command.args.trim().toLowerCase() || "info";
			if (sub === "delete") {
				runtime.ctx.editor.setText("");
				await runtime.ctx.handleSessionDeleteCommand();
				return;
			}
			// Default: show session info
			await runtime.ctx.handleSessionCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "jobs",
		description: "Show async background jobs status",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleJobsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "usage",
		description: "Show provider usage and limits",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleUsageCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "changelog",
		description: "Show changelog entries",
		subcommands: [{ name: "full", description: "Show complete changelog" }],
		allowArgs: true,
		handle: async (command, runtime) => {
			const showFull = command.args.split(/\s+/).filter(Boolean).includes("full");
			await runtime.ctx.handleChangelogCommand(showFull);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "hotkeys",
		description: "Show all keyboard shortcuts",
		handle: (_command, runtime) => {
			runtime.ctx.handleHotkeysCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tools",
		description: "Show tools currently visible to the agent",
		handle: (_command, runtime) => {
			runtime.ctx.handleToolsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "extensions",
		aliases: ["status"],
		description: "Open Extension Control Center dashboard",
		handle: (_command, runtime) => {
			runtime.ctx.showExtensionsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "agents",
		description: "Open Agent Control Center dashboard",
		handle: (_command, runtime) => {
			runtime.ctx.showAgentsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "branch",
		description: "Create a new branch from a previous message",
		handle: (_command, runtime) => {
			if (settings.get("doubleEscapeAction") === "tree") {
				runtime.ctx.showTreeSelector();
			} else {
				runtime.ctx.showUserMessageSelector();
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fork",
		description: "Create a new fork from a previous message",
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleForkCommand();
		},
	},
	{
		name: "tree",
		description: "Navigate session tree (switch branches)",
		handle: (_command, runtime) => {
			runtime.ctx.showTreeSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "login",
		description: "Login with OAuth provider",
		inlineHint: "[provider|redirect URL]",
		allowArgs: true,
		handle: (command, runtime) => {
			const manualInput = runtime.ctx.oauthManualInput;
			const args = command.args.trim();
			if (args.length > 0) {
				const matchedProvider = getOAuthProviders().find(provider => provider.id === args);
				if (matchedProvider) {
					if (manualInput.hasPending()) {
						const pendingProvider = manualInput.pendingProviderId;
						const message = pendingProvider
							? `OAuth login already in progress for ${pendingProvider}. Paste the redirect URL with /login <url>.`
							: "OAuth login already in progress. Paste the redirect URL with /login <url>.";
						runtime.ctx.showWarning(message);
						runtime.ctx.editor.setText("");
						return;
					}
					void runtime.ctx.showOAuthSelector("login", matchedProvider.id);
					runtime.ctx.editor.setText("");
					return;
				}
				const submitted = manualInput.submit(args);
				if (submitted) {
					runtime.ctx.showStatus("OAuth callback received; completing login…");
				} else {
					runtime.ctx.showWarning("No OAuth login is waiting for a manual callback.");
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (manualInput.hasPending()) {
				const provider = manualInput.pendingProviderId;
				const message = provider
					? `OAuth login already in progress for ${provider}. Paste the redirect URL with /login <url>.`
					: "OAuth login already in progress. Paste the redirect URL with /login <url>.";
				runtime.ctx.showWarning(message);
				runtime.ctx.editor.setText("");
				return;
			}

			void runtime.ctx.showOAuthSelector("login");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "logout",
		description: "Logout from OAuth provider",
		handle: (_command, runtime) => {
			void runtime.ctx.showOAuthSelector("logout");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "mcp",
		description: "Manage MCP servers (add, list, remove, test)",
		subcommands: [
			{
				name: "add",
				description: "Add a new MCP server",
				usage: "<name> [--scope project|user] [--url <url>] [-- <command...>]",
			},
			{ name: "list", description: "List all configured MCP servers" },
			{ name: "remove", description: "Remove an MCP server", usage: "<name> [--scope project|user]" },
			{ name: "test", description: "Test connection to a server", usage: "<name>" },
			{ name: "reauth", description: "Reauthorize OAuth for a server", usage: "<name>" },
			{ name: "unauth", description: "Remove OAuth auth from a server", usage: "<name>" },
			{ name: "enable", description: "Enable an MCP server", usage: "<name>" },
			{ name: "disable", description: "Disable an MCP server", usage: "<name>" },
			{
				name: "smithery-search",
				description: "Search Smithery registry and deploy an MCP server",
				usage: "<keyword> [--scope project|user] [--limit <1-100>] [--semantic]",
			},
			{ name: "smithery-login", description: "Login to Smithery and cache API key" },
			{ name: "smithery-logout", description: "Remove cached Smithery API key" },
			{ name: "reconnect", description: "Reconnect to a specific MCP server", usage: "<name>" },
			{ name: "reload", description: "Force reload MCP runtime tools" },
			{ name: "resources", description: "List available resources from connected servers" },
			{ name: "prompts", description: "List available prompts from connected servers" },
			{ name: "notifications", description: "Show notification capabilities and subscriptions" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMCPCommand(command.text);
		},
	},
	{
		name: "ssh",
		description: "Manage SSH hosts (add, list, remove)",
		subcommands: [
			{
				name: "add",
				description: "Add an SSH host",
				usage: "<name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>]",
			},
			{ name: "list", description: "List all configured SSH hosts" },
			{ name: "remove", description: "Remove an SSH host", usage: "<name> [--scope project|user]" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleSSHCommand(command.text);
		},
	},
	{
		name: "new",
		description: "Start a new session",
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleClearCommand();
		},
	},
	{
		name: "compact",
		description: "Manually compact the session context",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleCompactCommand(customInstructions);
		},
	},
	{
		name: "handoff",
		description: "Hand off session context to a new session",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleHandoffCommand(customInstructions);
		},
	},
	{
		name: "resume",
		description: "Resume a different session",
		handle: (_command, runtime) => {
			runtime.ctx.showSessionSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "btw",
		description: "Ask an ephemeral side question using the current session context",
		inlineHint: "<question>",
		allowArgs: true,
		handle: async (command, runtime) => {
			const question = command.text.slice(`/${command.name}`.length).trim();
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleBtwCommand(question);
		},
	},
	{
		name: "background",
		aliases: ["bg"],
		description: "Detach UI and continue running in background",
		handle: (_command, runtime) => {
			runtime.ctx.editor.setText("");
			runtime.handleBackgroundCommand();
		},
	},
	{
		name: "debug",
		description: "Open debug tools selector",
		handle: (_command, runtime) => {
			runtime.ctx.showDebugSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "memory",
		description: "Inspect and operate memory maintenance",
		subcommands: [
			{ name: "view", description: "Show current memory injection payload" },
			{ name: "clear", description: "Clear persisted memory data and artifacts" },
			{ name: "reset", description: "Alias for clear" },
			{ name: "enqueue", description: "Enqueue memory consolidation maintenance" },
			{ name: "rebuild", description: "Alias for enqueue" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMemoryCommand(command.text);
		},
	},
	{
		name: "rename",
		description: "Rename the current session",
		inlineHint: "<title>",
		allowArgs: true,
		handle: async (command, runtime) => {
			const title = command.args.trim();
			if (!title) {
				runtime.ctx.showError("Usage: /rename <title>");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleRenameCommand(title);
		},
	},

	{
		name: "move",
		description: "Move session to a different working directory",
		inlineHint: "<path>",
		allowArgs: true,
		handle: async (command, runtime) => {
			const targetPath = command.args;
			if (!targetPath) {
				runtime.ctx.showError("Usage: /move <path>");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMoveCommand(targetPath);
		},
	},
	{
		name: "exit",
		description: "Exit the application",
		handle: shutdownHandler,
	},
	{
		name: "plugin",
		aliases: ["marketplace", "plugins"],
		description: "Manage plugins and marketplace sources",
		subcommands: [
			{ name: "marketplace", description: "Manage marketplace sources (add, remove, update, list)" },
			{
				name: "install",
				description: "Install a plugin",
				usage: "[--force] [--scope user|project] <name@marketplace>",
			},
			{ name: "uninstall", description: "Uninstall a plugin", usage: "[--scope user|project] <name@marketplace>" },
			{ name: "enable", description: "Enable a plugin", usage: "[--scope user|project] <name@marketplace>" },
			{ name: "disable", description: "Disable a plugin", usage: "[--scope user|project] <name@marketplace>" },
			{ name: "upgrade", description: "Upgrade plugins", usage: "[--scope user|project] [name@marketplace]" },
			{ name: "discover", description: "Browse available plugins", usage: "[marketplace]" },
			{ name: "list", description: "List all installed plugins" },
			{ name: "validate", description: "Validate marketplace or plugin manifest", usage: "[path]" },
			{ name: "setup", description: "Guided setup for recommended plugins" },
			{ name: "help", description: "Show usage guide" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const args = command.args.trim().split(/\s+/);
			const sub = args[0] || "";
			const rest = args.slice(1).join(" ").trim();

			// /plugin (no args) → open interactive dashboard
			if (!sub) {
				runtime.ctx.showPluginDashboard();
				return;
			}

			// /plugin install (no args) → interactive browser
			if (sub === "install" && !rest) {
				try {
					runtime.ctx.showPluginSelector("install");
				} catch (err) {
					runtime.ctx.showStatus(`Plugin error: ${err}`);
				}
				return;
			}

			// /plugin list (no args) → open interactive dashboard
			if (sub === "list" && !rest) {
				runtime.ctx.showPluginDashboard();
				return;
			}

			// /plugin uninstall (no args) → interactive uninstall selector
			if (sub === "uninstall" && !rest) {
				try {
					runtime.ctx.showPluginSelector("uninstall");
				} catch (err) {
					runtime.ctx.showStatus(`Plugin error: ${err}`);
				}
				return;
			}

			const mgr = new MarketplaceManager({
				marketplacesRegistryPath: getMarketplacesRegistryPath(),
				installedRegistryPath: getInstalledPluginsRegistryPath(),
				projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(
					runtime.ctx.sessionManager.getCwd(),
				),
				marketplacesCacheDir: getMarketplacesCacheDir(),
				pluginsCacheDir: getPluginsCacheDir(),
				clearPluginRootsCache: (extraPaths?: readonly string[]) => {
					const home = os.homedir();
					invalidateFsCache(path.join(home, getConfigDirName(), "plugins", "installed_plugins.json"));
					for (const p of extraPaths ?? []) invalidateFsCache(p);
					clearXcshPluginRootsCache();
				},
			});

			try {
				switch (sub) {
					// ── Marketplace management (/plugin marketplace add|remove|update|list) ──
					case "marketplace": {
						const mktArgs = rest.split(/\s+/);
						const mktSub = mktArgs[0] || "";
						const mktRest = mktArgs.slice(1).join(" ").trim();
						switch (mktSub) {
							case "add": {
								if (!mktRest) {
									runtime.ctx.showStatus("Usage: /plugin marketplace add <source>");
									return;
								}
								const entry = await mgr.addMarketplace(mktRest);
								runtime.ctx.showStatus(`Added marketplace: ${entry.name}`);
								break;
							}
							case "remove":
							case "rm": {
								if (!mktRest) {
									runtime.ctx.showStatus("Usage: /plugin marketplace remove <name>");
									return;
								}
								await mgr.removeMarketplace(mktRest);
								runtime.ctx.showStatus(`Removed marketplace: ${mktRest}`);
								break;
							}
							case "update": {
								if (mktRest) {
									await mgr.updateMarketplace(mktRest);
									runtime.ctx.showStatus(`Updated marketplace: ${mktRest}`);
								} else {
									const results = await mgr.updateAllMarketplaces();
									runtime.ctx.showStatus(`Updated ${results.length} marketplace(s)`);
								}
								break;
							}
							default: {
								const marketplaces = await mgr.listMarketplaces();
								if (marketplaces.length === 0) {
									runtime.ctx.showStatus(
										"No marketplaces configured.\n\nGet started:\n  /plugin marketplace add f5xc-salesdemos/marketplace",
									);
								} else {
									const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
									runtime.ctx.showStatus(
										`Marketplaces:\n${lines.join("\n")}\n\nUse /plugin discover to browse plugins`,
									);
								}
								break;
							}
						}
						break;
					}
					// ── Legacy shorthand: /marketplace add|remove|update → /plugin marketplace ──
					case "add": {
						if (!rest) {
							runtime.ctx.showStatus("Usage: /plugin marketplace add <source>");
							return;
						}
						const entry = await mgr.addMarketplace(rest);
						runtime.ctx.showStatus(`Added marketplace: ${entry.name}`);
						break;
					}
					case "remove":
					case "rm": {
						if (!rest) {
							runtime.ctx.showStatus("Usage: /plugin marketplace remove <name>");
							return;
						}
						await mgr.removeMarketplace(rest);
						runtime.ctx.showStatus(`Removed marketplace: ${rest}`);
						break;
					}
					case "update": {
						if (rest) {
							await mgr.updateMarketplace(rest);
							runtime.ctx.showStatus(`Updated marketplace: ${rest}`);
						} else {
							const results = await mgr.updateAllMarketplaces();
							runtime.ctx.showStatus(`Updated ${results.length} marketplace(s)`);
						}
						break;
					}
					// ── Plugin discovery ──
					case "discover": {
						const plugins = await mgr.listAvailablePlugins(rest || undefined);
						if (plugins.length === 0) {
							const marketplaces = await mgr.listMarketplaces();
							if (marketplaces.length === 0) {
								runtime.ctx.showStatus(
									"No marketplaces configured. Try:\n  /plugin marketplace add f5xc-salesdemos/marketplace",
								);
							} else {
								runtime.ctx.showStatus("No plugins available in configured marketplaces");
							}
						} else {
							const lines = plugins.map(
								p =>
									`  ${p.name}${p.version ? `@${p.version}` : ""}${p.description ? ` - ${p.description}` : ""}`,
							);
							runtime.ctx.showStatus(`Available plugins:\n${lines.join("\n")}`);
						}
						break;
					}
					// ── Install ──
					case "install": {
						const parsed = parseMarketplaceInstallArgs(rest);
						if ("error" in parsed) {
							runtime.ctx.showStatus(parsed.error);
							return;
						}
						const atIdx = parsed.installSpec.lastIndexOf("@");
						const name = parsed.installSpec.slice(0, atIdx);
						const marketplace = parsed.installSpec.slice(atIdx + 1);
						await mgr.installPlugin(name, marketplace, { force: parsed.force, scope: parsed.scope });
						runtime.ctx.showStatus(`Installed ${name} from ${marketplace}`);
						break;
					}
					// ── Uninstall ──
					case "uninstall": {
						const uninstArgs = parsePluginScopeArgs(
							rest,
							"Usage: /plugin uninstall [--scope user|project] <name@marketplace>",
						);
						if ("error" in uninstArgs) {
							runtime.ctx.showStatus(uninstArgs.error);
							return;
						}
						await mgr.uninstallPlugin(uninstArgs.pluginId, uninstArgs.scope);
						runtime.ctx.showStatus(`Uninstalled ${uninstArgs.pluginId}`);
						break;
					}
					// ── Enable / Disable ──
					case "enable":
					case "disable": {
						const parsed = parsePluginScopeArgs(
							rest ?? "",
							`Usage: /plugin ${sub} [--scope user|project] <name@marketplace>`,
						);
						if ("error" in parsed) {
							runtime.ctx.showStatus(parsed.error);
							return;
						}
						const isEnable = sub === "enable";
						await mgr.setPluginEnabled(parsed.pluginId, isEnable, parsed.scope);
						runtime.ctx.showStatus(`${isEnable ? "Enabled" : "Disabled"} ${parsed.pluginId}`);
						break;
					}
					// ── Upgrade ──
					case "upgrade": {
						if (rest) {
							const upArgs = parsePluginScopeArgs(
								rest,
								"Usage: /plugin upgrade [--scope user|project] <name@marketplace>",
							);
							if ("error" in upArgs) {
								runtime.ctx.showStatus(upArgs.error);
								return;
							}
							const result = await mgr.upgradePlugin(upArgs.pluginId, upArgs.scope);
							runtime.ctx.showStatus(`Upgraded ${upArgs.pluginId} to ${result.version}`);
						} else {
							const results = await mgr.upgradeAllPlugins();
							if (results.length === 0) {
								runtime.ctx.showStatus("All plugins are up to date");
							} else {
								const lines = results.map(r => `  ${r.pluginId}: ${r.from} -> ${r.to}`);
								runtime.ctx.showStatus(`Upgraded ${results.length} plugin(s):\n${lines.join("\n")}`);
							}
						}
						break;
					}
					// ── Installed list ──
					case "installed": {
						const lines: string[] = [];
						const npm = new PluginManager();
						const npmPlugins = await npm.list();
						if (npmPlugins.length > 0) {
							lines.push("npm plugins:");
							for (const p of npmPlugins) {
								const status = p.enabled === false ? " (disabled)" : "";
								lines.push(`  ${p.name}@${p.version}${status}`);
							}
						}
						const mktPlugins = await mgr.listInstalledPlugins();
						if (mktPlugins.length > 0) {
							if (lines.length > 0) lines.push("");
							lines.push("marketplace plugins:");
							for (const p of mktPlugins) {
								const entry = p.entries[0];
								const status = entry?.enabled === false ? " (disabled)" : "";
								const shadowed = p.shadowedBy ? " [shadowed]" : "";
								lines.push(`  ${p.id} v${entry?.version ?? "?"}${status} [${p.scope}]${shadowed}`);
							}
						}
						if (lines.length === 0) {
							runtime.ctx.showStatus("No plugins installed");
						} else {
							runtime.ctx.showStatus(lines.join("\n"));
						}
						break;
					}
					// ── Validate ──
					case "validate": {
						const targetPath = rest
							? path.resolve(runtime.ctx.sessionManager.getCwd(), rest)
							: runtime.ctx.sessionManager.getCwd();
						const catalogPath = path.join(targetPath, ".xcsh-plugin", "marketplace.json");
						const pluginPath = path.join(targetPath, ".xcsh-plugin", "plugin.json");
						const { existsSync } = await import("node:fs");
						if (existsSync(catalogPath)) {
							const { parseMarketplaceCatalog } = await import("../extensibility/plugins/marketplace/fetcher");
							const content = await Bun.file(catalogPath).text();
							const catalog = parseMarketplaceCatalog(content, catalogPath);
							runtime.ctx.showStatus(
								`Marketplace "${catalog.name}" is valid (${catalog.plugins.length} plugin(s))`,
							);
						} else if (existsSync(pluginPath)) {
							const content = await Bun.file(pluginPath).text();
							const manifest = JSON.parse(content);
							runtime.ctx.showStatus(`Plugin "${manifest.name ?? path.basename(targetPath)}" manifest is valid`);
						} else {
							runtime.ctx.showStatus(
								`No .xcsh-plugin/marketplace.json or .xcsh-plugin/plugin.json found at ${targetPath}`,
							);
						}
						break;
					}
					// ── Setup (guided recommended plugin install) ──
					case "setup": {
						const { setupTool } = await import("../extensibility/plugins/marketplace/prerequisites");
						const allPlugins = await mgr.listAvailablePlugins();
						const recommended = allPlugins.filter(p => p.recommended);
						if (recommended.length === 0) {
							runtime.ctx.showStatus("No recommended plugins found in configured marketplaces");
							break;
						}

						const installedPlugins = await mgr.listInstalledPlugins();
						const installedIds = new Set(installedPlugins.map(p => p.id));
						const toSetup = recommended.filter(
							p => !Array.from(installedIds).some(id => id.startsWith(`${p.name}@`)),
						);

						if (toSetup.length === 0) {
							runtime.ctx.showStatus("All recommended plugins are already installed");
							break;
						}

						const lines: string[] = ["Recommended plugins setup:\n"];
						let pluginInstalledCount = 0;
						let skippedCount = 0;

						for (const plugin of toSetup) {
							const name = plugin.displayName || plugin.name;

							// Step 1: Setup prerequisites (detect → install → auth)
							if (plugin.prerequisites && plugin.prerequisites.length > 0) {
								let allReady = true;
								for (const prereq of plugin.prerequisites) {
									const result = await setupTool(prereq);

									if (!result.installSuccess && result.installAttempted) {
										lines.push(`  x ${name} — ${prereq.tool}: install failed (${result.error})`);
										lines.push(`    Fix: ${prereq.installCmd}`);
										allReady = false;
										break;
									}

									if (result.installAttempted && result.installSuccess) {
										lines.push(`  + ${name} — ${prereq.tool}: installed`);
									}

									if (!result.authenticated && prereq.authLoginCmd) {
										lines.push(`  ~ ${name} — ${prereq.tool}: not authenticated`);
										lines.push(`    Run: ${prereq.authLoginCmd}`);
									} else if (result.authenticated && result.user) {
										lines.push(`  ✓ ${name} — ${prereq.tool}: authenticated as ${result.user}`);
									} else if (result.authenticated) {
										lines.push(`  ✓ ${name} — ${prereq.tool}: ready`);
									}
								}
								if (!allReady) {
									skippedCount++;
									continue;
								}
							}

							// Step 2: Install the plugin
							const marketplaces = await mgr.listMarketplaces();
							let didInstall = false;
							for (const mkt of marketplaces) {
								const available = await mgr.listAvailablePlugins(mkt.name);
								if (available.some(a => a.name === plugin.name)) {
									try {
										await mgr.installPlugin(plugin.name, mkt.name);
										lines.push(`  ✓ ${name} — plugin installed`);
										pluginInstalledCount++;
										didInstall = true;
									} catch (err) {
										lines.push(
											`  ! ${name} — plugin install failed: ${err instanceof Error ? err.message : String(err)}`,
										);
										skippedCount++;
									}
									break;
								}
							}
							if (!didInstall && skippedCount === 0) {
								lines.push(`  ? ${name} — not found in any marketplace`);
								skippedCount++;
							}
						}

						lines.push("");
						lines.push(`Installed ${pluginInstalledCount}/${toSetup.length} recommended plugin(s)`);
						if (skippedCount > 0) {
							lines.push(`${skippedCount} skipped — fix issues above and run /plugin setup again (idempotent)`);
						}
						runtime.ctx.showStatus(lines.join("\n"));
						break;
					}
					// ── Help ──
					case "help": {
						runtime.ctx.showStatus(
							[
								"Plugin commands:",
								"  /plugin                                    Open plugin dashboard",
								"  /plugin marketplace add <source>           Add a marketplace (e.g. owner/repo)",
								"  /plugin marketplace remove <name>          Remove a marketplace",
								"  /plugin marketplace update [name]          Re-fetch catalog(s)",
								"  /plugin marketplace list                   List configured marketplaces",
								"  /plugin discover [marketplace]             Browse available plugins",
								"  /plugin install <name@marketplace>         Install a plugin",
								"  /plugin uninstall <name@marketplace>       Uninstall a plugin",
								"  /plugin enable <name@marketplace>          Enable a plugin",
								"  /plugin disable <name@marketplace>         Disable a plugin",
								"  /plugin upgrade [name@marketplace]         Upgrade plugin(s)",
								"  /plugin list                               List installed plugins",
								"  /plugin validate [path]                    Validate marketplace or plugin",
								"  /plugin setup                              Guided setup for recommended plugins",
								"",
								"Quick start:",
								"  /plugin marketplace add f5xc-salesdemos/marketplace",
								"  /plugin                                    (opens plugin dashboard)",
								"",
								"Aliases: /marketplace, /plugins",
							].join("\n"),
						);
						break;
					}
					default: {
						const marketplaces = await mgr.listMarketplaces();
						if (marketplaces.length === 0) {
							runtime.ctx.showStatus(
								"No marketplaces configured.\n\nGet started:\n  /plugin marketplace add f5xc-salesdemos/marketplace\n\nThen browse plugins with /plugin or /plugin discover",
							);
						} else {
							const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
							runtime.ctx.showStatus(
								`Marketplaces:\n${lines.join("\n")}\n\nUse /plugin discover to browse plugins, or /plugin help for all commands`,
							);
						}
						break;
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				runtime.ctx.showStatus(`Plugin error: ${msg}`);
			}
		},
	},
	{
		name: "reload-plugins",
		description: "Reload all plugins (skills, commands, hooks, tools, agents, MCP)",
		handle: async (_command, runtime) => {
			// Invalidate the fs content cache for all registry files so
			// listXcshPluginRoots re-reads from disk on next access.
			const home = os.homedir();
			invalidateFsCache(path.join(home, getConfigDirName(), "plugins", "installed_plugins.json"));
			const projectPath = await resolveActiveProjectRegistryPath(runtime.ctx.sessionManager.getCwd());
			if (projectPath) invalidateFsCache(projectPath);
			clearXcshPluginRootsCache();
			await runtime.ctx.refreshSlashCommandState();
			runtime.ctx.showStatus("Plugins reloaded.");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "force",
		description: "Force next turn to use a specific tool",
		inlineHint: "<tool-name> [prompt]",
		allowArgs: true,
		handle: (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();

			if (!toolName) {
				runtime.ctx.showError("Usage: /force:<tool-name> [prompt]");
				runtime.ctx.editor.setText("");
				return;
			}

			try {
				runtime.ctx.session.setForcedToolChoice(toolName);
				runtime.ctx.showStatus(`Next turn forced to use ${toolName}.`);
			} catch (error) {
				runtime.ctx.showError(error instanceof Error ? error.message : String(error));
				runtime.ctx.editor.setText("");
				return;
			}

			runtime.ctx.editor.setText("");

			// If a prompt was provided, pass it through as input
			if (prompt) return prompt;
		},
	},
	{
		name: "quit",
		description: "Quit the application",
		handle: shutdownHandler,
	},
	{
		name: "context",
		description: "Manage F5 XC authentication contexts",
		allowArgs: true,
		getArgumentCompletions(argumentPrefix: string) {
			const firstSpace = argumentPrefix.indexOf(" ");
			if (firstSpace !== -1) {
				const subName = argumentPrefix.slice(0, firstSpace).toLowerCase();
				const subPrefix = argumentPrefix.slice(firstSpace + 1).replace(/^ +/, "");
				const sub = CONTEXT_SUBCOMMANDS.find(s => s.name === subName);
				if (!sub?.getArgumentCompletions) return null;
				const items = sub.getArgumentCompletions(subPrefix);
				if (!items || items.length === 0) return null;
				return items.map(item => ({ ...item, value: `${subName} ${item.value}` }));
			}
			const lower = argumentPrefix.toLowerCase();
			const items: { value: string; label: string; description?: string; hint?: string }[] = [];
			const svc = tryGetContextService();
			if (svc) {
				for (const n of svc.listContextNamesCached()) {
					if (!n.toLowerCase().startsWith(lower)) continue;
					const hint = svc.getContextHint(n);
					items.push({
						value: `${n} `,
						label: n,
						description: hint?.apiUrl,
					});
				}
				if (svc.previousContextName && "-".startsWith(lower)) {
					items.push({
						value: "- ",
						label: "-",
						description: `Switch to ${svc.previousContextName}`,
					});
				}
			}
			for (const sub of CONTEXT_SUBCOMMANDS) {
				if (!sub.name.toLowerCase().startsWith(lower)) continue;
				items.push({
					value: `${sub.name} `,
					label: sub.name,
					description: sub.description,
					hint: sub.usage,
				});
			}
			return items.length > 0 ? items : null;
		},
		subcommands: CONTEXT_SUBCOMMANDS,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			const { ContextCommandController } = await import("../modes/controllers/context-command-controller");
			const controller = new ContextCommandController(runtime.ctx);
			await controller.handle(command);
		},
	},
];

const BUILTIN_SLASH_COMMAND_LOOKUP = new Map<string, BuiltinSlashCommandSpec>();
for (const command of BUILTIN_SLASH_COMMAND_REGISTRY) {
	BUILTIN_SLASH_COMMAND_LOOKUP.set(command.name, command);
	for (const alias of command.aliases ?? []) {
		BUILTIN_SLASH_COMMAND_LOOKUP.set(alias, command);
	}
}

/** Builtin command metadata used for slash-command autocomplete and help text. */
export const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_REGISTRY.map(
	command => ({
		name: command.name,
		description: command.description,
		subcommands: command.subcommands,
		inlineHint: command.inlineHint,
		getArgumentCompletions: command.getArgumentCompletions,
	}),
);

/**
 * Execute a builtin slash command when it matches known command syntax.
 *
 * Returns `false` when no builtin matched. Returns `true` when a command consumed
 * the input entirely. Returns a `string` when the command was handled but remaining
 * text should be sent as a prompt.
 */
export async function executeBuiltinSlashCommand(
	text: string,
	runtime: BuiltinSlashCommandRuntime,
): Promise<string | boolean> {
	const parsed = parseBuiltinSlashCommand(text);
	if (!parsed) return false;

	const command = BUILTIN_SLASH_COMMAND_LOOKUP.get(parsed.name);
	if (!command) return false;
	if (parsed.args.length > 0 && !command.allowArgs) {
		return false;
	}

	const remaining = await command.handle(parsed, runtime);
	return remaining ?? true;
}
