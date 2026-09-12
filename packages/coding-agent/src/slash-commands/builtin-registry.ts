import * as os from "node:os";
import * as path from "node:path";

import type { AutocompleteItem } from "@f5-sales-demo/pi-tui";
import { getConfigDirName, isEnoent, t } from "@f5-sales-demo/pi-utils";
import { clearCache as clearCapabilityFsCache, invalidate as invalidateFsCache } from "../capability/fs";
import { parseModelString } from "../config/model-resolver";
import {
	clearXcshPluginRootsCache,
	resolveActiveProjectRegistryPath,
	resolveOrDefaultProjectRegistryPath,
} from "../discovery/helpers.js";
import { PluginManager } from "../extensibility/plugins";
import {
	formatMarketplaceRefreshWarning,
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../extensibility/plugins/marketplace";
import { parseMarketplaceCatalog } from "../extensibility/plugins/marketplace/fetcher";
import { BorderedLoader } from "../modes/components/bordered-loader";
import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import { getLoginOptions } from "../modes/controllers/login-options";
import { theme } from "../modes/theme/theme";
import type { InteractiveModeContext } from "../modes/types";
import { ContextService } from "../services/xcsh-context";
import { handleFastCommand } from "./fast-command";
import { parseMarketplaceInstallArgs, parsePluginScopeArgs } from "./marketplace-install-parser";
import {
	executeMarketplaceAddition,
	executePluginInstall,
	executePluginSetup,
	executePluginUpgrade,
	executePluginUpgradeAll,
	prepareMarketplaceAddition,
	prepareMarketplaceRemoval,
	preparePluginEnabled,
	preparePluginInstall,
	preparePluginRemoval,
	preparePluginSetup,
	preparePluginUpgrade,
	preparePluginUpgradeAll,
} from "./plugin-reviewed-actions";

const forceSelectors = new WeakSet<InteractiveModeContext>();
const routeReviews = new WeakSet<InteractiveModeContext>();
const pluginMetadataRefreshes = new WeakSet<InteractiveModeContext>();
const unresolvedRouteSaves = new WeakSet<InteractiveModeContext["settings"]>();
const pendingProfileSaves = new WeakMap<
	InteractiveModeContext["session"],
	{
		settings: InteractiveModeContext["settings"];
		profile: string;
		sessionId: string;
		revision: string;
		roles: Record<string, string>;
	}
>();

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
	try {
		return await Bun.file(filePath).text();
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

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

interface ShutdownSnapshot {
	sessionId: string;
	streaming: boolean;
	compacting: boolean;
	handoff: boolean;
	bash: boolean;
	python: boolean;
	queued: number;
	asyncJobs: string[];
}

function inspectShutdown(ctx: InteractiveModeContext): ShutdownSnapshot {
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		streaming: ctx.session.isStreaming,
		compacting: ctx.session.isCompacting,
		handoff: ctx.session.isGeneratingHandoff,
		bash: ctx.session.isBashRunning,
		python: ctx.session.isPythonRunning,
		queued: ctx.session.queuedMessageCount,
		asyncJobs: (ctx.session.getAsyncJobSnapshot()?.running ?? []).map(job => job.id).sort(),
	};
}

function hasOutstandingShutdownWork(snapshot: ShutdownSnapshot): boolean {
	return (
		snapshot.streaming ||
		snapshot.compacting ||
		snapshot.handoff ||
		snapshot.bash ||
		snapshot.python ||
		snapshot.queued > 0 ||
		snapshot.asyncJobs.length > 0
	);
}

function shutdownReview(snapshot: ShutdownSnapshot): ActionReview {
	const changes: ActionReview["changes"] = [
		...(snapshot.streaming ? [{ field: "Active response", before: "Running", after: "Interrupt" }] : []),
		...(snapshot.compacting ? [{ field: "Compaction", before: "Running", after: "Interrupt" }] : []),
		...(snapshot.handoff ? [{ field: "Handoff", before: "Running", after: "Interrupt" }] : []),
		...(snapshot.bash ? [{ field: "Shell command", before: "Running", after: "Interrupt" }] : []),
		...(snapshot.python ? [{ field: "Python execution", before: "Running", after: "Interrupt" }] : []),
		...(snapshot.queued > 0
			? [
					{
						field: "Queued prompts",
						before: String(snapshot.queued),
						after: "Discard",
					},
				]
			: []),
		...(snapshot.asyncJobs.length > 0
			? [
					{
						field: "Non-cancellable async jobs",
						before: `${snapshot.asyncJobs.length} (${snapshot.asyncJobs.join(", ")})`,
						after: "Wait for completion",
					},
				]
			: []),
		{ field: "Process", before: "Running", after: "Exit after settlement" },
	];
	return {
		identity: `session:${snapshot.sessionId}`,
		scope: "Current xcsh process · current session",
		revision: JSON.stringify(snapshot),
		changes,
		consequence:
			"Interrupts supported foreground work, discards queued prompts, waits for non-cancellable async jobs, flushes session state, then exits. Use /background instead to keep the active response running.",
	};
}

async function settleWorkBeforeShutdown(ctx: InteractiveModeContext): Promise<void> {
	const session = ctx.session;
	session.clearQueue();
	session.abortCompaction();
	session.abortHandoff();
	session.abortBash();
	session.abortPython();
	if (session.isStreaming) await session.abort();
	while (
		session.isStreaming ||
		session.isCompacting ||
		session.isGeneratingHandoff ||
		session.isBashRunning ||
		session.isPythonRunning
	)
		await Bun.sleep(10);
	while ((session.getAsyncJobSnapshot()?.running.length ?? 0) > 0) await Bun.sleep(25);
}

const shutdownHandler = async (
	_command: ParsedBuiltinSlashCommand,
	runtime: BuiltinSlashCommandRuntime,
): Promise<void> => {
	const ctx = runtime.ctx;
	ctx.editor.setText("");
	const initial = inspectShutdown(ctx);
	if (!hasOutstandingShutdownWork(initial)) {
		await ctx.shutdown();
		return;
	}

	const session = ctx.session;
	const manager = ctx.sessionManager;
	const outcome = await runReviewedAction(ctx, "exit session", {
		review: shutdownReview(initial),
		resolve: async () => {
			if (ctx.session !== session || ctx.sessionManager !== manager) return undefined;
			const current = inspectShutdown(ctx);
			if (current.sessionId !== initial.sessionId) return undefined;
			return { review: shutdownReview(current), target: ctx };
		},
		execute: settleWorkBeforeShutdown,
	});
	if (outcome === "busy") ctx.showStatus("Another reviewed action is already open.");
	else if (outcome === "succeeded") await ctx.shutdown();
};

const CONTEXT_SUBCOMMANDS: SubcommandDef[] = [
	{ name: "list", description: t("commands.context.sub.list.description") },
	{
		name: "activate",
		description: t("commands.context.sub.activate.description"),
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
		description: t("commands.context.sub.validate.description"),
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
		name: "show",
		description: t("commands.context.sub.show.description"),
		usage: "[name]",
	},
	{ name: "status", description: t("commands.context.sub.status.description") },
	{
		name: "create",
		description: t("commands.context.sub.create.description"),
		usage: "<name> <url> <token> [namespace]",
	},
	{
		name: "delete",
		description: t("commands.context.sub.delete.description"),
		usage: "<name> --confirm",
	},
	{
		name: "rename",
		description: t("commands.context.sub.rename.description"),
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
		description: t("commands.context.sub.export.description"),
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
		description: t("commands.context.sub.import.description"),
		usage: "<path-or-json> [--overwrite]",
		// No dynamic completion — paths are hard to complete correctly,
		// and faking it would only mislead. Users pre-expand paths in
		// their shell.
	},
	{
		name: "namespace",
		description: t("commands.context.sub.namespace.description"),
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
	{
		name: "link",
		description: "Link a project to a saved global context",
		usage: "<global-context-name>",
	},
	{ name: "unlink", description: "Remove the project's local context link" },
	{
		name: "env",
		description: t("commands.context.sub.env.description"),
		usage: "set|unset|list [KEY=VALUE ...]",
	},
	{
		name: "set",
		description: t("commands.context.sub.set.description"),
		usage: "KEY=VALUE [KEY2=VALUE2 ...]",
	},
	{
		name: "unset",
		description: t("commands.context.sub.unset.description"),
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
	{ name: "wizard", description: t("commands.context.sub.wizard.description") },
];

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<BuiltinSlashCommandSpec> = [
	{
		name: "settings",
		description: t("commands.settings.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "plan",
		description: t("commands.plan.description"),
		inlineHint: t("commands.plan.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handlePlanModeCommand(command.args || undefined);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "model",
		aliases: ["models"],
		description: t("commands.model.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showModelSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fast",
		description: t("commands.fast.description"),
		subcommands: [
			{ name: "on", description: t("commands.fast.sub.on.description") },
			{ name: "off", description: t("commands.fast.sub.off.description") },
			{
				name: "status",
				description: t("commands.fast.sub.status.description"),
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			await handleFastCommand(runtime.ctx, command.args);
		},
	},
	{
		name: "export",
		description: t("commands.export.description"),
		inlineHint: t("commands.export.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handleExportCommand(command.text);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "dump",
		description: t("commands.dump.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleDumpCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "share",
		description: t("commands.share.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleShareCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "browser",
		description: t("commands.browser.description"),
		subcommands: [
			{
				name: "status",
				description: "Show user-default and effective browser settings",
			},
			{
				name: "headless",
				description: t("commands.browser.sub.headless.description"),
			},
			{
				name: "visible",
				description: t("commands.browser.sub.visible.description"),
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const { handleBrowserModeCommand } = await import("./browser-command");
			await handleBrowserModeCommand(runtime.ctx, command.args);
		},
	},
	{
		name: "chrome",
		description: t("commands.chrome.description"),
		subcommands: [
			{
				name: "status",
				description: t("commands.chrome.sub.status.description"),
			},
			{
				name: "relaunch",
				description: t("commands.chrome.sub.relaunch.description"),
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const { handleChromeCommand } = await import("./browser-command");
			await handleChromeCommand(runtime.ctx, command.args);
		},
	},
	{
		name: "copy",
		description: t("commands.copy.description"),
		subcommands: [
			{ name: "last", description: t("commands.copy.sub.last.description") },
			{ name: "code", description: t("commands.copy.sub.code.description") },
			{ name: "all", description: t("commands.copy.sub.all.description") },
			{ name: "cmd", description: t("commands.copy.sub.cmd.description") },
			{ name: "link", description: t("commands.copy.sub.link.description") },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const sub = command.args.trim().toLowerCase() || undefined;
			await runtime.ctx.handleCopyCommand(sub);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "open",
		description: t("commands.open.description"),
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handleOpenCommand(command.args);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "session",
		description: t("commands.session.description"),
		subcommands: [
			{ name: "info", description: t("commands.session.sub.info.description") },
			{
				name: "delete",
				description: t("commands.session.sub.delete.description"),
			},
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
		description: t("commands.jobs.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleJobsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "usage",
		description: t("commands.usage.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleUsageCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "changelog",
		description: t("commands.changelog.description"),
		subcommands: [
			{
				name: "full",
				description: t("commands.changelog.sub.full.description"),
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const args = command.args.split(/\s+/).filter(Boolean);
			if (args.length > 1 || (args.length === 1 && args[0].toLowerCase() !== "full")) {
				runtime.ctx.showError("Usage: /changelog [full]");
				runtime.ctx.editor.setText("");
				return;
			}
			const showFull = args.length === 1;
			await runtime.ctx.handleChangelogCommand(showFull);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "hotkeys",
		description: t("commands.hotkeys.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleHotkeysCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tools",
		description: t("commands.tools.description"),
		handle: async (_command, runtime) => {
			await runtime.ctx.handleToolsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "extensions",
		aliases: ["status"],
		description: t("commands.extensions.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showExtensionsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "agents",
		description: t("commands.agents.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showAgentsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "branch",
		description: t("commands.branch.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showUserMessageSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fork",
		description: t("commands.fork.description"),
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleForkCommand();
		},
	},
	{
		name: "tree",
		description: t("commands.tree.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showTreeSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "login",
		description: t("commands.login.description"),
		inlineHint: t("commands.login.inlineHint"),
		allowArgs: true,
		handle: (command, runtime) => {
			const manualInput = runtime.ctx.oauthManualInput;
			const args = command.args.trim();
			if (args.length > 0) {
				const matchedProvider = getLoginOptions().find(provider => provider.id === args);
				if (matchedProvider) {
					if (manualInput.hasPending()) {
						const pendingProvider = manualInput.pendingProviderId;
						const message = pendingProvider
							? t("commands.login.alreadyInProgressFor", {
									provider: pendingProvider,
								})
							: t("commands.login.alreadyInProgress");
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
					runtime.ctx.showStatus(t("commands.login.callbackReceived"));
				} else {
					runtime.ctx.showWarning(t("commands.login.noCallbackWaiting"));
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (manualInput.hasPending()) {
				const provider = manualInput.pendingProviderId;
				const message = provider
					? t("commands.login.alreadyInProgressFor", { provider })
					: t("commands.login.alreadyInProgress");
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
		description: t("commands.logout.description"),
		handle: (_command, runtime) => {
			void runtime.ctx.showOAuthSelector("logout");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "mcp",
		description: t("commands.mcp.description"),
		subcommands: [
			{
				name: "add",
				description: t("commands.mcp.sub.add.description"),
				usage: "<name> [--scope project|user] [--url <url>] [-- <command...>]",
			},
			{ name: "list", description: t("commands.mcp.sub.list.description") },
			{
				name: "remove",
				description: t("commands.mcp.sub.remove.description"),
				usage: "<name> [--scope project|user]",
			},
			{
				name: "test",
				description: t("commands.mcp.sub.test.description"),
				usage: "<name>",
			},
			{
				name: "reauth",
				description: t("commands.mcp.sub.reauth.description"),
				usage: "<name>",
			},
			{
				name: "unauth",
				description: t("commands.mcp.sub.unauth.description"),
				usage: "<name>",
			},
			{
				name: "enable",
				description: t("commands.mcp.sub.enable.description"),
				usage: "<name>",
			},
			{
				name: "disable",
				description: t("commands.mcp.sub.disable.description"),
				usage: "<name>",
			},
			{
				name: "smithery-search",
				description: t("commands.mcp.sub.smitherySearch.description"),
				usage: "<keyword> [--scope project|user] [--limit <1-100>] [--semantic]",
			},
			{
				name: "smithery-login",
				description: t("commands.mcp.sub.smitheryLogin.description"),
			},
			{
				name: "smithery-logout",
				description: t("commands.mcp.sub.smitheryLogout.description"),
			},
			{
				name: "reconnect",
				description: t("commands.mcp.sub.reconnect.description"),
				usage: "<name>",
			},
			{ name: "reload", description: t("commands.mcp.sub.reload.description") },
			{
				name: "resources",
				description: t("commands.mcp.sub.resources.description"),
			},
			{
				name: "prompts",
				description: t("commands.mcp.sub.prompts.description"),
			},
			{
				name: "notifications",
				description: t("commands.mcp.sub.notifications.description"),
			},
			{ name: "help", description: t("commands.mcp.sub.help.description") },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(
				/^\/mcp\s+add\b.*(?:^|\s)--token(?:\s|=)/i.test(command.text) ? "/mcp add" : command.text,
			);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMCPCommand(command.text);
		},
	},
	{
		name: "ssh",
		description: t("commands.ssh.description"),
		subcommands: [
			{
				name: "add",
				description: t("commands.ssh.sub.add.description"),
				usage: "<name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>]",
			},
			{ name: "list", description: t("commands.ssh.sub.list.description") },
			{
				name: "remove",
				description: t("commands.ssh.sub.remove.description"),
				usage: "<name> [--scope project|user]",
			},
			{ name: "help", description: t("commands.ssh.sub.help.description") },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleSSHCommand(command.text);
		},
	},
	{
		name: "media",
		description: "Control rich-media playback",
		subcommands: [
			{ name: "play", description: "Play media", usage: "<latest|id>" },
			{ name: "pause", description: "Pause media", usage: "<latest|id>" },
			{
				name: "stop",
				description: "Stop and reset media",
				usage: "<latest|id>",
			},
		],
		allowArgs: true,
		handle: (command, runtime) => {
			runtime.ctx.editor.setText("");
			runtime.ctx.handleMediaCommand(command.text);
		},
	},
	{
		name: "new",
		description: t("commands.new.description"),
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleClearCommand();
		},
	},
	{
		name: "compact",
		description: t("commands.compact.description"),
		inlineHint: t("commands.compact.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleCompactCommand(customInstructions);
		},
	},
	{
		name: "handoff",
		description: t("commands.handoff.description"),
		inlineHint: t("commands.handoff.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleHandoffCommand(customInstructions);
		},
	},
	{
		name: "resume",
		description: t("commands.resume.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showSessionSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "btw",
		description: t("commands.btw.description"),
		inlineHint: t("commands.btw.inlineHint"),
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
		description: t("commands.background.description"),
		handle: (_command, runtime) => {
			runtime.ctx.editor.setText("");
			runtime.handleBackgroundCommand();
		},
	},
	{
		name: "debug",
		description: t("commands.debug.description"),
		handle: (_command, runtime) => {
			runtime.ctx.showDebugSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "memory",
		description: t("commands.memory.description"),
		subcommands: [
			{ name: "view", description: t("commands.memory.sub.view.description") },
			{
				name: "clear",
				description: t("commands.memory.sub.clear.description"),
			},
			{
				name: "reset",
				description: t("commands.memory.sub.reset.description"),
			},
			{
				name: "enqueue",
				description: t("commands.memory.sub.enqueue.description"),
			},
			{
				name: "rebuild",
				description: t("commands.memory.sub.rebuild.description"),
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMemoryCommand(command.text);
		},
	},
	{
		name: "rename",
		description: t("commands.rename.description"),
		inlineHint: t("commands.rename.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			const title = command.args.trim();
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleRenameCommand(title);
		},
	},

	{
		name: "move",
		description: t("commands.move.description"),
		inlineHint: t("commands.move.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			const targetPath = command.args;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMoveCommand(targetPath);
		},
	},
	{
		name: "exit",
		description: t("commands.exit.description"),
		handle: shutdownHandler,
	},
	{
		name: "plugin",
		aliases: ["marketplace", "plugins"],
		description: t("commands.plugin.description"),
		subcommands: [
			{
				name: "marketplace",
				description: t("commands.plugin.sub.marketplace.description"),
			},
			{
				name: "install",
				description: t("commands.plugin.sub.install.description"),
				usage: "[--force] [--scope user|project] <name@marketplace>",
			},
			{
				name: "uninstall",
				description: t("commands.plugin.sub.uninstall.description"),
				usage: "[--scope user|project] <name@marketplace>",
			},
			{
				name: "enable",
				description: t("commands.plugin.sub.enable.description"),
				usage: "[--scope user|project] <name@marketplace>",
			},
			{
				name: "disable",
				description: t("commands.plugin.sub.disable.description"),
				usage: "[--scope user|project] <name@marketplace>",
			},
			{
				name: "upgrade",
				description: t("commands.plugin.sub.upgrade.description"),
				usage: "[--scope user|project] [name@marketplace]",
			},
			{
				name: "discover",
				description: t("commands.plugin.sub.discover.description"),
				usage: "[marketplace]",
			},
			{ name: "list", description: t("commands.plugin.sub.list.description") },
			{
				name: "validate",
				description: t("commands.plugin.sub.validate.description"),
				usage: "[path]",
			},
			{
				name: "setup",
				description: t("commands.plugin.sub.setup.description"),
			},
			{ name: "help", description: t("commands.plugin.sub.help.description") },
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
					runtime.ctx.showPluginDashboard("discover");
				} catch (err) {
					runtime.ctx.showStatus(t("commands.plugin.error", { message: String(err) }));
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
					runtime.ctx.showPluginDashboard("installed");
				} catch (err) {
					runtime.ctx.showStatus(t("commands.plugin.error", { message: String(err) }));
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
				const showPluginStatus = (
					message: string,
					refresh?: Awaited<ReturnType<typeof mgr.refreshMarketplaces>>,
				) => {
					const warning = refresh ? formatMarketplaceRefreshWarning(refresh) : undefined;
					runtime.ctx.showStatus(warning ? `${warning}\n\n${message}` : message);
				};
				switch (sub) {
					// ── Marketplace management (/plugin marketplace add|remove|update|list) ──
					case "marketplace": {
						const mktArgs = rest.split(/\s+/);
						const mktSub = mktArgs[0] || "";
						const mktRest = mktArgs.slice(1).join(" ").trim();
						switch (mktSub) {
							case "add": {
								if (!mktRest) {
									runtime.ctx.showStatus(t("commands.plugin.marketplace.addUsage"));
									return;
								}
								const prepared = await prepareMarketplaceAddition(mgr, mktRest);
								const outcome = await runReviewedAction(runtime.ctx, "marketplace addition", {
									review: prepared.review,
									resolve: async () => {
										const current = await prepareMarketplaceAddition(mgr, mktRest);
										return { review: current.review, target: current.target };
									},
									execute: target => executeMarketplaceAddition(mgr, target),
								});
								if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
								else if (outcome === "succeeded")
									runtime.ctx.showStatus(
										t("commands.plugin.marketplace.added", { name: prepared.target.name }),
									);
								else if (outcome === "unresolved")
									runtime.ctx.showError("Marketplace addition remains unresolved; retry from a fresh review.");
								break;
							}
							case "remove":
							case "rm": {
								if (!mktRest) {
									runtime.ctx.showStatus(t("commands.plugin.marketplace.removeUsage"));
									return;
								}
								const prepared = await prepareMarketplaceRemoval(mgr, mktRest);
								const outcome = await runReviewedAction(runtime.ctx, "marketplace removal", {
									review: prepared.review,
									resolve: async () => {
										const current = await prepareMarketplaceRemoval(mgr, mktRest);
										return { review: current.review, target: current.target };
									},
									execute: target => mgr.removeMarketplace(target.name),
								});
								if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
								else if (outcome === "succeeded")
									runtime.ctx.showStatus(t("commands.plugin.marketplace.removed", { name: mktRest }));
								else if (outcome === "unresolved")
									runtime.ctx.showError("Marketplace removal remains unresolved; retry from a fresh review.");
								break;
							}
							case "update": {
								if (mktRest) {
									await mgr.updateMarketplace(mktRest);
									runtime.ctx.showStatus(t("commands.plugin.marketplace.updated", { name: mktRest }));
								} else {
									const refresh = await mgr.refreshMarketplaces();
									showPluginStatus(
										t("commands.plugin.marketplace.updatedAll", {
											count: refresh.successful.length,
										}),
										refresh,
									);
								}
								break;
							}
							default: {
								const marketplaces = await mgr.listMarketplaces();
								if (marketplaces.length === 0) {
									runtime.ctx.showStatus(t("commands.plugin.marketplace.noneConfiguredGetStarted"));
								} else {
									const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
									runtime.ctx.showStatus(
										`Marketplaces:\n${lines.join("\n")}\n\n${t("commands.plugin.marketplace.listHint")}`,
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
							runtime.ctx.showStatus(t("commands.plugin.marketplace.addUsage"));
							return;
						}
						const prepared = await prepareMarketplaceAddition(mgr, rest);
						const outcome = await runReviewedAction(runtime.ctx, "marketplace addition", {
							review: prepared.review,
							resolve: async () => {
								const current = await prepareMarketplaceAddition(mgr, rest);
								return { review: current.review, target: current.target };
							},
							execute: target => executeMarketplaceAddition(mgr, target),
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "succeeded")
							runtime.ctx.showStatus(t("commands.plugin.marketplace.added", { name: prepared.target.name }));
						else if (outcome === "unresolved")
							runtime.ctx.showError("Marketplace addition remains unresolved; retry from a fresh review.");
						break;
					}
					case "remove":
					case "rm": {
						if (!rest) {
							runtime.ctx.showStatus(t("commands.plugin.marketplace.removeUsage"));
							return;
						}
						const prepared = await prepareMarketplaceRemoval(mgr, rest);
						const outcome = await runReviewedAction(runtime.ctx, "marketplace removal", {
							review: prepared.review,
							resolve: async () => {
								const current = await prepareMarketplaceRemoval(mgr, rest);
								return { review: current.review, target: current.target };
							},
							execute: target => mgr.removeMarketplace(target.name),
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "succeeded")
							runtime.ctx.showStatus(t("commands.plugin.marketplace.removed", { name: rest }));
						else if (outcome === "unresolved")
							runtime.ctx.showError("Marketplace removal remains unresolved; retry from a fresh review.");
						break;
					}
					case "update": {
						if (rest) {
							await mgr.updateMarketplace(rest);
							runtime.ctx.showStatus(t("commands.plugin.marketplace.updated", { name: rest }));
						} else {
							const refresh = await mgr.refreshMarketplaces();
							showPluginStatus(
								t("commands.plugin.marketplace.updatedAll", {
									count: refresh.successful.length,
								}),
								refresh,
							);
						}
						break;
					}
					// ── Plugin discovery ──
					case "discover": {
						const refresh = await mgr.refreshMarketplaces(rest ? [rest] : undefined);
						const plugins = await mgr.listAvailablePlugins(rest || undefined);
						if (plugins.length === 0) {
							const marketplaces = await mgr.listMarketplaces();
							if (marketplaces.length === 0) {
								showPluginStatus(t("commands.plugin.marketplace.noneConfiguredTry"), refresh);
							} else {
								showPluginStatus(t("commands.plugin.marketplace.noPluginsAvailable"), refresh);
							}
						} else {
							const lines = plugins.map(
								p =>
									`  ${p.name}${p.version ? `@${p.version}` : ""}${p.description ? ` - ${p.description}` : ""}`,
							);
							showPluginStatus(`Available plugins:\n${lines.join("\n")}`, refresh);
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
						const prepared = await preparePluginInstall(mgr, name, marketplace, parsed.scope, parsed.force);
						const outcome = await runReviewedAction(runtime.ctx, "plugin installation", {
							review: prepared.review,
							resolve: async () => {
								const current = await preparePluginInstall(mgr, name, marketplace, parsed.scope, parsed.force);
								return { review: current.review, target: current.target };
							},
							execute: target => executePluginInstall(mgr, target),
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "succeeded")
							showPluginStatus(t("commands.plugin.installed", { name, marketplace }));
						else if (outcome === "unresolved")
							runtime.ctx.showError("Plugin installation remains unresolved; retry from a fresh review.");
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
						const prepared = await preparePluginRemoval(mgr, uninstArgs.pluginId, uninstArgs.scope);
						const outcome = await runReviewedAction(runtime.ctx, "plugin removal", {
							review: prepared.review,
							resolve: async () => {
								const current = await preparePluginRemoval(mgr, uninstArgs.pluginId, uninstArgs.scope);
								return { review: current.review, target: current.target };
							},
							execute: target => mgr.uninstallPlugin(target.pluginId, target.scope),
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "succeeded")
							runtime.ctx.showStatus(
								t("commands.plugin.uninstalled", {
									pluginId: uninstArgs.pluginId,
								}),
							);
						else if (outcome === "unresolved")
							runtime.ctx.showError("Plugin removal remains unresolved; retry from a fresh review.");
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
						const prepared = await preparePluginEnabled(mgr, parsed.pluginId, parsed.scope, isEnable);
						if (!prepared) {
							runtime.ctx.showStatus(
								`Nothing changed. Plugin ${parsed.pluginId} is already ${isEnable ? "enabled" : "disabled"}.`,
							);
							break;
						}
						const outcome = await runReviewedAction(runtime.ctx, `plugin ${sub}`, {
							review: prepared.review,
							resolve: async () => {
								const current = await preparePluginEnabled(mgr, parsed.pluginId, parsed.scope, isEnable);
								return current ? { review: current.review, target: current.target } : undefined;
							},
							execute: target => mgr.setPluginEnabled(target.pluginId, isEnable, target.scope),
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "succeeded")
							runtime.ctx.showStatus(
								isEnable
									? t("commands.plugin.enabled", { pluginId: parsed.pluginId })
									: t("commands.plugin.disabled", { pluginId: parsed.pluginId }),
							);
						else if (outcome === "unresolved")
							runtime.ctx.showError(`Plugin ${sub} remains unresolved; retry from a fresh review.`);
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
							const prepared = await preparePluginUpgrade(mgr, upArgs.pluginId, upArgs.scope);
							if (!prepared) {
								runtime.ctx.showStatus(`Nothing changed. Plugin ${upArgs.pluginId} is already up to date.`);
								break;
							}
							const outcome = await runReviewedAction(runtime.ctx, "plugin upgrade", {
								review: prepared.review,
								resolve: async () => {
									const current = await preparePluginUpgrade(mgr, upArgs.pluginId, upArgs.scope);
									return current ? { review: current.review, target: current.target } : undefined;
								},
								execute: target => executePluginUpgrade(mgr, target),
							});
							if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
							else if (outcome === "succeeded")
								showPluginStatus(
									t("commands.plugin.upgraded", {
										pluginId: upArgs.pluginId,
										version: prepared.target.to,
									}),
								);
							else if (outcome === "unresolved")
								runtime.ctx.showError("Plugin upgrade remains unresolved; retry from a fresh review.");
						} else {
							const prepared = await preparePluginUpgradeAll(mgr);
							if (!prepared) {
								showPluginStatus(t("commands.plugin.allUpToDate"));
								break;
							}
							let result: Awaited<ReturnType<typeof executePluginUpgradeAll>> | undefined;
							const outcome = await runReviewedAction(runtime.ctx, "plugin upgrades", {
								review: prepared.review,
								resolve: async () => {
									const current = await preparePluginUpgradeAll(mgr);
									return current ? { review: current.review, target: current.target } : undefined;
								},
								execute: async target => {
									result = await executePluginUpgradeAll(mgr, target);
								},
							});
							if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
							else if (outcome === "unresolved")
								runtime.ctx.showError("Plugin upgrades remain unresolved; retry from a fresh review.");
							else if (outcome === "succeeded" && result) {
								const lines = result.completed.map(
									update => `  ${update.pluginId} [${update.scope}]: ${update.from} -> ${update.to}`,
								);
								if (result.failed.length) {
									const failures = result.failed.map(
										failure => `  ${failure.pluginId} [${failure.scope}]: ${failure.error}`,
									);
									runtime.ctx.showStatus(
										`${result.completed.length} plugin scope(s) upgraded; ${result.failed.length} unresolved. Re-run /plugin upgrade to review only unresolved operations.\n${[
											...lines,
											...failures,
										].join("\n")}`,
									);
								} else
									showPluginStatus(
										`${t("commands.plugin.upgradedCount", { count: result.completed.length })}:\n${lines.join("\n")}`,
									);
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
							lines.push(t("commands.plugin.npmPlugins"));
							for (const p of npmPlugins) {
								const status = p.enabled === false ? " (disabled)" : "";
								lines.push(`  ${p.name}@${p.version}${status}`);
							}
						}
						const mktPlugins = await mgr.listInstalledPlugins();
						if (mktPlugins.length > 0) {
							if (lines.length > 0) lines.push("");
							lines.push(t("commands.plugin.marketplacePlugins"));
							for (const p of mktPlugins) {
								const entry = p.entries[0];
								const status = entry?.enabled === false ? " (disabled)" : "";
								const shadowed = p.shadowedBy ? " [shadowed]" : "";
								lines.push(`  ${p.id} v${entry?.version ?? "?"}${status} [${p.scope}]${shadowed}`);
							}
						}
						if (lines.length === 0) {
							runtime.ctx.showStatus(t("commands.plugin.noneInstalled"));
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
						const catalogContent = await readOptionalTextFile(catalogPath);
						if (catalogContent !== undefined) {
							const catalog = parseMarketplaceCatalog(catalogContent, catalogPath);
							runtime.ctx.showStatus(
								t("commands.plugin.validate.marketplaceValid", {
									name: catalog.name,
									count: catalog.plugins.length,
								}),
							);
						} else {
							const pluginContent = await readOptionalTextFile(pluginPath);
							if (pluginContent === undefined) {
								runtime.ctx.showStatus(t("commands.plugin.validate.notFound", { path: targetPath }));
								break;
							}
							const manifest = JSON.parse(pluginContent);
							runtime.ctx.showStatus(
								t("commands.plugin.validate.pluginValid", {
									name: manifest.name ?? path.basename(targetPath),
								}),
							);
						}
						break;
					}
					// ── Setup (guided recommended plugin install) ──
					case "setup": {
						const prepared = await preparePluginSetup(mgr);
						if (!prepared) {
							showPluginStatus(t("commands.plugin.setup.allInstalled"));
							break;
						}
						let result: Awaited<ReturnType<typeof executePluginSetup>> | undefined;
						const outcome = await runReviewedAction(runtime.ctx, "recommended plugin setup", {
							review: prepared.review,
							resolve: async () => {
								const current = await preparePluginSetup(mgr);
								return current ? { review: current.review, target: current.target } : undefined;
							},
							execute: async target => {
								result = await executePluginSetup(mgr, target);
							},
						});
						if (outcome === "busy") runtime.ctx.showStatus("Another reviewed action is already open.");
						else if (outcome === "unresolved")
							runtime.ctx.showError("Recommended plugin setup remains unresolved; retry from a fresh review.");
						else if (outcome === "succeeded" && result) {
							const lines = [
								`Installed ${result.installed.length} of ${prepared.target.items.length} recommended plugins.`,
								...result.installed.map(pluginId => `  ✓ ${pluginId}`),
								...result.failed.map(failure => `  ! ${failure.pluginId}: ${failure.error}`),
								...(result.authenticationNeeded.length
									? [`Authentication still needed: ${result.authenticationNeeded.join(", ")}`]
									: []),
								...(result.failed.length ? ["Re-run /plugin setup to review only unresolved plugins."] : []),
							];
							showPluginStatus(lines.join("\n"));
						}
						break;
					}
					// ── Help ──
					case "help": {
						runtime.ctx.showStatus(t("commands.plugin.help"));
						break;
					}
					default: {
						const marketplaces = await mgr.listMarketplaces();
						if (marketplaces.length === 0) {
							runtime.ctx.showStatus(t("commands.plugin.marketplace.noneConfiguredBrowse"));
						} else {
							const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
							runtime.ctx.showStatus(
								`Marketplaces:\n${lines.join("\n")}\n\n${t("commands.plugin.marketplace.listHintAll")}`,
							);
						}
						break;
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				runtime.ctx.showError(t("commands.plugin.error", { message: msg }));
			}
		},
	},
	{
		name: "reload-plugins",
		description: t("commands.reloadPlugins.description"),
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			if (pluginMetadataRefreshes.has(runtime.ctx)) {
				runtime.ctx.showStatus("Plugin metadata refresh already in progress; no duplicate refresh was started.");
				return;
			}

			pluginMetadataRefreshes.add(runtime.ctx);
			runtime.ctx.showStatus("Refreshing plugin metadata… Running plugin processes will not be restarted.");
			try {
				// Invalidate the fs content cache for all registry files so
				// every provider re-reads command and plugin metadata from disk.
				clearCapabilityFsCache();
				const home = os.homedir();
				invalidateFsCache(path.join(home, getConfigDirName(), "plugins", "installed_plugins.json"));
				const projectPath = await resolveActiveProjectRegistryPath(runtime.ctx.sessionManager.getCwd());
				if (projectPath) invalidateFsCache(projectPath);
				clearXcshPluginRootsCache();
				await runtime.ctx.refreshSlashCommandState();
				runtime.ctx.showStatus(
					"Plugin metadata refreshed. Commands, skills, hooks, tools, agents, and MCP registrations now use the latest discovered files. Running plugin processes were not restarted.",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runtime.ctx.showError(
					`Plugin metadata refresh failed: ${message}. The process was not restarted; resolve the problem and run /reload-plugins again.`,
				);
			} finally {
				pluginMetadataRefreshes.delete(runtime.ctx);
			}
		},
	},
	{
		name: "force",
		description: t("commands.force.description"),
		inlineHint: t("commands.force.inlineHint"),
		allowArgs: true,
		handle: async (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			let toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();
			if (forceSelectors.has(runtime.ctx)) {
				runtime.ctx.showStatus("A forced-tool choice is already open; no additional directive was queued.");
				return;
			}

			if (!toolName) {
				runtime.ctx.editor.setText("");
				const session = runtime.ctx.session;
				const manager = runtime.ctx.sessionManager;
				const sessionId = manager.getSessionId();
				const tools = [...new Set(session.getActiveToolNames())].sort();
				if (!tools.length) {
					runtime.ctx.showStatus("No active tools are available to force; nothing was queued.");
					return;
				}
				const choices = new Map(tools.map(name => [`Queue forced tool: ${name}`, name]));
				forceSelectors.add(runtime.ctx);
				try {
					const choice = await runtime.ctx.showHookSelector("Queue a forced tool call · Current session", [
						"Cancel",
						...choices.keys(),
					]);
					if (!choice || choice === "Cancel") return;
					if (
						runtime.ctx.session !== session ||
						runtime.ctx.sessionManager !== manager ||
						manager.getSessionId() !== sessionId
					) {
						runtime.ctx.showError("Session changed. Open /force again to choose an active tool.");
						return;
					}
					const selected = choices.get(choice);
					if (!selected) throw new Error("The selected tool is no longer available. Open /force again.");
					toolName = selected;
				} catch (error) {
					runtime.ctx.showError(error instanceof Error ? error.message : String(error));
					return;
				} finally {
					forceSelectors.delete(runtime.ctx);
				}
			}

			try {
				runtime.ctx.session.setForcedToolChoice(toolName);
				runtime.ctx.showStatus(
					`Queued ${toolName} once, then no tools. Earlier queued directives may run first; no tool has run yet.`,
				);
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
		description: t("commands.quit.description"),
		handle: shutdownHandler,
	},
	{
		name: "apply",
		description: "Apply a configuration to a resource from a file (create or update)",
		inlineHint: "-f <file.json|file.yaml> [-n namespace] [--dry-run=client|server]",
		allowArgs: true,
		getArgumentCompletions(_prefix: string) {
			return null;
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("apply", command, runtime.ctx);
		},
	},
	{
		name: "create",
		description: "Create a resource from a file (fail if exists)",
		inlineHint: "-f <file.json|file.yaml> [-n namespace] [--dry-run=client|server]",
		allowArgs: true,
		getArgumentCompletions(_prefix: string) {
			return null;
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("create", command, runtime.ctx);
		},
	},
	{
		name: "delete",
		description: "Delete a resource by file or by kind and name",
		inlineHint: "<kind> <name> | -f <file> [-n namespace] [--force]",
		allowArgs: true,
		getArgumentCompletions(prefix: string) {
			try {
				const { getKindCompletions } = require("./resource-commands") as typeof import("./resource-commands");
				return getKindCompletions(prefix);
			} catch {
				return null;
			}
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("delete", command, runtime.ctx);
		},
	},
	{
		name: "describe",
		description: "Show detailed information about a resource",
		inlineHint: "<kind> <name> [-n namespace] [-o json|yaml]",
		allowArgs: true,
		getArgumentCompletions(prefix: string) {
			try {
				const { getKindCompletions } = require("./resource-commands") as typeof import("./resource-commands");
				return getKindCompletions(prefix);
			} catch {
				return null;
			}
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("describe", command, runtime.ctx);
		},
	},
	{
		name: "diff",
		description: "Preview what changes would be applied from a file",
		inlineHint: "-f <file.json|file.yaml> [-n namespace]",
		allowArgs: true,
		getArgumentCompletions(_prefix: string) {
			return null;
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("diff", command, runtime.ctx);
		},
	},
	{
		name: "get",
		description: "List or fetch F5 XC resources",
		inlineHint: "<kind> [name] [-n namespace] [-o json|yaml|table]",
		allowArgs: true,
		getArgumentCompletions(prefix: string) {
			try {
				const { getKindCompletions } = require("./resource-commands") as typeof import("./resource-commands");
				return getKindCompletions(prefix);
			} catch {
				return null;
			}
		},
		handle: async (command, runtime) => {
			const { handleResourceCommand } = await import("./resource-commands");
			await handleResourceCommand("get", command, runtime.ctx);
		},
	},
	{
		name: "manifest",
		description: "Export live F5 XC resources as {kind, metadata, spec} manifest files",
		inlineHint: "<kind> [name] [-n namespace] [-o json|yaml] [-f output-path] [--all]",
		allowArgs: true,
		getArgumentCompletions(prefix: string) {
			try {
				const { getExportKindCompletions } = require("./export-command") as typeof import("./export-command");
				return getExportKindCompletions(prefix);
			} catch {
				return null;
			}
		},
		handle: async (command, runtime) => {
			const { handleExportResourceCommand } = await import("./export-command");
			await handleExportResourceCommand(command, runtime.ctx);
		},
	},
	{
		name: "context",
		description: t("commands.context.description"),
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
				return items.map(item => ({
					...item,
					value: `${subName} ${item.value}`,
				}));
			}
			const lower = argumentPrefix.toLowerCase();
			const items: {
				value: string;
				label: string;
				description?: string;
				hint?: string;
			}[] = [];
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
			const subcommand = command.args.trim().split(/\s+/)[0]?.toLowerCase();
			const mayContainCredential =
				subcommand === "create" ||
				subcommand === "import" ||
				subcommand === "set" ||
				subcommand === "add" ||
				(subcommand === "env" && /^(?:env\s+)?(?:set|add)\b/i.test(command.args.trim())) ||
				/^[A-Za-z_][A-Za-z0-9_]*=/.test(command.args.trim());
			runtime.ctx.editor.addToHistory(mayContainCredential ? `/context ${subcommand || "change"}` : command.text);
			runtime.ctx.editor.setText("");
			const { ContextCommandController } = await import("../modes/controllers/context-command-controller");
			const controller = new ContextCommandController(runtime.ctx);
			await controller.handle(command);
		},
	},
	{
		name: "route",
		description: "Display or configure provider-agnostic dynamic model routing",
		allowArgs: true,
		subcommands: [
			{
				name: "status",
				description: "Display dynamic routing status and active tier",
			},
			{ name: "off", description: "Disable dynamic model routing" },
			{
				name: "shadow",
				description: "Record dynamic model routing decisions speculatively without switching",
			},
			{
				name: "auto",
				description: "Enable dynamic model routing and clear manual model pins",
			},
			{
				name: "profile",
				description: "Select a provider-sticky subscription routing profile",
			},
		],
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			const { handleRouteCommand } = await import("../routing/commands");
			const args = command.args ? command.args.split(/\s+/) : ["status"];
			const status = runtime.ctx.session.getRoutingStatus();
			const currentModel = runtime.ctx.session.model
				? `${runtime.ctx.session.model.provider}/${runtime.ctx.session.model.id}`
				: "unknown";
			const res = await handleRouteCommand(args, {
				coordinator: runtime.ctx.session.routingCoordinator,
				currentModel,
				mode: status.mode,
				profile: status.profile,
			});
			if (res.newMode) {
				const ctx = runtime.ctx;
				if (routeReviews.has(ctx)) {
					ctx.showStatus("A routing review is already open.");
					return;
				}
				routeReviews.add(ctx);
				try {
					const session = ctx.session;
					const manager = ctx.sessionManager;
					const sessionId = manager.getSessionId();
					const settings = ctx.settings;
					const mode = res.newMode;
					const current = session.getRoutingStatus();
					if (
						settings.inspectScopes("routing.mode").userValue === mode &&
						!(mode === "auto" && current.mode === "auto" && current.manualPin) &&
						!unresolvedRouteSaves.has(settings)
					) {
						ctx.showStatus(
							`User routing mode is already ${mode}; effective mode: ${current.mode}. Nothing changed.`,
						);
						return;
					}
					const review = (): ActionReview => {
						const current = session.getRoutingStatus();
						const scopes = settings.inspectScopes("routing.mode");
						const effective = scopes.runtimeValue ?? scopes.projectValue ?? mode;
						return {
							identity: `routing:${sessionId}`,
							scope: "User settings · Routing mode; manual pin affects the current session",
							revision: JSON.stringify({
								current,
								scopes,
								unresolved: unresolvedRouteSaves.has(settings),
							}),
							changes: [
								{
									field: "User routing mode",
									before: scopes.userValue,
									after: mode,
								},
								{
									field: "Effective routing mode",
									before: current.mode,
									after: effective,
								},
								...(unresolvedRouteSaves.has(settings)
									? [
											{
												field: "Persistence",
												before: "Unresolved prior write",
												after: "Retry saving user preference",
											},
										]
									: []),
								...(mode === "auto" && effective === "auto"
									? [
											{
												field: "Manual model pin",
												before: current.manualPin ?? "none",
												after: "none",
											},
										]
									: []),
							],
							consequence:
								effective !== mode
									? "Saves the user preference only. Project/runtime overrides retain the effective mode and current manual pin."
									: mode === "auto"
										? "Future requests may switch models and incur different costs. Clears the current manual model pin."
										: mode === "shadow"
											? "Records routing decisions without switching models."
											: "Stops dynamic routing; retains the current model.",
						};
					};
					const outcome = await runReviewedAction(ctx, "routing mode", {
						review: review(),
						resolve: async () =>
							ctx.session === session &&
							ctx.sessionManager === manager &&
							ctx.settings === settings &&
							manager.getSessionId() === sessionId
								? { review: review(), target: session }
								: undefined,
						execute: async target => {
							unresolvedRouteSaves.add(settings);
							if (settings.inspectScopes("routing.mode").userValue !== mode) target.setRoutingMode(mode);
							await settings.flush({ throwOnError: true });
							if (settings.inspectScopes("routing.mode").userValue !== mode)
								throw new Error("User routing mode did not reach the reviewed value.");
							unresolvedRouteSaves.delete(settings);
							if (mode === "auto" && target.getRoutingStatus().mode === "auto") target.clearRoutingPin();
						},
					});
					if (outcome === "succeeded")
						ctx.showStatus(
							`Saved routing mode: ${mode}. Effective mode: ${session.getRoutingStatus().mode}. Manual pin: ${session.getRoutingStatus().manualPin ?? "none"}.`,
						);
					if (outcome === "unresolved")
						ctx.showError(
							"Routing save is unresolved; state may have changed. Review the command again to retry.",
						);
				} finally {
					routeReviews.delete(ctx);
				}
				return;
			}
			if (res.newProfile) {
				const ctx = runtime.ctx;
				if (routeReviews.has(ctx)) {
					ctx.showStatus("A routing review is already open.");
					return;
				}
				routeReviews.add(ctx);
				try {
					const session = ctx.session;
					const manager = ctx.sessionManager;
					const sessionId = manager.getSessionId();
					const settings = ctx.settings;
					const profile = res.newProfile;
					const revision = (proposed: Record<string, string>) =>
						JSON.stringify({
							roles: settings.inspectScopes("modelRoles"),
							profileScopes: settings.inspectScopes("routing.profile"),
							model: session.model ? `${session.model.provider}/${session.model.id}` : "none",
							thinking: session.thinkingLevel,
							proposed,
						});
					const currentTarget = () =>
						ctx.session === session &&
						ctx.sessionManager === manager &&
						ctx.settings === settings &&
						manager.getSessionId() === sessionId;
					const saveOnly = (roles: Record<string, string>) => {
						const pending = pendingProfileSaves.get(session);
						return (
							pending?.settings === settings &&
							pending.profile === profile &&
							pending.sessionId === sessionId &&
							pending.revision === revision(roles)
						);
					};
					const prepare = async () => {
						if (!currentTarget()) return undefined;
						const pending = pendingProfileSaves.get(session);
						const prepared =
							pending && saveOnly(pending.roles)
								? { applied: true, roles: pending.roles, missingModels: [] }
								: await session.prepareRoutingProfile(profile);
						if (!currentTarget()) return undefined;
						if (!prepared.applied)
							throw new Error(`Routing profile ${profile} unavailable: ${prepared.missingModels.join(", ")}`);
						const roles = settings.inspectScopes("modelRoles");
						const profileScopes = settings.inspectScopes("routing.profile");
						const effectiveRoles = {
							...prepared.roles,
							...roles.projectValue,
							...roles.runtimeValue,
						};
						const model = session.model ? `${session.model.provider}/${session.model.id}` : "none";
						const review: ActionReview = {
							identity: `routing-profile:${profile}:session:${sessionId}`,
							scope: "User settings · Role assignments and profile; current session model switch",
							revision: revision(prepared.roles),
							changes: [
								{
									field: "User profile",
									before: profileScopes.userValue,
									after: profile,
								},
								...(saveOnly(prepared.roles)
									? [
											{
												field: "Persistence",
												before: "Profile/model already applied; save unresolved",
												after: "Retry saving only",
											},
										]
									: []),
								{
									field: "Effective profile",
									before: profileScopes.effectiveValue,
									after: profileScopes.runtimeValue ?? profileScopes.projectValue ?? profile,
								},
								...Object.keys(prepared.roles)
									.sort()
									.map(role => ({
										field: `User role ${role}`,
										before: roles.userValue?.[role] ?? "unset",
										after: prepared.roles[role],
									})),
								{
									field: "Active model / reasoning",
									before: `${model}:${session.thinkingLevel}`,
									after: effectiveRoles.default ?? "unavailable",
								},
							],
							consequence: saveOnly(prepared.roles)
								? "Retries only the unresolved settings save. Does not repeat the completed profile or model switch."
								: "Saves exact role selectors, retaining project/runtime overrides. Switches the current model to the effective default role; later requests may have different costs. Routing mode is unchanged.",
						};
						return {
							review,
							target: { roles: prepared.roles, revision: review.revision },
						};
					};
					const editorContainer = (
						ctx as unknown as { editorContainer?: InteractiveModeContext["editorContainer"] }
					).editorContainer;
					const uiWithFocus = ctx.ui as unknown as Partial<InteractiveModeContext["ui"]>;
					const canMountLoader = Boolean(editorContainer && typeof uiWithFocus.setFocus === "function");
					const loader = canMountLoader
						? new BorderedLoader(ctx.ui, theme, `Resolving routing profile ${profile}`, false)
						: undefined;
					if (loader && editorContainer) {
						editorContainer.clear();
						editorContainer.addChild(loader);
						uiWithFocus.setFocus?.(loader);
						ctx.ui.requestRender();
					}
					let prepared: Awaited<ReturnType<typeof prepare>>;
					try {
						prepared = await prepare();
					} finally {
						if (loader && editorContainer) {
							loader.dispose();
							editorContainer.clear();
							editorContainer.addChild(ctx.editor);
							uiWithFocus.setFocus?.(ctx.editor);
							ctx.ui.requestRender();
						}
					}
					if (!prepared) {
						ctx.showError("Session changed. Open the routing profile again.");
						return;
					}
					const roleScopes = settings.inspectScopes("modelRoles");
					const profileScopes = settings.inspectScopes("routing.profile");
					const expectedDefault = parseModelString(
						{
							...prepared.target.roles,
							...roleScopes.projectValue,
							...roleScopes.runtimeValue,
						}.default ?? "",
					);
					const currentModelMatches = Boolean(
						expectedDefault &&
							session.model?.provider === expectedDefault.provider &&
							session.model.id === expectedDefault.id &&
							session.thinkingLevel === expectedDefault.thinkingLevel,
					);
					const userRolesMatch = Object.entries(prepared.target.roles).every(
						([role, selector]) => roleScopes.userValue?.[role] === selector,
					);
					if (
						profileScopes.userValue === profile &&
						userRolesMatch &&
						currentModelMatches &&
						!pendingProfileSaves.has(session)
					) {
						ctx.showStatus(
							`Routing profile is already ${profile}; active model and role assignments match. Nothing changed.`,
						);
						return;
					}
					const outcome = await runReviewedAction(ctx, "routing profile", {
						review: prepared.review,
						resolve: prepare,
						execute: async proposal => {
							if (!saveOnly(proposal.roles)) {
								const applied = await session.applyRoutingProfile(
									profile,
									proposal.roles,
									() => currentTarget() && revision(proposal.roles) === proposal.revision,
								);
								if (!applied.applied)
									throw new Error(`Profile unavailable: ${applied.missingModels.join(", ")}`);
								pendingProfileSaves.set(session, {
									settings,
									profile,
									sessionId,
									revision: revision(proposal.roles),
									roles: structuredClone(proposal.roles),
								});
							}
							await settings.flush({ throwOnError: true });
							pendingProfileSaves.delete(session);
						},
					});
					if (outcome === "succeeded")
						ctx.showStatus(
							`Routing profile saved: ${profile}. Effective profile: ${session.getRoutingStatus().profile}.`,
						);
					if (outcome === "unresolved")
						ctx.showError(
							"Routing profile save is unresolved; settings or active model may have changed. Review again to retry.",
						);
				} catch (error) {
					ctx.showError(error instanceof Error ? error.message : String(error));
				} finally {
					routeReviews.delete(ctx);
				}
				return;
			}
			if (res.error) runtime.ctx.showError(res.output);
			else if (args[0].toLowerCase() === "status") {
				const scopes = runtime.ctx.settings.inspectScopes("routing.mode");
				const profileScopes = runtime.ctx.settings.inspectScopes("routing.profile");
				runtime.ctx.showStatus(
					[
						`User routing mode: ${scopes.userValue}`,
						`Mode overrides — project: ${scopes.projectValue ?? "none"}; runtime: ${scopes.runtimeValue ?? "none"}`,
						`User routing profile: ${profileScopes.userValue ?? "none"}`,
						`Profile overrides — project: ${profileScopes.projectValue ?? "none"}; runtime: ${profileScopes.runtimeValue ?? "none"}`,
						...(unresolvedRouteSaves.has(runtime.ctx.settings)
							? ["User routing save unresolved; review the mode again to retry."]
							: []),
						res.output,
					].join("\n"),
				);
			} else runtime.ctx.showStatus(res.output);
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

/** Internal acceptance inventory; never exposes executable callbacks or changes command dispatch. */
export function getBuiltinSlashCommandInventory() {
	return BUILTIN_SLASH_COMMAND_REGISTRY.map(command => ({
		name: command.name,
		aliases: [...(command.aliases ?? [])],
		acceptsArguments: Boolean(command.allowArgs),
		subcommands: command.subcommands?.map(subcommand => subcommand.name) ?? [],
	}));
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
