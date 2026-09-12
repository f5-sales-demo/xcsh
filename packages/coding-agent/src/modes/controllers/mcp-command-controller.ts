/**
 * MCP Command Controller
 *
 * Handles /mcp subcommands for managing MCP servers.
 */
import { createHash } from "node:crypto";
import { Container, Spacer, Text } from "@f5-sales-demo/pi-tui";
import { getMCPConfigPath, getProjectDir, t } from "@f5-sales-demo/pi-utils";
import type { SourceMeta } from "../../capability/types";
import { analyzeAuthError, discoverOAuthEndpoints, MCPManager } from "../../mcp";
import { connectToServer, disconnectServer, listTools } from "../../mcp/client";
import {
	addMCPServer,
	readDisabledServers,
	readMCPConfigFile,
	removeMCPServer,
	setServerDisabled,
	updateMCPServer,
} from "../../mcp/config-writer";
import { MCPOAuthFlow } from "../../mcp/oauth-flow";
import {
	clearSmitheryApiKey,
	createSmitheryCliAuthSession,
	getSmitheryApiKey,
	getSmitheryLoginUrl,
	pollSmitheryCliAuthSession,
	saveSmitheryApiKey,
} from "../../mcp/smithery-auth";
import { SmitheryConnectError } from "../../mcp/smithery-connect";
import {
	SmitheryRegistryError,
	type SmitherySearchResult,
	searchSmitheryRegistry,
	toConfigName,
} from "../../mcp/smithery-registry";
import type { MCPAuthConfig, MCPServerConfig, MCPServerConnection } from "../../mcp/types";
import type { OAuthCredential } from "../../session/auth-storage";
import { shortenPath } from "../../tools/render-utils";
import { openPath } from "../../utils/open";
import { presentAuthLink } from "../components/auth-link-presenter";
import { BorderedLoader } from "../components/bordered-loader";
import { MCPAddWizard } from "../components/mcp-add-wizard";
import type { ActionReview } from "../components/reviewed-action";
import { ActionInterruptedError, runReviewedAction } from "../components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../components/selector-frame";
import { TranscriptComponentFrame, TranscriptNoticeComponent } from "../components/transcript-notice";
import { parseCommandArgs } from "../shared";
import { theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	const { promise: timeoutPromise, reject } = Promise.withResolvers<T>();
	const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
	return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

type MCPAddScope = "user" | "project";
type MCPAddTransport = "http" | "sse";

type MCPAddParsed = {
	initialName?: string;
	scope: MCPAddScope;
	quickConfig?: MCPServerConfig;
	isCommandQuickAdd?: boolean;
	hasAuthToken?: boolean;
	error?: string;
};

type MCPSearchParsed = {
	keyword: string;
	scope: MCPAddScope;
	limit: number;
	semantic: boolean;
	error?: string;
};

interface McpOAuthPresentationDependencies {
	openUrl?: (url: string) => void;
	presentLink?: typeof presentAuthLink;
}

export interface MCPCommandDependencies {
	clearSmitheryApiKey: typeof clearSmitheryApiKey;
	createSmitheryCliAuthSession: typeof createSmitheryCliAuthSession;
	getSmitheryApiKey: typeof getSmitheryApiKey;
	getSmitheryLoginUrl: typeof getSmitheryLoginUrl;
	pollSmitheryCliAuthSession: typeof pollSmitheryCliAuthSession;
	saveSmitheryApiKey: typeof saveSmitheryApiKey;
	searchSmitheryRegistry: typeof searchSmitheryRegistry;
	sleep(milliseconds: number): Promise<void>;
	now(): number;
}

const defaultCommandDependencies: MCPCommandDependencies = {
	clearSmitheryApiKey,
	createSmitheryCliAuthSession,
	getSmitheryApiKey,
	getSmitheryLoginUrl,
	pollSmitheryCliAuthSession,
	saveSmitheryApiKey,
	searchSmitheryRegistry,
	sleep: Bun.sleep,
	now: Date.now,
};

const activeMcpRuntimeOperations = new WeakSet<InteractiveModeContext>();
const activeSmitheryLogins = new WeakSet<InteractiveModeContext>();
const activeMcpOAuthFlows = new WeakSet<InteractiveModeContext>();

function mcpDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeMcpEndpoint(value: string | undefined): string {
	if (!value) return "(none)";
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return "(invalid URL)";
	}
}

function mcpConfigSummary(config: MCPServerConfig): string {
	if (config.type === "http" || config.type === "sse")
		return `${config.type.toUpperCase()} · ${safeMcpEndpoint(config.url)}`;
	return `STDIO · ${config.command ?? "(missing command)"} · ${config.args?.length ?? 0} argument(s)`;
}

function hasConfiguredMcpAuth(config: MCPServerConfig | undefined): boolean {
	if (!config) return false;
	const candidate = config as MCPServerConfig & {
		headers?: Record<string, string>;
		oauth?: unknown;
		auth?: MCPAuthConfig;
	};
	return Boolean(candidate.headers || candidate.oauth || candidate.auth);
}

function mcpServerReview(
	action: "add" | "remove" | "enable" | "disable" | "unauth" | "reauth",
	target: {
		name: string;
		scope: MCPAddScope;
		filePath: string;
		current?: MCPServerConfig;
		proposed?: MCPServerConfig;
	},
	fileState: unknown,
): ActionReview {
	const before = target.current ? mcpConfigSummary(target.current) : "Absent";
	const after = target.proposed ? mcpConfigSummary(target.proposed) : "Removed";
	const authBefore = (target.current as (MCPServerConfig & { auth?: MCPAuthConfig }) | undefined)?.auth
		? "OAuth credential saved (masked)"
		: hasConfiguredMcpAuth(target.current)
			? "Configured (masked)"
			: "None";
	const authAfter = (target.proposed as (MCPServerConfig & { auth?: MCPAuthConfig }) | undefined)?.auth
		? "OAuth credential saved (masked)"
		: hasConfiguredMcpAuth(target.proposed)
			? "Configured (masked)"
			: "None";
	return {
		identity: `mcp-server:${target.scope}:${target.name}`,
		scope: `${target.scope === "user" ? "User" : "Project"} MCP configuration · ${target.filePath}`,
		revision: mcpDigest({ action, fileState, target }),
		changes: [
			{ field: "Saved server", before, after },
			{
				field: "Enabled state",
				before: target.current?.enabled === false ? "Disabled" : target.current ? "Enabled" : "Absent",
				after: target.proposed?.enabled === false ? "Disabled" : target.proposed ? "Enabled" : "Removed",
			},
			...(authBefore !== authAfter ? [{ field: "Authentication", before: authBefore, after: authAfter }] : []),
		],
		consequence:
			action === "add"
				? "Saves this server configuration and any masked credential. Connectivity testing and runtime connection are separate follow-up operations."
				: action === "remove"
					? "Removes this saved server and its managed OAuth credential, then disconnects it from this process."
					: action === "unauth"
						? "Removes the saved OAuth association and managed credential without deleting the server configuration."
						: action === "reauth"
							? "Replaces the saved OAuth association and managed credential. The authorization step completed before this review without persisting its result."
							: "Persists the enabled state, then refreshes runtime connections and tools.",
	};
}

/** Render the MCP controller's browser-authorization state without exposing the raw URL. */
export function showMcpOAuthAuthorization(
	ctx: Pick<InteractiveModeContext, "chatContainer" | "ui">,
	info: { url: string; instructions?: string },
	dependencies: McpOAuthPresentationDependencies = {},
): void {
	const showLink = dependencies.presentLink ?? presentAuthLink;
	const openUrl = dependencies.openUrl ?? openPath;

	const content = new Container();
	showLink(content, info.url);
	if (info.instructions) {
		content.addChild(new Spacer(1));
		content.addChild(new Text(theme.fg("warning", info.instructions), 1, 0));
	}
	content.addChild(new Spacer(1));
	content.addChild(new Text(theme.fg("muted", "Waiting for authorization · 5 minute timeout"), 1, 0));
	ctx.chatContainer.addChild(new Spacer(1));
	ctx.chatContainer.addChild(
		new TranscriptComponentFrame(
			"OAuth authorization",
			"Complete authorization in the browser; no credential is persisted until its separate review succeeds.",
			content,
			["This operation cannot be interrupted; it times out after 5 minutes"],
		),
	);
	ctx.ui.requestRender();

	openUrl(info.url);
}

export class MCPCommandController {
	#pendingOAuthCredentials = new Map<string, OAuthCredential>();
	readonly #dependencies: MCPCommandDependencies;
	constructor(
		private ctx: InteractiveModeContext,
		dependencies: Partial<MCPCommandDependencies> = {},
	) {
		this.#dependencies = { ...defaultCommandDependencies, ...dependencies };
	}

	/**
	 * Handle /mcp command and route to subcommands
	 */
	async handle(text: string): Promise<void> {
		const parts = text.trim().split(/\s+/);
		const subcommand = parts[1]?.toLowerCase();

		if (!subcommand || subcommand === "help") {
			await this.#showHelp();
			return;
		}

		switch (subcommand) {
			case "add":
				await this.#handleAdd(text);
				break;
			case "list":
				await this.#handleList();
				break;
			case "remove":
			case "rm":
				await this.#handleRemove(text);
				break;
			case "test":
				await this.#handleTest(parts[2]);
				break;
			case "reauth":
				await this.#handleReauth(parts[2]);
				break;
			case "unauth":
				await this.#handleUnauth(parts[2]);
				break;
			case "enable":
				await this.#handleSetEnabled(parts[2], true);
				break;
			case "disable":
				await this.#handleSetEnabled(parts[2], false);
				break;
			case "resources":
				await this.#handleResources();
				break;
			case "prompts":
				await this.#handlePrompts();
				break;
			case "notifications":
				await this.#handleNotifications();
				break;
			case "smithery-search":
				await this.#handleSearch(text);
				break;
			case "smithery-login":
				await this.#handleSmitheryLogin();
				break;
			case "smithery-logout":
				await this.#handleSmitheryLogout();
				break;
			case "reconnect":
				await this.#handleReconnect(parts[2]);
				break;
			case "reload":
				await this.#handleReload();
				break;
			default:
				this.ctx.showError(t("mcp.errors.unknownSubcommand", { subcommand: subcommand! }));
		}
	}

	/**
	 * Show help text
	 */
	async #showHelp(): Promise<void> {
		const helpText = [
			"",
			theme.bold("MCP Server Management"),
			"",
			"Manage Model Context Protocol (MCP) servers for external tool integrations.",
			"",
			theme.fg("contentAccent", "Commands:"),
			"  /mcp add              Add a new MCP server (interactive wizard)",
			"  /mcp add <name> [--scope project|user] [--url <url> --transport http|sse] [--token <token>] [-- <command...>]",
			"  /mcp list             List all configured MCP servers",
			"  /mcp remove <name> [--scope project|user]    Remove an MCP server (default: project)",
			"  /mcp test <name>      Test connection to an MCP server",
			"  /mcp reauth <name>    Reauthorize OAuth for an MCP server",
			"  /mcp unauth <name>    Remove OAuth auth from an MCP server",
			"  /mcp enable <name>    Enable an MCP server",
			"  /mcp disable <name>   Disable an MCP server",
			"  /mcp smithery-search <keyword> [--scope project|user] [--limit <1-100>] [--semantic]",
			"                        Search Smithery registry and deploy from picker",
			"  /mcp smithery-login   Login to Smithery and cache API key",
			"  /mcp smithery-logout  Remove cached Smithery API key",
			"  /mcp reconnect <name> Reconnect to a specific MCP server",
			"  /mcp reload           Force reload and rediscover MCP runtime tools",
			"  /mcp resources        List available resources from connected servers",
			"  /mcp prompts          List available prompts from connected servers",
			"  /mcp notifications    Show notification capabilities and subscription state",
			"  /mcp help             Show this help message",
			"",
		].join("\n");

		await this.#showReport("MCP server management", "Commands and connection-state boundaries", helpText);
	}

	#parseAddCommand(text: string): MCPAddParsed {
		const prefixMatch = text.match(/^\/mcp\s+add\b\s*(.*)$/i);
		const rest = prefixMatch?.[1]?.trim() ?? "";
		if (!rest) {
			return { scope: "project" };
		}

		const tokens = parseCommandArgs(rest);
		if (tokens.length === 0) {
			return { scope: "project" };
		}

		let name: string | undefined;
		let scope: MCPAddScope = "project";
		let url: string | undefined;
		let transport: MCPAddTransport = "http";
		let authToken: string | undefined;
		let commandTokens: string[] | undefined;

		let i = 0;
		if (!tokens[0].startsWith("-")) {
			name = tokens[0];
			i = 1;
		}

		while (i < tokens.length) {
			const argToken = tokens[i];
			if (argToken === "--") {
				commandTokens = tokens.slice(i + 1);
				break;
			}
			if (argToken === "--scope") {
				const value = tokens[i + 1];
				if (!value || (value !== "project" && value !== "user")) {
					return { scope, error: t("mcp.errors.invalidScope") };
				}
				scope = value;
				i += 2;
				continue;
			}
			if (argToken === "--url") {
				const value = tokens[i + 1];
				if (!value) {
					return { scope, error: t("mcp.errors.missingUrl") };
				}
				url = value;
				i += 2;
				continue;
			}
			if (argToken === "--transport") {
				const value = tokens[i + 1];
				if (!value || (value !== "http" && value !== "sse")) {
					return { scope, error: t("mcp.errors.invalidTransport") };
				}
				transport = value;
				i += 2;
				continue;
			}
			if (argToken === "--token") {
				const value = tokens[i + 1];
				if (!value) {
					return { scope, error: t("mcp.errors.missingToken") };
				}
				authToken = value;
				i += 2;
				continue;
			}
			return { scope, error: t("mcp.errors.unknownOption", { option: argToken }) };
		}

		const hasQuick = Boolean(url) || Boolean(commandTokens && commandTokens.length > 0);
		if (!hasQuick) {
			return { scope, initialName: name };
		}
		if (!name) {
			return { scope, error: t("mcp.add.nameRequired") };
		}
		if (url && commandTokens && commandTokens.length > 0) {
			return { scope, error: t("mcp.add.urlOrCommand") };
		}
		if (authToken && !url) {
			return { scope, error: t("mcp.add.tokenRequiresUrl") };
		}

		if (commandTokens && commandTokens.length > 0) {
			const [command, ...args] = commandTokens;
			const config: MCPServerConfig = {
				type: "stdio",
				command,
				args: args.length > 0 ? args : undefined,
			};
			return { scope, initialName: name, quickConfig: config, isCommandQuickAdd: true };
		}

		const useHttpTransport = transport === "http";
		let normalizedUrl = url!;
		if (!/^https?:\/\//i.test(normalizedUrl)) {
			normalizedUrl = `https://${normalizedUrl}`;
		}
		const config: MCPServerConfig = {
			type: useHttpTransport ? "http" : "sse",
			url: normalizedUrl,
			headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
		};
		return {
			scope,
			initialName: name,
			quickConfig: config,
			isCommandQuickAdd: false,
			hasAuthToken: Boolean(authToken),
		};
	}

	#parseSearchCommand(text: string): MCPSearchParsed {
		const prefixMatch = text.match(/^\/mcp\s+smithery-search\b\s*(.*)$/i);
		const rest = prefixMatch?.[1]?.trim() ?? "";
		const tokens = parseCommandArgs(rest);
		if (tokens.length === 0) {
			return {
				keyword: "",
				scope: "project",
				limit: 20,
				semantic: false,
				error: t("mcp.smithery.searchUsage"),
			};
		}

		const keywordParts: string[] = [];
		let scope: MCPAddScope = "project";
		let limit = 20;
		let semantic = false;

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === "--scope") {
				const value = tokens[i + 1];
				if (!value || (value !== "project" && value !== "user")) {
					return { keyword: "", scope, limit, semantic, error: t("mcp.errors.invalidScope") };
				}
				scope = value;
				i++;
				continue;
			}
			if (token === "--limit") {
				const value = tokens[i + 1];
				if (!value) {
					return { keyword: "", scope, limit, semantic, error: t("mcp.errors.missingLimit") };
				}
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
					return {
						keyword: "",
						scope,
						limit,
						semantic,
						error: t("mcp.errors.invalidLimit"),
					};
				}
				limit = parsed;
				i++;
				continue;
			}
			if (token === "--semantic") {
				semantic = true;
				continue;
			}
			if (token.startsWith("--")) {
				return { keyword: "", scope, limit, semantic, error: t("mcp.errors.unknownOption", { option: token }) };
			}
			keywordParts.push(token);
		}

		const keyword = keywordParts.join(" ").trim();
		if (!keyword) {
			return {
				keyword: "",
				scope,
				limit,
				semantic,
				error: t("mcp.smithery.searchUsage"),
			};
		}

		return { keyword, scope, limit, semantic };
	}

	/**
	 * Handle /mcp add - Launch interactive wizard or quick-add from args
	 */
	async #handleAdd(text: string): Promise<void> {
		const parsed = this.#parseAddCommand(text);
		if (parsed.error) {
			this.ctx.showError(parsed.error);
			return;
		}
		if (parsed.quickConfig && parsed.initialName) {
			let finalConfig = parsed.quickConfig;

			// Quick-add with URL should still perform auth detection and OAuth flow,
			// matching wizard behavior. Command quick-add intentionally skips this.
			if (!parsed.isCommandQuickAdd && (finalConfig.type === "http" || finalConfig.type === "sse")) {
				try {
					await this.#handleTestConnection(finalConfig);
				} catch (error) {
					if (parsed.hasAuthToken) {
						this.ctx.showError(
							`Authentication failed for "${parsed.initialName}": ${error instanceof Error ? error.message : String(error)}`,
						);
						return;
					}
					const authResult = analyzeAuthError(error as Error);
					if (authResult.requiresAuth) {
						let oauth = authResult.authType === "oauth" ? (authResult.oauth ?? null) : null;
						if (!oauth && finalConfig.url) {
							try {
								oauth = await discoverOAuthEndpoints(finalConfig.url, authResult.authServerUrl);
							} catch {
								// Ignore discovery error and handle below.
							}
						}

						if (!oauth) {
							this.ctx.showError(
								`Authentication required for "${parsed.initialName}", but OAuth endpoints could not be discovered. ` +
									`Use /mcp add ${parsed.initialName} (wizard) or configure auth manually.`,
							);
							return;
						}

						try {
							const oauthClientSecret = finalConfig.oauth?.clientSecret ?? "";
							const credentialId = await this.#handleOAuthFlow(
								oauth.authorizationUrl,
								oauth.tokenUrl,
								oauth.clientId ?? finalConfig.oauth?.clientId ?? "",
								oauthClientSecret,
								oauth.scopes ?? "",
								finalConfig.oauth?.callbackPort,
								finalConfig.oauth?.callbackPath,
								finalConfig.oauth?.redirectUri,
								`${parsed.initialName} (${parsed.scope} configuration)`,
							);
							if (!credentialId) return;
							finalConfig = {
								...finalConfig,
								auth: {
									type: "oauth",
									credentialId,
									tokenUrl: oauth.tokenUrl,
									clientId: oauth.clientId ?? finalConfig.oauth?.clientId,
									clientSecret: finalConfig.oauth?.clientSecret,
								},
							};
						} catch (oauthError) {
							this.ctx.showError(
								`OAuth flow failed for "${parsed.initialName}": ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`,
							);
							return;
						}
					}
				}
			}

			await this.#handleWizardComplete(parsed.initialName, finalConfig, parsed.scope);
			return;
		}

		// Save current editor state
		const done = () => {
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
		};

		// Create wizard with OAuth handler and connection test
		const wizard = new MCPAddWizard(
			async (name: string, config: MCPServerConfig, scope: "user" | "project") => {
				done();
				await this.#handleWizardComplete(name, config, scope);
			},
			() => {
				done();
				this.#handleWizardCancel();
			},
			async (authUrl: string, tokenUrl: string, clientId: string, clientSecret: string, scopes: string) => {
				return await this.#handleOAuthFlow(
					authUrl,
					tokenUrl,
					clientId,
					clientSecret,
					scopes,
					undefined,
					undefined,
					undefined,
					`${parsed.initialName ?? "new server"} (wizard draft)`,
				);
			},
			async (config: MCPServerConfig) => {
				return await this.#handleTestConnection(config);
			},
			() => {
				this.ctx.ui.requestRender();
			},
			parsed.initialName,
		);

		// Replace editor with wizard
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(wizard);
		this.ctx.ui.setFocus(wizard);
		this.ctx.ui.requestRender();
	}

	/**
	 * Handle OAuth authentication flow for MCP server
	 */
	async #handleOAuthFlow(
		authUrl: string,
		tokenUrl: string,
		clientId: string,
		clientSecret: string,
		scopes: string,
		callbackPort?: number,
		callbackPath?: string,
		redirectUri?: string,
		reviewTarget = "MCP server",
		revalidate?: () => Promise<void>,
	): Promise<string | null> {
		if (activeMcpOAuthFlows.has(this.ctx)) {
			this.ctx.showWarning("An MCP OAuth authorization is already running; duplicate request ignored.");
			return null;
		}
		let parsedAuthUrl: URL;

		// Validate OAuth URLs
		try {
			parsedAuthUrl = new URL(authUrl);
			new URL(tokenUrl);
		} catch (_error) {
			throw new Error(
				`Invalid OAuth URLs. Please check:\n  Authorization URL: ${authUrl}\n  Token URL: ${tokenUrl}`,
			);
		}

		const resolvedClientId = clientId.trim() || parsedAuthUrl.searchParams.get("client_id") || undefined;
		const resolvedClientSecret = clientSecret.trim() || undefined;
		const review = {
			identity: `mcp-oauth:${reviewTarget}:${parsedAuthUrl.origin}`,
			scope: `Remote OAuth authorization · ${parsedAuthUrl.origin}`,
			revision: mcpDigest({
				reviewTarget,
				authUrl,
				tokenUrl,
				resolvedClientId,
				scopes,
				redirectUri,
				callbackPort,
				callbackPath,
			}),
			changes: [
				{ field: "Authorization grant", before: "Not requested", after: `Requested for ${reviewTarget}` },
				{ field: "Authorization endpoint", before: "Not opened", after: safeMcpEndpoint(authUrl) },
				{ field: "Requested scopes", before: "None", after: scopes.trim() || "Provider default" },
				{
					field: "Client credential",
					before: "Not submitted",
					after: resolvedClientSecret ? "Submitted (masked)" : "Not supplied",
				},
			],
			consequence:
				"Opens the provider authorization page and may create or replace a remote grant. The returned credential remains only in memory until a separate save review succeeds. Authorization cannot be interrupted and times out after 5 minutes.",
		};
		const authorizationReview = await runReviewedAction(this.ctx, "MCP OAuth authorization", {
			review,
			resolve: async () => {
				await revalidate?.();
				return { target: undefined, review };
			},
			execute: async () => {},
		});
		if (authorizationReview !== "succeeded") {
			if (authorizationReview === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (authorizationReview === "unresolved")
				this.ctx.showError("OAuth authorization review remains unresolved. Reopen the command to retry.");
			return null;
		}

		activeMcpOAuthFlows.add(this.ctx);
		try {
			// Create OAuth flow
			const flow = new MCPOAuthFlow(
				{
					authorizationUrl: authUrl,
					tokenUrl: tokenUrl,
					clientId: resolvedClientId,
					clientSecret: resolvedClientSecret,
					scopes: scopes || undefined,
					redirectUri,
					callbackPort,
					callbackPath,
				},
				{
					onAuth: (info: { url: string; instructions?: string }) => showMcpOAuthAuthorization(this.ctx, info),
					onProgress: (message: string) => {
						this.ctx.chatContainer.addChild(new Spacer(1));
						this.ctx.chatContainer.addChild(new Text(theme.fg("muted", message), 1, 0));
						this.ctx.ui.requestRender();
					},
				},
			);

			// Execute OAuth flow with 5 minute timeout
			const credentials = await withTimeout(flow.login(), 5 * 60 * 1000, "OAuth flow timed out after 5 minutes");

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(new Text(theme.fg("success", "✓ Authorization completed in browser."), 1, 0));
			this.ctx.ui.requestRender();

			// Generate a unique credential ID
			const credentialId = `mcp_oauth_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

			// Keep the credential in memory until the encompassing server or
			// reauthorization review is confirmed.
			const oauthCredential: OAuthCredential = {
				type: "oauth",
				...credentials,
			};
			this.#pendingOAuthCredentials.set(credentialId, oauthCredential);

			return credentialId;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			// Provide helpful error messages based on failure type
			if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
				throw new Error("OAuth flow timed out. Please try again.");
			} else if (errorMsg.includes("403") || errorMsg.includes("unauthorized")) {
				throw new Error("OAuth authorization failed. Please check your client credentials.");
			} else if (errorMsg.includes("invalid_grant")) {
				throw new Error("OAuth authorization code is invalid or expired. Please try again.");
			} else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
				throw new Error("Could not connect to OAuth server. Please check the URLs and your network connection.");
			} else {
				throw new Error(`OAuth authentication failed: ${errorMsg}`);
			}
		} finally {
			activeMcpOAuthFlows.delete(this.ctx);
		}
	}

	/**
	 * Test connection to an MCP server.
	 * Throws an error if connection fails (used for auto-detection).
	 */
	async #handleTestConnection(config: MCPServerConfig): Promise<void> {
		// Create temporary connection using a test name
		const testName = `test_${Date.now()}`;
		let resolvedConfig: MCPServerConfig;
		if (this.ctx.mcpManager) {
			resolvedConfig = await this.ctx.mcpManager.prepareConfig(config);
		} else {
			const tempManager = new MCPManager(getProjectDir());
			tempManager.setAuthStorage(this.ctx.session.modelRegistry.authStorage);
			resolvedConfig = await tempManager.prepareConfig(config);
		}

		const connection = await connectToServer(testName, resolvedConfig);
		await disconnectServer(connection);
	}

	async #findConfiguredServer(
		name: string,
	): Promise<{ filePath: string; scope: "user" | "project"; config: MCPServerConfig } | null> {
		const cwd = getProjectDir();
		const userPath = getMCPConfigPath("user", cwd);
		const projectPath = getMCPConfigPath("project", cwd);

		const [userConfig, projectConfig] = await Promise.all([
			readMCPConfigFile(userPath),
			readMCPConfigFile(projectPath),
		]);

		if (userConfig.mcpServers?.[name]) {
			return { filePath: userPath, scope: "user", config: userConfig.mcpServers[name] };
		}
		if (projectConfig.mcpServers?.[name]) {
			return { filePath: projectPath, scope: "project", config: projectConfig.mcpServers[name] };
		}
		return null;
	}

	async #removeManagedOAuthCredential(credentialId: string | undefined): Promise<void> {
		if (!credentialId?.startsWith("mcp_oauth_")) return;
		await this.ctx.session.modelRegistry.authStorage.remove(credentialId);
	}

	#stripOAuthAuth(config: MCPServerConfig): MCPServerConfig {
		const next = { ...config } as MCPServerConfig & { auth?: MCPAuthConfig };
		delete next.auth;
		return next;
	}

	async #resolveOAuthEndpointsFromServer(config: MCPServerConfig): Promise<{
		authorizationUrl: string;
		tokenUrl: string;
		clientId?: string;
		scopes?: string;
	}> {
		// First test if server actually needs auth by connecting without OAuth
		let connectionSucceeded = false;
		let connectionError: Error | undefined;
		try {
			await this.#handleTestConnection(this.#stripOAuthAuth(config));
			connectionSucceeded = true;
		} catch (error) {
			connectionError = error as Error;
		}

		// Server connected fine without auth — reauth is not needed
		if (connectionSucceeded) {
			throw new Error("Server connection succeeded without OAuth; reauthorization is not required.");
		}

		// Analyze the connection error to extract OAuth endpoints
		const authResult = analyzeAuthError(connectionError!);
		let oauth = authResult.authType === "oauth" ? (authResult.oauth ?? null) : null;

		if (!oauth && (config.type === "http" || config.type === "sse") && config.url) {
			oauth = await discoverOAuthEndpoints(config.url, authResult.authServerUrl);
		}

		if (!oauth) {
			throw new Error("Could not discover OAuth endpoints from server response.");
		}

		return oauth;
	}

	async #waitForServerConnectionWithAnimation(
		name: string,
		options?: { suppressDisconnectedWarning?: boolean },
	): Promise<"connected" | "connecting" | "disconnected"> {
		if (!this.ctx.mcpManager) return "disconnected";

		this.ctx.chatContainer.addChild(new Spacer(1));
		const statusText = new Text(theme.fg("muted", `| Connecting to "${name}"...`), 1, 0);
		this.ctx.chatContainer.addChild(statusText);
		this.ctx.ui.requestRender();

		const frames = ["|", "/", "-", "\\"];
		let frame = 0;
		const interval = setInterval(() => {
			statusText.setText(theme.fg("muted", `${frames[frame % frames.length]} Connecting to "${name}"...`));
			frame++;
			this.ctx.ui.requestRender();
		}, 120);

		try {
			try {
				await withTimeout(this.ctx.mcpManager.waitForConnection(name), 10_000, "Connection still pending");
			} catch {
				// Ignore timeout/errors here and use status check below.
			}
			const state = this.ctx.mcpManager.getConnectionStatus(name);
			if (state === "connected") {
				// Connection may complete after initial reload; rebind runtime MCP tools now.
				await this.ctx.session.refreshMCPTools(this.ctx.mcpManager.getTools());
			}
			if (state === "connected") {
				statusText.setText(theme.fg("success", `✓ Connected to "${name}"`));
			} else if (state === "connecting") {
				statusText.setText(theme.fg("muted", `◌ "${name}" is still connecting...`));
			} else {
				statusText.setText(
					options?.suppressDisconnectedWarning
						? theme.fg("muted", `◌ Connection check complete for "${name}"`)
						: theme.fg("warning", `⚠ Could not connect to "${name}" yet`),
				);
			}
			this.ctx.ui.requestRender();
			return state;
		} finally {
			clearInterval(interval);
		}
	}

	async #syncManagerConnection(name: string, config: MCPServerConfig): Promise<void> {
		if (!this.ctx.mcpManager) return;
		if (this.ctx.mcpManager.getConnectionStatus(name) !== "disconnected") return;
		await this.ctx.mcpManager.connectServers({ [name]: config }, {});
		if (this.ctx.mcpManager.getConnectionStatus(name) === "connected") {
			await this.ctx.session.refreshMCPTools(this.ctx.mcpManager.getTools());
		}
	}

	async #handleWizardComplete(name: string, config: MCPServerConfig, scope: "user" | "project"): Promise<void> {
		const authStorage = this.ctx.session.modelRegistry.authStorage;
		const credentialId = (config as MCPServerConfig & { auth?: MCPAuthConfig }).auth?.credentialId;
		const pendingCredential = credentialId ? this.#pendingOAuthCredentials.get(credentialId) : undefined;
		try {
			const prepare = async () => {
				const filePath = getMCPConfigPath(scope, getProjectDir());
				const fileState = await readMCPConfigFile(filePath);
				const existing = fileState.mcpServers?.[name];
				if (existing && mcpDigest(existing) !== mcpDigest(config))
					throw new Error(`Server "${name}" now exists with different configuration in ${scope} scope.`);
				const credentialSaved = credentialId ? authStorage.has(credentialId) : true;
				if (credentialId && !credentialSaved && !pendingCredential)
					throw new Error(
						"The reviewed OAuth credential is no longer available. Run the authorization flow again.",
					);
				return {
					target: { filePath, needsConfigWrite: !existing, needsCredentialWrite: !credentialSaved },
					review: mcpServerReview(
						"add",
						{ name, scope, filePath, current: existing, proposed: config },
						fileState,
					),
				};
			};
			const prepared = await prepare();
			const outcome = await runReviewedAction(this.ctx, "MCP server addition", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => {
					let savedCredential = false;
					if (target.needsCredentialWrite && credentialId && pendingCredential) {
						await authStorage.set(credentialId, pendingCredential);
						savedCredential = true;
					}
					try {
						if (target.needsConfigWrite) await addMCPServer(target.filePath, name, config);
					} catch (error) {
						if (savedCredential && credentialId) await authStorage.remove(credentialId);
						throw error;
					}
				},
			});
			if (outcome !== "succeeded") {
				if (outcome !== "unresolved" && credentialId) this.#pendingOAuthCredentials.delete(credentialId);
				if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
				else if (outcome === "unresolved")
					this.ctx.showError(`MCP server addition for "${name}" remains unresolved. Reopen the command to retry.`);
				return;
			}
			if (credentialId) this.#pendingOAuthCredentials.delete(credentialId);

			let state: "connected" | "connecting" | "disconnected" = "disconnected";
			let connectionWarning: string | undefined;
			try {
				await this.#reloadMCP();
				state =
					config.enabled === false
						? "disconnected"
						: await this.#waitForServerConnectionWithAnimation(name, { suppressDisconnectedWarning: true });
				if (state === "connected" && this.ctx.mcpManager) {
					const serverTools = this.ctx.mcpManager.getTools().filter(tool => tool.mcpServerName === name);
					const currentActive = this.ctx.session.getActiveToolNames();
					const toActivate = serverTools
						.map(tool => tool.name)
						.filter(toolName => this.ctx.session.getToolByName(toolName));
					if (toActivate.length > 0)
						await this.ctx.session.setActiveToolsByName([...new Set([...currentActive, ...toActivate])]);
				}
			} catch (error) {
				connectionWarning = error instanceof Error ? error.message : String(error);
			}
			const connection =
				config.enabled === false
					? "disabled; connection not attempted"
					: state === "connected"
						? "connected"
						: state === "connecting"
							? "connecting"
							: "not connected";
			if (connectionWarning)
				this.ctx.showWarning(
					`Saved MCP server "${name}" in ${scope} configuration; runtime refresh failed: ${connectionWarning}`,
				);
			else this.ctx.showStatus(`Saved MCP server "${name}" in ${scope} configuration. Runtime: ${connection}.`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			// Provide helpful error messages
			let helpText = "";
			if (errorMsg.includes("EACCES") || errorMsg.includes("permission denied")) {
				helpText = "\n\nTip: Check file permissions for the config directory.";
			} else if (errorMsg.includes("ENOSPC")) {
				helpText = "\n\nTip: Insufficient disk space.";
			} else if (errorMsg.includes("already exists")) {
				helpText = `\n\nTip: Use ${theme.fg("contentAccent", "/mcp list")} to see existing servers.`;
			}

			this.ctx.showError(`Failed to add server: ${errorMsg}${helpText}`);
		}
	}

	#handleWizardCancel(): void {
		this.#showMessage(
			[
				"",
				theme.fg("muted", "Server creation cancelled."),
				theme.fg("dim", "No server configuration was saved."),
				"",
			].join("\n"),
		);
	}

	/**
	 * Handle /mcp list - Show all configured servers
	 */
	async #handleList(): Promise<void> {
		try {
			const cwd = getProjectDir();

			// Load from both user and project configs
			const userPath = getMCPConfigPath("user", cwd);
			const projectPath = getMCPConfigPath("project", cwd);

			const userPathLabel = shortenPath(userPath);
			const projectPathLabel = shortenPath(projectPath);
			const [userConfig, projectConfig] = await Promise.all([
				readMCPConfigFile(userPath),
				readMCPConfigFile(projectPath),
			]);

			const userServers = Object.keys(userConfig.mcpServers ?? {});
			const projectServers = Object.keys(projectConfig.mcpServers ?? {});

			// Collect runtime-discovered servers not in config files
			const configServerNames = new Set([...userServers, ...projectServers]);
			const disabledServerNames = new Set(await readDisabledServers(userPath));
			const discoveredServers: { name: string; source: SourceMeta }[] = [];
			if (this.ctx.mcpManager) {
				for (const name of this.ctx.mcpManager.getAllServerNames()) {
					if (configServerNames.has(name)) continue;
					if (disabledServerNames.has(name)) continue;
					const source = this.ctx.mcpManager.getSource(name);
					if (source) {
						discoveredServers.push({ name, source });
					}
				}
			}

			if (
				userServers.length === 0 &&
				projectServers.length === 0 &&
				discoveredServers.length === 0 &&
				disabledServerNames.size === 0
			) {
				await this.#showReport(
					"Configured MCP servers",
					"Saved configuration, discovery source, enabled state, and runtime connectivity",
					[
						"",
						theme.fg("muted", "No MCP servers configured."),
						"",
						`Use ${theme.fg("contentAccent", "/mcp add")} to add a server.`,
						"",
					].join("\n"),
				);
				return;
			}

			const lines: string[] = ["", theme.bold("Configured MCP Servers"), ""];

			// Show user-level servers
			if (userServers.length > 0) {
				lines.push(theme.fg("contentAccent", "User level") + theme.fg("muted", ` (${userPathLabel}):`));
				for (const name of userServers) {
					const config = userConfig.mcpServers![name];
					const type = config.type ?? "stdio";
					const state =
						config.enabled === false
							? "inactive"
							: (this.ctx.mcpManager?.getConnectionStatus(name) ?? "disconnected");
					const status =
						state === "inactive"
							? theme.fg("warning", " ◌ inactive")
							: state === "connected"
								? theme.fg("success", " ● connected")
								: state === "connecting"
									? theme.fg("muted", " ◌ connecting")
									: theme.fg("muted", " ○ not connected");
					lines.push(`  ${theme.fg("contentAccent", name)}${status} ${theme.fg("dim", `[${type}]`)}`);
				}
				lines.push("");
			}

			// Show project-level servers
			if (projectServers.length > 0) {
				lines.push(theme.fg("contentAccent", "Project level") + theme.fg("muted", ` (${projectPathLabel}):`));
				for (const name of projectServers) {
					const config = projectConfig.mcpServers![name];
					const type = config.type ?? "stdio";
					const state =
						config.enabled === false
							? "inactive"
							: (this.ctx.mcpManager?.getConnectionStatus(name) ?? "disconnected");
					const status =
						state === "inactive"
							? theme.fg("warning", " ◌ inactive")
							: state === "connected"
								? theme.fg("success", " ● connected")
								: state === "connecting"
									? theme.fg("muted", " ◌ connecting")
									: theme.fg("muted", " ○ not connected");
					lines.push(`  ${theme.fg("contentAccent", name)}${status} ${theme.fg("dim", `[${type}]`)}`);
				}
				lines.push("");
			}

			// Show discovered servers (from .xcsh.json, .cursor/mcp.json, .vscode/mcp.json, etc.)
			if (discoveredServers.length > 0) {
				// Group by source display name + path
				const bySource = new Map<string, typeof discoveredServers>();
				for (const entry of discoveredServers) {
					const key = `${entry.source.providerName}|${entry.source.path}`;
					let group = bySource.get(key);
					if (!group) {
						group = [];
						bySource.set(key, group);
					}
					group.push(entry);
				}

				for (const [key, entries] of bySource) {
					const sepIdx = key.indexOf("|");
					const providerName = key.slice(0, sepIdx);
					const sourcePath = key.slice(sepIdx + 1);
					const shortPath = shortenPath(sourcePath);
					lines.push(theme.fg("contentAccent", providerName) + theme.fg("muted", ` (${shortPath}):`));
					for (const { name } of entries) {
						const state = this.ctx.mcpManager!.getConnectionStatus(name);
						const status =
							state === "connected"
								? theme.fg("success", " ● connected")
								: state === "connecting"
									? theme.fg("muted", " ◌ connecting")
									: theme.fg("muted", " ○ not connected");
						lines.push(`  ${theme.fg("contentAccent", name)}${status}`);
					}
					lines.push("");
				}
			}

			// Show servers disabled via /mcp disable (from third-party configs)
			const relevantDisabled = [...disabledServerNames].filter(n => !configServerNames.has(n));
			if (relevantDisabled.length > 0) {
				lines.push(theme.fg("contentAccent", "Disabled") + theme.fg("muted", " (discovered servers):"));
				for (const name of relevantDisabled) {
					lines.push(`  ${theme.fg("contentAccent", name)}${theme.fg("warning", " ◌ disabled")}`);
				}
				lines.push("");
			}
			await this.#showReport(
				"Configured MCP servers",
				"Saved configuration, discovery source, enabled state, and runtime connectivity",
				lines.join("\n"),
			);
		} catch (error) {
			this.ctx.showError(`Failed to list servers: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handle /mcp remove <name> - Remove a server
	 */
	async #handleRemove(text: string): Promise<void> {
		const match = text.match(/^\/mcp\s+(?:remove|rm)\b\s*(.*)$/i);
		const rest = match?.[1]?.trim() ?? "";
		const tokens = parseCommandArgs(rest);

		let name: string | undefined;
		let scope: "project" | "user" = "project";
		let i = 0;

		if (tokens.length > 0 && !tokens[0].startsWith("-")) {
			name = tokens[0];
			i = 1;
		}

		while (i < tokens.length) {
			const token = tokens[i];
			if (token === "--scope") {
				const value = tokens[i + 1];
				if (!value || (value !== "project" && value !== "user")) {
					this.ctx.showError(t("mcp.errors.invalidScope"));
					return;
				}
				scope = value;
				i += 2;
				continue;
			}
			this.ctx.showError(t("mcp.errors.unknownOption", { option: token }));
			return;
		}

		if (!name) {
			this.ctx.showError(t("mcp.remove.usage"));
			return;
		}

		try {
			const prepare = async () => {
				const filePath = getMCPConfigPath(scope, getProjectDir());
				const fileState = await readMCPConfigFile(filePath);
				const current = fileState.mcpServers?.[name];
				if (!current) throw new Error(t("mcp.errors.serverNotFoundInScope", { name, scope }));
				return {
					target: { filePath, current },
					review: mcpServerReview("remove", { name, scope, filePath, current }, fileState),
				};
			};
			const prepared = await prepare();
			let credentialWarning: string | undefined;
			const outcome = await runReviewedAction(this.ctx, "MCP server removal", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => {
					await removeMCPServer(target.filePath, name);
					const credentialId = (target.current as MCPServerConfig & { auth?: MCPAuthConfig }).auth?.credentialId;
					try {
						await this.#removeManagedOAuthCredential(credentialId);
					} catch (error) {
						credentialWarning = error instanceof Error ? error.message : String(error);
					}
				},
			});
			if (outcome === "busy") {
				this.ctx.showStatus("Another reviewed action is already open.");
				return;
			}
			if (outcome === "unresolved") {
				this.ctx.showError(`MCP server removal for "${name}" remains unresolved. Reopen the command to retry.`);
				return;
			}
			if (outcome !== "succeeded") return;
			let runtimeWarning: string | undefined;
			try {
				if (this.ctx.mcpManager?.getConnection(name)) await this.ctx.mcpManager.disconnectServer(name);
				await this.#reloadMCP();
			} catch (error) {
				runtimeWarning = error instanceof Error ? error.message : String(error);
			}
			const warnings = [
				credentialWarning && `managed credential cleanup failed: ${credentialWarning}`,
				runtimeWarning && `runtime refresh failed: ${runtimeWarning}`,
			].filter(Boolean);
			if (warnings.length)
				this.ctx.showWarning(`Removed MCP server "${name}" from ${scope} configuration; ${warnings.join("; ")}.`);
			else this.ctx.showStatus(`Removed MCP server "${name}" from ${scope} configuration.`);
		} catch (error) {
			this.ctx.showError(
				t("mcp.remove.failed", { message: error instanceof Error ? error.message : String(error) }),
			);
		}
	}

	/**
	 * Handle /mcp test <name> - Test connection to a server
	 */
	async #handleTest(name: string | undefined): Promise<void> {
		if (!name) {
			this.ctx.showError(t("mcp.test.usage"));
			return;
		}
		if (activeMcpRuntimeOperations.has(this.ctx)) {
			this.ctx.showStatus("An MCP runtime operation is already running; duplicate request ignored.");
			return;
		}
		activeMcpRuntimeOperations.add(this.ctx);

		const loader = new BorderedLoader(this.ctx.ui, theme, `Testing MCP connection "${name}"`, true);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();

		let connection: MCPServerConnection | undefined;
		try {
			const cwd = getProjectDir();
			const userPath = getMCPConfigPath("user", cwd);
			const projectPath = getMCPConfigPath("project", cwd);

			// Find the server config
			const [userConfig, projectConfig] = await Promise.all([
				readMCPConfigFile(userPath),
				readMCPConfigFile(projectPath),
			]);

			const config = userConfig.mcpServers?.[name] ?? projectConfig.mcpServers?.[name];

			if (!config) {
				this.ctx.showError(t("mcp.errors.serverNotFound", { name }));
				return;
			}
			if (config.enabled === false) {
				this.ctx.showError(t("mcp.test.disabled", { name }));
				return;
			}

			// Resolve auth config if needed
			let resolvedConfig: MCPServerConfig;
			if (this.ctx.mcpManager) {
				resolvedConfig = await this.ctx.mcpManager.prepareConfig(config);
			} else {
				const tempManager = new MCPManager(getProjectDir());
				tempManager.setAuthStorage(this.ctx.session.modelRegistry.authStorage);
				resolvedConfig = await tempManager.prepareConfig(config);
			}

			// Create temporary connection
			connection = await connectToServer(name, resolvedConfig, { signal: loader.signal });

			// List tools to verify connection
			const tools = await listTools(connection, { signal: loader.signal });

			const lines = [
				"",
				theme.fg("success", `✓ Successfully connected to "${name}"`),
				"",
				`  Server: ${connection.serverInfo.name} v${connection.serverInfo.version}`,
				`  Tools: ${tools.length}`,
			];

			// Show tool names if there are any
			if (tools.length > 0 && tools.length <= 10) {
				lines.push("");
				lines.push("  Available tools:");
				for (const tool of tools) {
					lines.push(`    • ${tool.name}`);
				}
			}

			lines.push("");
			await this.#syncManagerConnection(name, config);
			await this.#showReport(
				`MCP connection: ${name}`,
				"Connectivity test only · saved configuration and authentication are unchanged",
				lines.join("\n"),
			);
		} catch (error) {
			if (loader.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
				this.ctx.showStatus(t("mcp.test.cancelled", { name }));
				return;
			}

			const errorMsg = error instanceof Error ? error.message : String(error);

			// Provide helpful error messages
			let helpText = "";
			if (errorMsg.includes("ENOENT") || errorMsg.includes("not found")) {
				helpText = "\n\nTip: Check that the command or URL is correct.";
			} else if (errorMsg.includes("EACCES")) {
				helpText = "\n\nTip: Check file/command permissions.";
			} else if (errorMsg.includes("ECONNREFUSED")) {
				helpText = "\n\nTip: Check that the server is running and the URL/port is correct.";
			} else if (errorMsg.includes("timeout")) {
				helpText = "\n\nTip: The server may be slow or unresponsive. Try increasing the timeout.";
			} else if (errorMsg.includes("401") || errorMsg.includes("403")) {
				helpText = "\n\nTip: Check your authentication credentials.";
			}

			this.ctx.showError(t("mcp.test.failed", { name, message: errorMsg + helpText }));
		} finally {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
			if (connection) {
				// Best-effort: don't block UI on cleanup.
				void disconnectServer(connection);
			}
			activeMcpRuntimeOperations.delete(this.ctx);
		}
	}

	async #handleSetEnabled(name: string | undefined, enabled: boolean): Promise<void> {
		if (!name) {
			this.ctx.showError(t(enabled ? "mcp.enable.usage" : "mcp.disable.usage"));
			return;
		}

		try {
			const found = await this.#findConfiguredServer(name);
			if (!found) {
				// Check if this is a discovered server from a third-party config
				const userConfigPath = getMCPConfigPath("user", getProjectDir());
				const disabledServers = new Set(await readDisabledServers(userConfigPath));
				const isDiscovered = this.ctx.mcpManager?.getSource(name);
				const isCurrentlyDisabled = disabledServers.has(name);
				if (!isDiscovered && !isCurrentlyDisabled) {
					this.ctx.showError(t("mcp.errors.serverNotFound", { name }));
					return;
				}
				if (isCurrentlyDisabled === !enabled) {
					this.#showMessage(
						["", theme.fg("muted", `Server "${name}" is already ${enabled ? "enabled" : "disabled"}.`), ""].join(
							"\n",
						),
					);
					return;
				}
				const prepare = async () => {
					const currentDisabled = new Set(await readDisabledServers(userConfigPath));
					const source = this.ctx.mcpManager?.getSource(name);
					if (!source && !currentDisabled.has(name)) throw new Error(t("mcp.errors.serverNotFound", { name }));
					const before = currentDisabled.has(name) ? "Disabled" : "Enabled";
					return {
						target: undefined,
						review: {
							identity: `mcp-server:discovered:${name}`,
							scope: `User MCP disabled-server registry · ${userConfigPath}`,
							revision: mcpDigest({ disabled: [...currentDisabled].sort(), source }),
							changes: [{ field: "Enabled state", before, after: enabled ? "Enabled" : "Disabled" }],
							consequence:
								"Persists an override for a read-only discovered server, then refreshes runtime connections and tools. Its source configuration is not edited.",
						},
					};
				};
				const prepared = await prepare();
				const outcome = await runReviewedAction(this.ctx, `MCP server ${enabled ? "enable" : "disable"}`, {
					review: prepared.review,
					resolve: prepare,
					execute: async () => setServerDisabled(userConfigPath, name, !enabled),
				});
				if (outcome === "busy") {
					this.ctx.showStatus("Another reviewed action is already open.");
					return;
				}
				if (outcome === "unresolved") {
					this.ctx.showError(
						`The enabled-state change for "${name}" remains unresolved. Reopen the command to retry.`,
					);
					return;
				}
				if (outcome !== "succeeded") return;
				if (enabled) {
					await this.#reloadMCP();
					const state = await this.#waitForServerConnectionWithAnimation(name);
					const status =
						state === "connected"
							? theme.fg("success", "Connected")
							: state === "connecting"
								? theme.fg("muted", "Connecting")
								: theme.fg("warning", "Not connected yet");
					this.#showMessage(
						["", theme.fg("success", `\u2713 Enabled "${name}"`), "", `  Status: ${status}`, ""].join("\n"),
					);
				} else {
					await this.ctx.mcpManager?.disconnectServer(name);
					await this.ctx.session.refreshMCPTools(this.ctx.mcpManager?.getTools() ?? []);
					this.#showMessage(["", theme.fg("success", `\u2713 Disabled "${name}"`), ""].join("\n"));
				}
				return;
			}

			if ((found.config.enabled ?? true) === enabled) {
				this.#showMessage(
					["", theme.fg("muted", `Server "${name}" is already ${enabled ? "enabled" : "disabled"}.`), ""].join(
						"\n",
					),
				);
				return;
			}

			const prepare = async () => {
				const current = await this.#findConfiguredServer(name);
				if (!current) throw new Error(t("mcp.errors.serverNotFound", { name }));
				if (current.scope !== found.scope || current.filePath !== found.filePath)
					throw new Error("The server scope changed. Open the command again.");
				const fileState = await readMCPConfigFile(current.filePath);
				const proposed: MCPServerConfig = { ...current.config, enabled };
				return {
					target: { ...current, proposed },
					review: mcpServerReview(
						enabled ? "enable" : "disable",
						{
							name,
							scope: current.scope,
							filePath: current.filePath,
							current: current.config,
							proposed,
						},
						fileState,
					),
				};
			};
			const prepared = await prepare();
			const outcome = await runReviewedAction(this.ctx, `MCP server ${enabled ? "enable" : "disable"}`, {
				review: prepared.review,
				resolve: prepare,
				execute: async target => updateMCPServer(target.filePath, name, target.proposed),
			});
			if (outcome === "busy") {
				this.ctx.showStatus("Another reviewed action is already open.");
				return;
			}
			if (outcome === "unresolved") {
				this.ctx.showError(
					`The enabled-state change for "${name}" remains unresolved. Reopen the command to retry.`,
				);
				return;
			}
			if (outcome !== "succeeded") return;
			try {
				await this.#reloadMCP();
			} catch (error) {
				this.ctx.showWarning(
					`Saved "${name}" as ${enabled ? "enabled" : "disabled"} in ${found.scope} configuration; runtime refresh failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}

			let status = "";
			if (enabled) {
				const state = await this.#waitForServerConnectionWithAnimation(name);
				status =
					state === "connected"
						? theme.fg("success", "Connected")
						: state === "connecting"
							? theme.fg("muted", "Connecting")
							: theme.fg("warning", "Not connected yet");
			}

			const lines = [
				"",
				theme.fg("success", `✓ ${enabled ? "Enabled" : "Disabled"} "${name}" (${found.scope} config)`),
			];
			if (status) {
				lines.push("");
				lines.push(`  Status: ${status}`);
			}
			lines.push("");
			this.#showMessage(lines.join("\n"));
		} catch (error) {
			this.ctx.showError(
				t("mcp.setEnabled.failed", {
					action: enabled ? t("mcp.action.enable") : t("mcp.action.disable"),
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}

	async #handleUnauth(name: string | undefined): Promise<void> {
		if (!name) {
			this.ctx.showError(t("mcp.unauth.usage"));
			return;
		}

		try {
			const found = await this.#findConfiguredServer(name);
			if (!found) {
				this.ctx.showError(t("mcp.errors.serverNotFound", { name }));
				return;
			}

			const initialAuth = (found.config as MCPServerConfig & { auth?: MCPAuthConfig }).auth;
			if (!initialAuth) {
				this.ctx.showStatus(`Server "${name}" has no saved OAuth association.`);
				return;
			}
			const prepare = async () => {
				const current = await this.#findConfiguredServer(name);
				if (!current || current.filePath !== found.filePath)
					throw new Error("The server target changed. Open the command again.");
				const auth = (current.config as MCPServerConfig & { auth?: MCPAuthConfig }).auth;
				if (!auth) throw new Error("The saved OAuth association was already removed.");
				const proposed = this.#stripOAuthAuth(current.config);
				const fileState = await readMCPConfigFile(current.filePath);
				return {
					target: { ...current, proposed, credentialId: auth.credentialId },
					review: mcpServerReview(
						"unauth",
						{
							name,
							scope: current.scope,
							filePath: current.filePath,
							current: current.config,
							proposed,
						},
						fileState,
					),
				};
			};
			const prepared = await prepare();
			let credentialWarning: string | undefined;
			const outcome = await runReviewedAction(this.ctx, "MCP authorization removal", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => {
					await updateMCPServer(target.filePath, name, target.proposed);
					try {
						await this.#removeManagedOAuthCredential(target.credentialId);
					} catch (error) {
						credentialWarning = error instanceof Error ? error.message : String(error);
					}
				},
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "unresolved")
				this.ctx.showError(`Authorization removal for "${name}" remains unresolved. Reopen the command to retry.`);
			else if (outcome === "succeeded") {
				try {
					await this.#reloadMCP();
				} catch (error) {
					this.ctx.showWarning(
						`Removed saved auth for "${name}"; runtime refresh failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					return;
				}
				if (credentialWarning)
					this.ctx.showWarning(
						`Removed the server's OAuth association; managed credential cleanup failed: ${credentialWarning}`,
					);
				else this.ctx.showStatus(`Removed saved OAuth authorization for "${name}" (${found.scope} configuration).`);
			}
		} catch (error) {
			this.ctx.showError(
				t("mcp.unauth.failed", { message: error instanceof Error ? error.message : String(error) }),
			);
		}
	}

	async #handleReauth(name: string | undefined): Promise<void> {
		if (!name) {
			this.ctx.showError(t("mcp.reauth.usage"));
			return;
		}

		try {
			const found = await this.#findConfiguredServer(name);
			if (!found) {
				this.ctx.showError(t("mcp.errors.serverNotFound", { name }));
				return;
			}

			if (found.config.enabled === false) {
				this.ctx.showError(t("mcp.reauth.disabled", { name }));
				return;
			}

			const currentAuth = (found.config as MCPServerConfig & { auth?: MCPAuthConfig }).auth;
			const baseConfig = this.#stripOAuthAuth(found.config);
			const oauth = await this.#resolveOAuthEndpointsFromServer(baseConfig);
			const oauthClientSecret = found.config.oauth?.clientSecret ?? currentAuth?.clientSecret ?? "";

			this.#showMessage(["", theme.fg("muted", `Reauthorizing "${name}"...`), ""].join("\n"));

			const credentialId = await this.#handleOAuthFlow(
				oauth.authorizationUrl,
				oauth.tokenUrl,
				oauth.clientId ?? found.config.oauth?.clientId ?? "",
				oauthClientSecret,
				oauth.scopes ?? "",
				found.config.oauth?.callbackPort,
				found.config.oauth?.callbackPath,
				found.config.oauth?.redirectUri,
				`${name} (${found.scope} configuration)`,
				async () => {
					const current = await this.#findConfiguredServer(name);
					if (
						!current ||
						current.filePath !== found.filePath ||
						mcpDigest(current.config) !== mcpDigest(found.config)
					) {
						throw new Error("The server configuration changed. Review /mcp reauth again.");
					}
				},
			);
			if (!credentialId) return;

			const updated: MCPServerConfig = {
				...baseConfig,
				auth: {
					type: "oauth",
					credentialId,
					tokenUrl: oauth.tokenUrl,
					clientId: oauth.clientId ?? found.config.oauth?.clientId,
					clientSecret: oauthClientSecret || undefined,
				},
			};
			const pendingCredential = this.#pendingOAuthCredentials.get(credentialId);
			if (!pendingCredential) throw new Error("The new OAuth credential is no longer available.");
			const authStorage = this.ctx.session.modelRegistry.authStorage;
			const prepare = async () => {
				const current = await this.#findConfiguredServer(name);
				if (
					!current ||
					current.filePath !== found.filePath ||
					mcpDigest(current.config) !== mcpDigest(found.config)
				)
					throw new Error("The server configuration changed during authorization. Open /mcp reauth again.");
				const fileState = await readMCPConfigFile(current.filePath);
				return {
					target: current,
					review: mcpServerReview(
						"reauth",
						{
							name,
							scope: current.scope,
							filePath: current.filePath,
							current: current.config,
							proposed: updated,
						},
						fileState,
					),
				};
			};
			const prepared = await prepare();
			let oldCredentialWarning: string | undefined;
			const outcome = await runReviewedAction(this.ctx, "MCP reauthorization", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => {
					await authStorage.set(credentialId, pendingCredential);
					try {
						await updateMCPServer(target.filePath, name, updated);
					} catch (error) {
						await authStorage.remove(credentialId);
						throw error;
					}
					try {
						await this.#removeManagedOAuthCredential(currentAuth?.credentialId);
					} catch (error) {
						oldCredentialWarning = error instanceof Error ? error.message : String(error);
					}
				},
			});
			if (outcome !== "succeeded") {
				if (outcome !== "unresolved") this.#pendingOAuthCredentials.delete(credentialId);
				if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
				else if (outcome === "unresolved")
					this.ctx.showError(`Reauthorization for "${name}" remains unresolved. Reopen the command to retry.`);
				return;
			}
			this.#pendingOAuthCredentials.delete(credentialId);
			let state: "connected" | "connecting" | "disconnected" = "disconnected";
			try {
				await this.#reloadMCP();
				state = await this.#waitForServerConnectionWithAnimation(name);
			} catch (error) {
				this.ctx.showWarning(
					`Saved new authorization for "${name}"; runtime refresh failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}

			const lines = [
				"",
				theme.fg("success", `✓ Reauthorized "${name}" (${found.scope} config)`),
				"",
				`  Status: ${
					state === "connected"
						? theme.fg("success", "connected")
						: state === "connecting"
							? theme.fg("muted", "connecting")
							: theme.fg("warning", "not connected")
				}`,
				"",
			];
			if (oldCredentialWarning)
				lines.push(theme.fg("warning", `Old managed credential cleanup failed: ${oldCredentialWarning}`));
			this.#showMessage(lines.join("\n"));
		} catch (error) {
			this.ctx.showError(
				t("mcp.reauth.failed", { message: error instanceof Error ? error.message : String(error) }),
			);
		}
	}

	async #handleReload(): Promise<void> {
		if (activeMcpRuntimeOperations.has(this.ctx)) {
			this.ctx.showStatus("An MCP runtime operation is already running; duplicate request ignored.");
			return;
		}
		activeMcpRuntimeOperations.add(this.ctx);
		const loader = new BorderedLoader(this.ctx.ui, theme, "Reloading MCP servers and runtime tools", false);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();
		try {
			await this.#reloadMCP();
			const connectedCount = this.ctx.mcpManager?.getConnectedServers().length ?? 0;
			this.ctx.showStatus(`MCP reload complete. Connected servers: ${connectedCount}.`);
		} catch (error) {
			this.ctx.showError(
				t("mcp.reload.failed", { message: error instanceof Error ? error.message : String(error) }),
			);
		} finally {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
			activeMcpRuntimeOperations.delete(this.ctx);
		}
	}

	/**
	 * Handle /mcp reconnect <name> - Reconnect to a specific server.
	 */
	async #handleReconnect(name: string | undefined): Promise<void> {
		if (!name) {
			this.ctx.showError(t("mcp.reconnect.usage"));
			return;
		}
		if (!this.ctx.mcpManager) {
			this.ctx.showError(t("mcp.errors.noManager"));
			return;
		}
		if (activeMcpRuntimeOperations.has(this.ctx)) {
			this.ctx.showStatus("An MCP runtime operation is already running; duplicate request ignored.");
			return;
		}
		activeMcpRuntimeOperations.add(this.ctx);
		const loader = new BorderedLoader(this.ctx.ui, theme, `Reconnecting MCP server "${name}"`, false);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();

		try {
			const connection = await this.ctx.mcpManager.reconnectServer(name);
			if (connection) {
				// refreshMCPTools re-registers tools and preserves the user's prior
				// MCP tool selection. No need to call activateDiscoveredMCPTools —
				// that would broaden the selection to all server tools.
				await this.ctx.session.refreshMCPTools(this.ctx.mcpManager.getTools());
				const serverTools = this.ctx.mcpManager.getTools().filter(t => t.mcpServerName === name);
				this.ctx.showStatus(`Reconnected to "${name}". Runtime tools: ${serverTools.length}.`);
			} else {
				this.ctx.showError(t("mcp.reconnect.failed", { name }));
			}
		} catch (error) {
			this.ctx.showError(
				t("mcp.reconnect.failedWithError", {
					name,
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
			activeMcpRuntimeOperations.delete(this.ctx);
		}
	}

	/**
	 * Reload MCP manager with new configs
	 */
	async #reloadMCP(): Promise<void> {
		if (!this.ctx.mcpManager) {
			return;
		}

		// Disconnect all existing servers
		await this.ctx.mcpManager.disconnectAll();

		// Rediscover and connect
		const result = await this.ctx.mcpManager.discoverAndConnect();
		await this.ctx.session.refreshMCPTools(this.ctx.mcpManager.getTools());

		// Show any connection errors
		if (result.errors.size > 0) {
			const errorLines = ["", theme.fg("warning", "Some servers failed to connect:"), ""];
			for (const [serverName, error] of result.errors.entries()) {
				errorLines.push(`  ${serverName}: ${error}`);
			}
			errorLines.push("");
			this.#showMessage(errorLines.join("\n"));
		}
	}

	/**
	 * Handle /mcp resources - Show available resources from connected servers
	 */
	async #handleResources(): Promise<void> {
		if (!this.ctx.mcpManager) {
			this.ctx.showError(t("mcp.errors.noManager"));
			return;
		}

		const servers = this.ctx.mcpManager.getConnectedServers();
		const lines: string[] = ["", theme.bold("MCP Resources"), ""];
		let hasAny = false;

		for (const name of servers) {
			const data = this.ctx.mcpManager.getServerResources(name);
			if (!data) continue;
			const { resources, templates } = data;
			if (resources.length === 0 && templates.length === 0) continue;
			hasAny = true;

			lines.push(`${theme.fg("contentAccent", name)}:`);
			for (const r of resources) {
				const desc = r.description ? ` ${theme.fg("dim", r.description)}` : "";
				const mime = r.mimeType ? ` ${theme.fg("dim", `[${r.mimeType}]`)}` : "";
				lines.push(`  ${theme.fg("success", r.uri)}${mime}${desc}`);
			}
			if (templates.length > 0) {
				lines.push(`  ${theme.fg("muted", "Templates:")}`);
				for (const t of templates) {
					const desc = t.description ? ` ${theme.fg("dim", t.description)}` : "";
					lines.push(`    ${theme.fg("contentAccent", t.uriTemplate)}${desc}`);
				}
			}
			lines.push("");
		}

		if (!hasAny) {
			lines.push(theme.fg("muted", "No resources available on connected servers."));
			lines.push("");
		}
		await this.#showReport("MCP resources", "Connected servers · read-only resource catalog", lines.join("\n"));
	}

	/**
	 * Handle /mcp prompts - Show available prompts from connected servers
	 */
	async #handlePrompts(): Promise<void> {
		if (!this.ctx.mcpManager) {
			this.ctx.showError(t("mcp.errors.noManager"));
			return;
		}

		const servers = this.ctx.mcpManager.getConnectedServers();
		const lines: string[] = ["", theme.bold("MCP Prompts"), ""];
		let hasAny = false;

		for (const name of servers) {
			const prompts = this.ctx.mcpManager.getServerPrompts(name);
			if (!prompts?.length) continue;
			hasAny = true;

			lines.push(`${theme.fg("contentAccent", name)}:`);
			for (const p of prompts) {
				const commandName = `${name}:${p.name}`;
				const desc = p.description ? ` ${theme.fg("dim", p.description)}` : "";
				lines.push(`  ${theme.fg("success", `/${commandName}`)}${desc}`);
				if (p.arguments?.length) {
					for (const arg of p.arguments) {
						const required = arg.required ? theme.fg("warning", " *") : "";
						const argDesc = arg.description ? ` - ${arg.description}` : "";
						lines.push(`    ${arg.name}=${required}${theme.fg("dim", argDesc)}`);
					}
				}
			}
			lines.push("");
		}

		if (!hasAny) {
			lines.push(theme.fg("muted", "No prompts available on connected servers."));
			lines.push("");
		}
		await this.#showReport(
			"MCP prompts",
			"Connected servers · prompt expansion does not execute a prompt",
			lines.join("\n"),
		);
	}

	/**
	 * Handle /mcp notifications - Show notification and subscription state
	 */
	async #handleNotifications(): Promise<void> {
		if (!this.ctx.mcpManager) {
			this.ctx.showError(t("mcp.errors.noManager"));
			return;
		}

		const { enabled, subscriptions } = this.ctx.mcpManager.getNotificationState();
		const servers = this.ctx.mcpManager.getConnectedServers();
		const statusIcon = enabled ? theme.fg("success", "enabled") : theme.fg("warning", "disabled");
		const lines: string[] = ["", theme.bold("MCP Notifications"), ""];
		lines.push(`  Status: ${statusIcon}  ${theme.fg("dim", "(mcp.notifications setting)")}`);
		lines.push("");

		let hasAny = false;
		for (const name of servers) {
			const connection = this.ctx.mcpManager.getConnection(name);
			if (!connection) continue;
			const caps = connection.capabilities;
			const supportsResources = caps.resources !== undefined;
			const supportsSubscribe = caps.resources?.subscribe === true;
			const supportsToolsChanged = caps.tools?.listChanged === true;
			const supportsPromptsChanged = caps.prompts?.listChanged === true;
			const supportsResourcesChanged = caps.resources?.listChanged === true;

			const hasNotifications =
				supportsToolsChanged || supportsPromptsChanged || supportsResourcesChanged || supportsSubscribe;
			if (!hasNotifications) continue;
			hasAny = true;

			lines.push(`${theme.fg("contentAccent", name)}:`);
			const check = theme.fg("success", "\u2713");
			const cross = theme.fg("dim", "\u2717");
			if (supportsToolsChanged) lines.push(`  ${check} tools/list_changed`);
			if (supportsResourcesChanged) lines.push(`  ${check} resources/list_changed`);
			if (supportsPromptsChanged) lines.push(`  ${check} prompts/list_changed`);

			if (supportsSubscribe) {
				const subscribedUris = subscriptions.get(name);
				const subCount = subscribedUris?.size ?? 0;
				const subStatus =
					enabled && subCount > 0
						? theme.fg("success", `subscribed (${subCount} URI${subCount !== 1 ? "s" : ""})`)
						: enabled
							? theme.fg("muted", "no active subscriptions")
							: theme.fg("dim", "inactive (notifications disabled)");
				lines.push(`  ${check} resources/subscribe  ${subStatus}`);
				if (enabled && subscribedUris && subscribedUris.size > 0) {
					for (const uri of subscribedUris) {
						lines.push(`    ${theme.fg("success", "\u2713")} ${theme.fg("dim", uri)}`);
					}
				}
			} else if (supportsResources) {
				lines.push(`  ${cross} resources/subscribe  ${theme.fg("dim", "not supported")}`);
			}
			lines.push("");
		}

		if (!hasAny) {
			lines.push(theme.fg("muted", "No servers support notifications."));
			lines.push("");
		}
		await this.#showReport(
			"MCP notifications",
			"Effective setting, server capabilities, and runtime subscriptions",
			lines.join("\n"),
		);
	}

	async #validateSmitheryApiKey(apiKey: string): Promise<void> {
		await this.#dependencies.searchSmitheryRegistry("mcp", { limit: 1, apiKey });
	}

	async #promptSmitheryApiKey(promptLabel: string): Promise<string | null> {
		for (;;) {
			const input = await this.ctx.showHookInput(promptLabel);
			if (input === undefined) return null;
			const apiKey = input.trim();
			if (!apiKey) {
				this.ctx.showError(t("mcp.smithery.keyEmpty"));
				continue;
			}
			try {
				await this.#validateSmitheryApiKey(apiKey);
				return apiKey;
			} catch (error) {
				this.ctx.showError(
					t("mcp.smithery.validationFailed", { message: error instanceof Error ? error.message : String(error) }),
				);
			}
		}
	}

	async #saveSmitheryApiKeyReviewed(apiKey: string): Promise<boolean> {
		const proposalDigest = mcpDigest(apiKey);
		const prepare = async () => {
			const current = await this.#dependencies.getSmitheryApiKey();
			return {
				target: undefined,
				review: {
					identity: "credential:smithery",
					scope: "User credential storage · Smithery registry",
					revision: mcpDigest({ current: current ? mcpDigest(current) : null, proposalDigest }),
					changes: [
						{
							field: "API credential",
							before: current ? "Saved (masked)" : "Absent",
							after: current && mcpDigest(current) === proposalDigest ? "Unchanged (masked)" : "Saved (masked)",
						},
					],
					consequence:
						"Persists the validated Smithery API key for future registry searches. The credential is masked and is not added to command history.",
				},
			};
		};
		const prepared = await prepare();
		const outcome = await runReviewedAction(this.ctx, "Smithery credential save", {
			review: prepared.review,
			resolve: prepare,
			execute: async () => this.#dependencies.saveSmitheryApiKey(apiKey),
		});
		if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
		else if (outcome === "unresolved")
			this.ctx.showError("Smithery credential save remains unresolved. Reopen /mcp smithery-login to retry.");
		return outcome === "succeeded";
	}

	async #handleSmitheryLoginWithApiKey(): Promise<boolean> {
		const apiKey = await this.#promptSmitheryApiKey("Smithery API key (Esc to cancel)");
		if (!apiKey) return false;
		const saved = await this.#saveSmitheryApiKeyReviewed(apiKey);
		if (saved) this.ctx.showStatus(t("mcp.smithery.keySaved"));
		return saved;
	}

	async #waitForSmitheryCliApiKey(sessionId: string, signal: AbortSignal): Promise<string> {
		const pollIntervalMs = 2_000;
		const timeoutMs = 300_000;
		const startedAt = this.#dependencies.now();

		while (!signal.aborted) {
			if (this.#dependencies.now() - startedAt >= timeoutMs) {
				throw new Error("Smithery authorization timed out after 5 minutes.");
			}
			const response = await this.#dependencies.pollSmitheryCliAuthSession(sessionId, signal);
			if (response.status === "success" && response.apiKey) {
				return response.apiKey;
			}
			if (response.status === "error") {
				throw new Error(response.message ?? "Smithery authorization failed.");
			}
			await this.#dependencies.sleep(pollIntervalMs);
		}

		throw new Error("Smithery authorization cancelled.");
	}

	async #handleSmitheryBrowserLogin(): Promise<boolean> {
		const origin = new URL(this.#dependencies.getSmitheryLoginUrl()).origin;
		const prepare = async () => ({
			target: origin,
			review: {
				identity: `remote-auth:smithery:${origin}`,
				scope: `Smithery browser authentication · ${origin}`,
				revision: mcpDigest(origin),
				changes: [
					{ field: "Remote authorization session", before: "Absent", after: "Create and poll until resolved" },
					{ field: "Browser navigation", before: "No Smithery page open", after: "Open the returned sign-in URL" },
				],
				consequence:
					"Creates a short-lived remote Smithery authorization session, opens its returned URL in the local browser, and polls for a one-time API credential. Interruption stops polling; any created remote session expires under Smithery policy. Credential persistence is reviewed separately.",
			},
		});
		const proposal = await prepare();
		let apiKey: string | undefined;
		const outcome = await runReviewedAction(this.ctx, "Smithery browser login", {
			review: proposal.review,
			resolve: prepare,
			cancellable: true,
			execute: async (_target, signal) => {
				try {
					const session = await this.#dependencies.createSmitheryCliAuthSession(signal);
					const opened = await this.ctx.openHttpUrl(session.authUrl);
					if (!opened.ok)
						throw new Error(`Could not open the Smithery sign-in page: ${opened.error}. URL: ${session.authUrl}`);
					apiKey = await this.#waitForSmitheryCliApiKey(session.sessionId, signal);
					await this.#validateSmitheryApiKey(apiKey);
				} catch (error) {
					if (signal.aborted || (error instanceof Error && error.name === "AbortError"))
						throw new ActionInterruptedError("Smithery browser authorization interrupted.");
					throw error;
				}
			},
		});
		if (outcome === "busy") {
			this.ctx.showStatus("Another reviewed action is already open.");
			return false;
		}
		if (outcome === "unresolved") throw new Error("Smithery browser authorization remains unresolved.");
		if (outcome !== "succeeded" || !apiKey) return false;
		const saved = await this.#saveSmitheryApiKeyReviewed(apiKey);
		if (saved) this.ctx.showStatus(t("mcp.smithery.keySaved"));
		return saved;
	}

	async #promptSmitheryLogin(reason: string): Promise<boolean> {
		if (activeSmitheryLogins.has(this.ctx)) {
			this.ctx.showStatus("Smithery authentication is already active; duplicate request ignored.");
			return false;
		}
		activeSmitheryLogins.add(this.ctx);
		this.#showMessage(
			[
				"",
				theme.fg("muted", `Smithery authentication required (${reason}).`),
				theme.fg("muted", "If browser auth fails, you can paste an API key."),
				"",
			].join("\n"),
		);
		try {
			return await this.#handleSmitheryBrowserLogin();
		} catch (error) {
			this.ctx.showWarning(
				`Browser authorization failed: ${error instanceof Error ? error.message : String(error)}. Falling back to API key.`,
			);
			return await this.#handleSmitheryLoginWithApiKey();
		} finally {
			activeSmitheryLogins.delete(this.ctx);
		}
	}

	#getSmitheryErrorStatus(error: unknown): number | undefined {
		if (error instanceof SmitheryRegistryError || error instanceof SmitheryConnectError) {
			return error.status;
		}
		return undefined;
	}

	#toSmitheryAuthReason(status: number): string {
		return status === 429 ? "rate limited by Smithery" : "forbidden/unauthorized with Smithery";
	}

	async #requireSmitheryApiKey(reason: string): Promise<string> {
		let apiKey = await this.#dependencies.getSmitheryApiKey();
		if (apiKey) return apiKey;

		const loggedIn = await this.#promptSmitheryLogin(reason);
		if (!loggedIn) {
			throw new Error("Smithery login cancelled. Run /mcp smithery-login, then retry /mcp smithery-search.");
		}

		apiKey = await this.#dependencies.getSmitheryApiKey();
		if (!apiKey) {
			throw new Error("Smithery API key not found after login.");
		}
		return apiKey;
	}

	async #runSmitheryOperationWithAuthRetry<T>(operation: (apiKey: string) => Promise<T>, reason: string): Promise<T> {
		const apiKey = await this.#requireSmitheryApiKey(reason);
		try {
			return await operation(apiKey);
		} catch (error) {
			const status = this.#getSmitheryErrorStatus(error);
			if (status === undefined || ![401, 403, 429].includes(status)) {
				throw error;
			}
			const loggedIn = await this.#promptSmitheryLogin(this.#toSmitheryAuthReason(status));
			if (!loggedIn) {
				throw error;
			}
			const retryApiKey = await this.#requireSmitheryApiKey(reason);
			return await operation(retryApiKey);
		}
	}

	async #handleSmitheryLogin(): Promise<void> {
		const ok = await this.#promptSmitheryLogin("login");
		if (!ok) {
			this.ctx.showStatus(t("mcp.smithery.loginCancelled"));
		}
	}

	async #handleSmitheryLogout(): Promise<void> {
		const current = await this.#dependencies.getSmitheryApiKey();
		if (!current) {
			this.ctx.showStatus(t("mcp.smithery.noKeyFound"));
			return;
		}
		const prepare = async () => {
			const key = await this.#dependencies.getSmitheryApiKey();
			if (!key) throw new Error("The Smithery credential was already removed.");
			return {
				target: undefined,
				review: {
					identity: "credential:smithery",
					scope: "User credential storage · Smithery registry",
					revision: mcpDigest(key),
					changes: [{ field: "API credential", before: "Saved (masked)", after: "Removed" }],
					consequence: "Removes only the saved Smithery API key. Existing MCP server configurations are retained.",
				},
			};
		};
		const prepared = await prepare();
		const outcome = await runReviewedAction(this.ctx, "Smithery credential removal", {
			review: prepared.review,
			resolve: prepare,
			execute: async () => {
				await this.#dependencies.clearSmitheryApiKey();
			},
		});
		if (outcome === "succeeded") this.ctx.showStatus(t("mcp.smithery.keyRemoved"));
		else if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
		else if (outcome === "unresolved")
			this.ctx.showError("Smithery credential removal remains unresolved. Reopen the command to retry.");
	}

	async #nextAvailableServerName(scope: MCPAddScope, baseName: string): Promise<string> {
		const filePath = getMCPConfigPath(scope, getProjectDir());
		const config = await readMCPConfigFile(filePath);
		const existingNames = new Set(Object.keys(config.mcpServers ?? {}));
		if (!existingNames.has(baseName)) return baseName;
		for (let i = 2; i <= 999; i++) {
			const candidate = `${baseName}-${i}`;
			if (!existingNames.has(candidate)) return candidate;
		}
		return `${baseName}-${Date.now()}`;
	}

	async #promptDeploymentServerName(scope: MCPAddScope, defaultName: string): Promise<string | null> {
		for (;;) {
			const input = await this.ctx.showHookInput(`Server name for deploy (default: ${defaultName})`, defaultName);
			if (input === undefined) return null;
			const proposed = input.trim() || defaultName;
			if (!proposed) {
				this.ctx.showError("Server name cannot be empty.");
				continue;
			}
			const filePath = getMCPConfigPath(scope, getProjectDir());
			const config = await readMCPConfigFile(filePath);
			if (config.mcpServers?.[proposed]) {
				this.ctx.showError(`Server "${proposed}" already exists in ${scope} config.`);
				continue;
			}
			return proposed;
		}
	}

	async #promptRequiredRegistryInputs(result: SmitherySearchResult): Promise<Record<string, string> | null> {
		const values: Record<string, string> = {};
		for (const input of result.requiredInputs) {
			const label = input.required ? `${input.key} (required)` : `${input.key} (optional)`;
			const prompt = `${label}${input.description ? ` - ${input.description}` : ""}`;
			const userInput = await this.ctx.showHookInput(prompt, input.defaultValue);
			if (userInput === undefined) {
				if (input.required) return null;
				continue;
			}
			const value = userInput.trim();
			if (!value) {
				if (input.required) {
					this.ctx.showError(`Missing required value for "${input.key}".`);
					return null;
				}
				continue;
			}
			values[input.key] = value;
		}
		return values;
	}

	#applyRegistryInputOverrides(config: MCPServerConfig, values: Record<string, string>): MCPServerConfig {
		if (Object.keys(values).length === 0) return config;
		if (config.type !== "stdio") {
			return config;
		}
		const args = [...(config.args ?? [])];
		const configJson = JSON.stringify(values);
		const index = args.indexOf("--config");
		if (index >= 0) {
			if (index + 1 < args.length) {
				args[index + 1] = configJson;
			} else {
				args.push(configJson);
			}
		} else {
			args.push("--config", configJson);
		}
		return { ...config, args };
	}

	async #pickRegistryResult(results: SmitherySearchResult[], keyword: string): Promise<SmitherySearchResult | null> {
		const options = results.map((result, index) => {
			const label = `${index + 1}. ${result.display.displayName} (${result.display.transport}, uses ${result.display.useCount})`;
			return label.length > 120 ? `${label.slice(0, 117)}...` : label;
		});
		const selected = await this.ctx.showHookSelector(`Registry results for "${keyword}"`, options);
		if (!selected) return null;
		const prefix = selected.split(".", 1)[0];
		const index = Number(prefix) - 1;
		if (!Number.isInteger(index) || index < 0 || index >= results.length) return null;
		return results[index] ?? null;
	}

	async #deployRegistryResult(result: SmitherySearchResult, scope: MCPAddScope): Promise<void> {
		const baseName = toConfigName(result.name);
		const defaultName = await this.#nextAvailableServerName(scope, baseName);
		const serverName = await this.#promptDeploymentServerName(scope, defaultName);
		if (!serverName) {
			this.ctx.showStatus(t("mcp.smithery.deployCancelled"));
			return;
		}
		const inputValues = await this.#promptRequiredRegistryInputs(result);
		if (inputValues === null) {
			this.ctx.showStatus(t("mcp.smithery.deployCancelled"));
			return;
		}
		const config = this.#applyRegistryInputOverrides(result.config, inputValues);
		await this.#handleWizardComplete(serverName, config, scope);
	}

	async #handleSearch(text: string): Promise<void> {
		const parsed = this.#parseSearchCommand(text);
		if (parsed.error) {
			this.ctx.showError(parsed.error);
			return;
		}

		try {
			this.#showMessage(
				["", theme.fg("muted", `Searching Smithery registry for "${parsed.keyword}"...`), ""].join("\n"),
			);
			const results = await this.#runSmitheryOperationWithAuthRetry(
				apiKey =>
					this.#dependencies.searchSmitheryRegistry(parsed.keyword, {
						limit: parsed.limit,
						apiKey,
						includeSemantic: parsed.semantic,
					}),
				"required for smithery-search",
			);
			if (results.length === 0) {
				this.#showMessage(
					["", theme.fg("warning", `No Smithery results found for "${parsed.keyword}".`), ""].join("\n"),
				);
				return;
			}

			const selected = await this.#pickRegistryResult(results, parsed.keyword);
			if (!selected) {
				this.ctx.showStatus(t("mcp.smithery.selectionCancelled"));
				return;
			}

			await this.#deployRegistryResult(selected, parsed.scope);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/authentication was cancelled|login cancelled/i.test(message)) {
				this.ctx.showError(`${message} Run /mcp smithery-login to authenticate first.`);
				return;
			}
			this.ctx.showError(t("mcp.smithery.searchFailed", { message }));
		}
	}

	/**
	 * Show a message in the chat
	 */
	#showMessage(text: string): void {
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new TranscriptNoticeComponent("MCP", "Connection and registry status", text));
		this.ctx.ui.requestRender();
	}

	async #showReport(title: string, purpose: string, text: string): Promise<void> {
		await this.ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					title,
					purpose,
					text.trim(),
					() => done(),
					() => ui.terminal.rows,
				),
		);
	}
}
