import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import {
	canonicalizeOAuthProviderId,
	getOAuthProviders,
	getOpenAICodexLoginMethods,
	loginLiteLLM,
	type OAuthPrompt,
	type OAuthProvider,
} from "@f5-sales-demo/pi-ai";
import type { Component } from "@f5-sales-demo/pi-tui";
import { Spacer, Text } from "@f5-sales-demo/pi-tui";
import { getAgentDbPath, getAgentDir, getProjectDir } from "@f5-sales-demo/pi-utils";
import { probeLiteLLMConnection, readLiteLLMConfig } from "../../config/auto-config";
import { settings } from "../../config/settings";
import {
	DEFAULT_VLLM_BASE_URL,
	normalizeVllmBaseUrl,
	probeVllmConnection,
	readVllmConfig,
} from "../../config/vllm-config";
import { DebugSelectorComponent } from "../../debug";
import { disableProvider, enableProvider } from "../../discovery";
import type { UserPromptKind } from "../../extensibility/extensions/types";
import {
	getAvailableThemes,
	previewTheme,
	setColorBlindMode,
	setSymbolPreset,
	setTheme,
	theme,
} from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import { type SessionInfo, SessionManager } from "../../session/session-manager";
import { FileSessionStorage } from "../../session/session-storage";
import { isSearchProviderPreference, setPreferredImageProvider, setPreferredSearchProvider } from "../../tools";
import { applyHyperlinkSetting } from "../../tui/hyperlink";
import { setSessionTerminalTitle } from "../../utils/title-generator";
import { AgentDashboard } from "../components/agent-dashboard";
import { AssistantMessageComponent } from "../components/assistant-message";
import { presentAuthLink, presentDeviceCode } from "../components/auth-link-presenter";
import { CopySelectorComponent } from "../components/copy-selector";
import { ExtensionDashboard } from "../components/extensions";
import { GutterBlock } from "../components/gutter-block";
import { HistorySearchComponent } from "../components/history-search";
import { createLoginPromptInput } from "../components/login-prompt-input";
import { ModelSelectorComponent } from "../components/model-selector";
import { OAuthSelectorComponent } from "../components/oauth-selector";
import { PluginDashboard } from "../components/plugins";
import { ActionInterruptedError, runReviewedAction } from "../components/reviewed-action-dialog";
import { ConnectionChoiceComponent, ConnectionInputComponent } from "../components/selector-frame";
import { SessionObserverOverlayComponent } from "../components/session-observer-overlay";
import { SessionSelectorComponent } from "../components/session-selector";
import { SettingsSelectorComponent } from "../components/settings-selector";
import { getPreset } from "../components/status-line/presets";
import { ToolExecutionComponent } from "../components/tool-execution";
import { TreeSelectorComponent } from "../components/tree-selector";
import { UserMessageSelectorComponent } from "../components/user-message-selector";
import type { SessionObserverRegistry } from "../session-observer-registry";
import { reviewClipboardAction } from "../utils/clipboard-action";
import { buildCopyTargets } from "../utils/copy-targets";
import { reviewExternalUrlAction } from "../utils/open-action";
import type { LoginRecoveryAction, LoginRecoveryRequest } from "./litellm-login-flow";
import { commitLiteLLMLogin } from "./litellm-login-transaction";
import { getLoginRecommendation, type ProviderConnectedResult } from "./login-model";
import { buildProviderManagementOptions, getLoginOptions } from "./login-options";
import { applyModelSelection, prepareModelSelection } from "./model-selection";
import { runProviderConnectionFlow } from "./provider-connection-flow";
import { getProviderDisplayName } from "./provider-presentation";
import {
	defaultVertexLoginRuntime,
	detectVertexProject,
	isHeadlessTerminal,
	validateVertexLogin,
	vertexFailureGuidance,
} from "./vertex-login-flow";
import { commitVllmLogin } from "./vllm-login-transaction";

const CALLBACK_SERVER_PROVIDERS = new Set<OAuthProvider>([
	"anthropic",
	"gitlab-duo",
	"google-gemini-cli",
	"google-antigravity",
	"google-antigravity-enterprise",
]);

const MANUAL_LOGIN_TIP = "Tip: You can complete pairing with /login <redirect URL>.";
const VERTEX_MANUAL_LOGIN_TIP = "Tip: After browser sign-in, complete pairing with /login <authorization code>.";

class LoginPromptCancelled extends Error {}

export class SelectorController {
	#returnFromProviderSetup?: () => void;
	#pendingSessionDeletes = new Map<
		string,
		{ id: string; path: string; cwd: string; name: string; artifactPath: string }
	>();
	#resumingSession = false;
	#pendingResume:
		| {
				target: SessionInfo;
				sourceId: string;
				sourceFile: string | undefined;
		  }
		| undefined;
	#pendingTreeLabels = new Map<string, string | undefined>();
	#pendingBranch:
		| {
				manager: InteractiveModeContext["sessionManager"];
				entryId: string;
				preview: ReturnType<InteractiveModeContext["sessionManager"]["previewBranchedSession"]>;
		  }
		| undefined;
	constructor(private ctx: InteractiveModeContext) {}

	#launchHttpUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
		if (typeof this.ctx.openHttpUrl === "function") return this.ctx.openHttpUrl(url);
		this.ctx.openInBrowser(url);
		return Promise.resolve({ ok: true });
	}

	#emitPromptSignal(type: "user_prompt_start" | "user_prompt_end", kind: UserPromptKind): void {
		this.ctx.session.extensionRunner?.emit({ type, kind }).catch(() => {});
	}

	#beginPromptSignal(kind: UserPromptKind): () => void {
		let open = true;
		this.#emitPromptSignal("user_prompt_start", kind);
		return () => {
			if (!open) return;
			open = false;
			this.#emitPromptSignal("user_prompt_end", kind);
		};
	}

	async #refreshOAuthProviderAuthState(): Promise<void> {
		const oauthProviders = getOAuthProviders().filter(provider => !provider.loginOnly);
		await Promise.all(
			oauthProviders.map(provider =>
				this.ctx.session.modelRegistry
					.getApiKeyForProvider(provider.id, this.ctx.session.sessionId)
					.catch(() => undefined),
			),
		);
	}

	#providerCredentialProposal(providerId: string, operation: "login" | "logout") {
		const authStorage = this.ctx.session.modelRegistry.authStorage;
		const stored = authStorage.hasAuth?.(providerId) ?? authStorage.has?.(providerId) ?? false;
		const providerName = getProviderDisplayName(providerId);
		return {
			review: {
				identity: `provider:${providerId}`,
				scope: `Credential store · ${getAgentDbPath()}`,
				revision: `${providerId}:${stored ? "stored" : "absent"}`,
				changes: [
					{
						field: "Credential",
						before: stored ? "Stored (masked)" : "Not stored",
						after:
							operation === "login"
								? stored
									? "Replace after successful sign-in (masked)"
									: "Store after successful sign-in (masked)"
								: "Removed",
					},
				],
				consequence:
					operation === "login"
						? `Starts ${providerName} authorization and refreshes its catalog after credentials are stored. The active model is unchanged until explicitly selected.`
						: `Removes the saved ${providerName} credential. Saved provider configuration remains, but authenticated models may become unavailable.`,
			},
			target: providerId,
		};
	}

	async #reviewProviderLogin(providerId: string): Promise<boolean> {
		const proposal = this.#providerCredentialProposal(providerId, "login");
		const outcome = await runReviewedAction(this.ctx, "provider sign-in", {
			review: proposal.review,
			resolve: async () => this.#providerCredentialProposal(providerId, "login"),
			execute: async () => {},
		});
		if (outcome === "busy") {
			this.ctx.showWarning("Another reviewed action is already active.");
			return false;
		}
		if (outcome !== "succeeded") {
			this.ctx.showStatus("Login cancelled. Existing credentials unchanged.");
			return false;
		}
		return true;
	}

	#usesStandaloneCredentialReview(providerId: string): boolean {
		return !["google-vertex", "openai", "litellm", "vllm"].includes(providerId);
	}

	async #connectionFilesRevision(paths: readonly string[]): Promise<string> {
		const hash = createHash("sha256");
		for (const filePath of paths) {
			hash.update(filePath).update("\0");
			const file = Bun.file(filePath);
			if (!(await file.exists())) {
				hash.update("[missing]");
				continue;
			}
			try {
				hash.update(await file.bytes());
			} catch (error) {
				hash.update(`[unreadable:${error instanceof Error ? error.name : typeof error}]`);
			}
		}
		return hash.digest("hex");
	}

	async #reviewLiteLLMConnection(
		credentials: { baseUrl: string; apiKey: string },
		probe: { models: readonly unknown[] } | undefined,
		modelsPath: string,
		configPath: string,
	): Promise<boolean> {
		const prepare = async () => {
			const previous = readLiteLLMConfig(modelsPath);
			return {
				review: {
					identity: "provider:litellm",
					scope: `User provider configuration · ${modelsPath}`,
					revision: await this.#connectionFilesRevision([modelsPath, configPath]),
					changes: [
						{
							field: "Proxy endpoint",
							before: previous?.baseUrl ?? "Not configured",
							after: credentials.baseUrl,
						},
						{
							field: "API credential",
							before: previous?.apiKey ? "Stored (masked)" : "Not stored",
							after: "Stored (masked)",
						},
						{ field: "Discovered models", before: "Current catalog", after: String(probe?.models.length ?? 0) },
					],
					consequence:
						"Replaces the generated LiteLLM routes in models.yml. The active model and saved model roles remain unchanged until explicitly selected.",
				},
				target: credentials,
			};
		};
		const proposal = await prepare();
		const outcome = await runReviewedAction(this.ctx, "LiteLLM connection", {
			review: proposal.review,
			resolve: prepare,
			execute: async () => {},
		});
		if (outcome === "busy") this.ctx.showWarning("Another reviewed action is already active.");
		return outcome === "succeeded";
	}

	async #reviewVllmConnection(
		credentials: { baseUrl: string; apiKey: string },
		probe: { models: readonly unknown[] } | undefined,
		modelsPath: string,
	): Promise<boolean> {
		const prepare = async () => {
			const previous = readVllmConfig(modelsPath);
			const previousCredential = this.ctx.session.modelRegistry.authStorage.get("vllm");
			return {
				review: {
					identity: "provider:vllm",
					scope: `User provider configuration and credential store · ${modelsPath}`,
					revision: `${await this.#connectionFilesRevision([modelsPath])}:${previousCredential ? "stored" : "absent"}`,
					changes: [
						{ field: "vLLM endpoint", before: previous?.baseUrl ?? "Not configured", after: credentials.baseUrl },
						{
							field: "API credential",
							before: previousCredential ? "Stored (masked)" : "Not stored",
							after: credentials.apiKey.trim() ? "Stored (masked)" : "Not stored",
						},
						{ field: "Discovered models", before: "Current catalog", after: String(probe?.models.length ?? 0) },
					],
					consequence:
						"Updates only the vLLM provider block and its optional credential. The active model and saved model roles remain unchanged until explicitly selected.",
				},
				target: credentials,
			};
		};
		const proposal = await prepare();
		const outcome = await runReviewedAction(this.ctx, "vLLM connection", {
			review: proposal.review,
			resolve: prepare,
			execute: async () => {},
		});
		if (outcome === "busy") this.ctx.showWarning("Another reviewed action is already active.");
		return outcome === "succeeded";
	}

	async #reviewVertexProject(project: string): Promise<boolean> {
		const sessionSettings = this.ctx.session.settings;
		const prepare = async () => {
			const previousProject = sessionSettings.get("providers.vertexProject");
			const previousLocation = sessionSettings.get("providers.vertexLocation");
			const changes = [
				{ field: "Vertex project", before: previousProject || "Not configured", after: project },
				{ field: "Vertex location", before: previousLocation || "Not configured", after: "global" },
			].filter(change => change.before !== change.after);
			return {
				review: {
					identity: `provider:google-vertex:project:${project}`,
					scope: "User provider settings · Corporate Vertex AI",
					revision: JSON.stringify({ previousProject, previousLocation, project }),
					changes,
					consequence:
						"Saves the validated project and global location. Existing credentials remain masked; the active model is unchanged until explicitly selected.",
				},
				target: { previousProject, previousLocation },
			};
		};
		const proposal = await prepare();
		if (proposal.review.changes.length === 0) return true;
		const outcome = await runReviewedAction(this.ctx, "Vertex project", {
			review: proposal.review,
			resolve: prepare,
			execute: async previous => {
				sessionSettings.set("providers.vertexProject", project);
				sessionSettings.set("providers.vertexLocation", "global");
				try {
					await sessionSettings.flush({ throwOnError: true });
				} catch (error) {
					sessionSettings.set("providers.vertexProject", previous.previousProject);
					sessionSettings.set("providers.vertexLocation", previous.previousLocation);
					await sessionSettings.flush({ throwOnError: true }).catch(() => {});
					throw error;
				}
			},
		});
		if (outcome === "busy") this.ctx.showWarning("Another reviewed action is already active.");
		if (outcome === "unresolved")
			this.ctx.showError("Vertex project persistence is unresolved. Review the action again to retry.");
		return outcome === "succeeded";
	}
	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	showSelector(
		create: (done: () => void) => { component: Component; focus: Component },
		promptKind?: UserPromptKind,
	): void {
		let endPrompt: (() => void) | undefined;
		const done = () => {
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			endPrompt?.();
		};
		const { component, focus } = create(done);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(component);
		this.ctx.ui.setFocus(focus);
		this.ctx.ui.requestRender();
		if (promptKind) endPrompt = this.#beginPromptSignal(promptKind);
	}

	showSettingsSelector(): void {
		getAvailableThemes().then(availableThemes => {
			this.showSelector(done => {
				const selector = new SettingsSelectorComponent(
					{
						availableThinkingLevels: [...this.ctx.session.getAvailableThinkingLevels()],
						thinkingLevel: this.ctx.session.thinkingLevel,
						availableThemes,
						cwd: getProjectDir(),
					},
					{
						onChange: (id, value) => this.handleSettingChange(id, value),
						onRequestRender: () => this.ctx.ui.requestRender(),
						onThemePreview: async themeName => {
							const result = await previewTheme(themeName);
							if (result.success) {
								this.ctx.statusLine.invalidate();
								this.ctx.updateEditorTopBorder();
								this.ctx.ui.invalidate();
								this.ctx.ui.requestRender();
							}
						},
						onStatusLinePreview: previewSettings => {
							// Update status line with preview settings
							this.ctx.statusLine.updateSettings({
								preset: settings.get("statusLine.preset"),
								leftSegments: settings.get("statusLine.leftSegments"),
								rightSegments: settings.get("statusLine.rightSegments"),
								separator: settings.get("statusLine.separator"),
								showHookStatus: settings.get("statusLine.showHookStatus"),
								...previewSettings,
							});
							this.ctx.updateEditorTopBorder();
							this.ctx.ui.requestRender();
						},
						getStatusLinePreview: () => {
							// Return the rendered status line for inline preview
							const availableWidth = this.ctx.editor.getTopBorderAvailableWidth(this.ctx.ui.terminal.columns);
							return this.ctx.statusLine.getTopBorder(availableWidth).content;
						},
						onPluginsChanged: () => {
							this.ctx.ui.requestRender();
						},
						onSaved: (count, kind) => {
							const subject =
								kind === "plugin" ? "plugin settings" : kind === "combined" ? "combined settings" : "settings";
							this.ctx.showStatus(`Saved ${count} ${subject} ${count === 1 ? "change" : "changes"}.`);
						},
						onCancel: () => {
							done();
							// Restore status line to saved settings
							this.ctx.statusLine.updateSettings({
								preset: settings.get("statusLine.preset"),
								leftSegments: settings.get("statusLine.leftSegments"),
								rightSegments: settings.get("statusLine.rightSegments"),
								separator: settings.get("statusLine.separator"),
								showHookStatus: settings.get("statusLine.showHookStatus"),
							});
							this.ctx.updateEditorTopBorder();
							this.ctx.ui.requestRender();
						},
					},
				);
				return { component: selector, focus: selector };
			});
		});
	}

	showHistorySearch(): void {
		const historyStorage = this.ctx.historyStorage;
		if (!historyStorage) return;

		this.showSelector(done => {
			const component = new HistorySearchComponent(
				historyStorage,
				prompt => {
					done();
					this.ctx.editor.setText(prompt);
					this.ctx.ui.requestRender();
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
			);
			return { component, focus: component };
		});
	}

	showCopySelector(): void {
		const session = this.ctx.session;
		const manager = session.sessionManager;
		const sessionId = manager.getSessionId();
		const tail = manager.getMessageBranchTail(600);
		const loadAllEntries = () =>
			manager
				.getBranch()
				.filter(
					(entry): entry is import("../../session/session-manager").SessionMessageEntry =>
						entry.type === "message",
				);
		let closed = false;
		let overlay: ReturnType<typeof this.ctx.ui.showOverlay>;
		const selector = new CopySelectorComponent(tail.entries, {
			requestRender: () => this.ctx.ui.requestRender(),
			viewportRows: () => this.ctx.ui.terminal.rows,
			initialHistoryTruncated: tail.truncated,
			loadAllEntries,
			onCancel: () => close(),
			onPick: async (_content, label) => {
				const source = selector.selectedCopySource;
				if (!source) return;
				const result = await reviewClipboardAction(this.ctx, {
					title: "clipboard copy",
					identity: `copy:${sessionId}:${source.targetId}:${source.blockIndex ?? "turn"}`,
					label,
					success: `${label} copied to the local clipboard.`,
					reopen: "Choose the transcript target again to review and retry.",
					current: () =>
						!closed &&
						this.ctx.session === session &&
						session.sessionManager === manager &&
						manager.getSessionId() === sessionId,
					resolveText: () => {
						const target = buildCopyTargets(loadAllEntries()).find(target => target.id === source.targetId);
						if (!target) return undefined;
						if (source.blockIndex !== undefined) return target.blocks[source.blockIndex]?.content;
						return target.content || target.blocks.map(block => block.content).join("\n\n");
					},
				});
				if (result === "copied" || result === "requested") close();
			},
			onOpen: (href, label) => {
				void reviewExternalUrlAction(this.ctx, {
					title: "transcript link",
					identity: `copy-link:${sessionId}`,
					scope: `External browser navigation · transcript selector · session ${sessionId}`,
					current: () =>
						!closed &&
						this.ctx.session === session &&
						session.sessionManager === manager &&
						manager.getSessionId() === sessionId,
					resolveUrl: () =>
						buildCopyTargets(loadAllEntries()).some(target => target.blocks.some(block => block.href === href))
							? href
							: undefined,
					open: url => this.ctx.openHttpUrl(url),
				}).then(outcome => {
					if (outcome === "succeeded") {
						this.ctx.showStatus(`Opened ${label}.`);
						close();
					} else if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
					else if (outcome === "missing") this.ctx.showWarning("The selected link is no longer available.");
				});
			},
		});
		const close = () => {
			if (closed) return;
			closed = true;
			selector.dispose();
			overlay.hide();
			this.ctx.ui.requestRender();
		};
		if (selector.targetCount === 0 && !selector.canLoadEarlier) {
			this.ctx.showWarning("No transcript content is available to copy.");
			selector.dispose();
			return;
		}
		overlay = this.ctx.ui.showOverlay(selector, { fullscreen: true, mouseTracking: true });
	}

	/**
	 * Show the Extension Control Center dashboard.
	 * Replaces /status with a unified view of all providers and extensions.
	 */
	async showExtensionsDashboard(): Promise<void> {
		const dashboard = await ExtensionDashboard.create(
			getProjectDir(),
			this.ctx.settings,
			() => this.ctx.ui.terminal.rows,
		);
		const overlay = this.ctx.ui.showOverlay(dashboard, {
			fullscreen: true,
			mouseTracking: true,
			anchor: "top-left",
			width: "100%",
			maxHeight: "100%",
			margin: 0,
		});
		dashboard.onClose = () => {
			overlay.hide();
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
		};
		dashboard.onRequestRender = () => this.ctx.ui.requestRender();
		this.ctx.ui.setFocus(dashboard);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show the Agent Control Center dashboard.
	 */
	async showAgentsDashboard(): Promise<void> {
		const activeModel = this.ctx.session.model;
		const activeModelPattern = activeModel ? `${activeModel.provider}/${activeModel.id}` : undefined;
		const defaultModelPattern = this.ctx.settings.getModelRole("default");
		const dashboard = await AgentDashboard.create(getProjectDir(), this.ctx.settings, this.ctx.ui.terminal.rows, {
			modelRegistry: this.ctx.session.modelRegistry,
			activeModelPattern,
			defaultModelPattern,
		});
		this.showSelector(done => {
			dashboard.onClose = () => {
				done();
				this.ctx.ui.requestRender();
			};
			dashboard.onRequestRender = () => {
				this.ctx.ui.requestRender();
			};
			return { component: dashboard, focus: dashboard };
		});
	}

	async showPluginDashboard(initialTab: "installed" | "discover" = "installed"): Promise<void> {
		const dashboard = await PluginDashboard.create(
			getProjectDir(),
			() => this.ctx.ui.terminal?.rows ?? 24,
			initialTab,
		);
		this.showSelector(done => {
			dashboard.onClose = () => {
				done();
				this.ctx.ui.requestRender();
			};
			dashboard.onRequestRender = () => {
				this.ctx.ui.requestRender();
			};
			return { component: dashboard, focus: dashboard };
		});
	}

	/**
	 * Handle setting changes from the settings selector.
	 * Most settings are saved directly via SettingsManager in the definitions.
	 * This handles side effects and session-specific settings.
	 */
	handleSettingChange(id: string, value: unknown): void {
		// Discovery provider toggles
		if (id.startsWith("discovery.")) {
			const providerId = id.replace("discovery.", "");
			if (value) {
				enableProvider(providerId);
			} else {
				disableProvider(providerId);
			}
			return;
		}

		switch (id) {
			// Session-managed settings (not in SettingsManager)
			case "autoCompact":
				this.ctx.session.setAutoCompactionEnabled(value as boolean);
				this.ctx.statusLine.setAutoCompactEnabled(value as boolean);
				break;
			case "steeringMode":
				this.ctx.session.setSteeringMode(value as "all" | "one-at-a-time");
				break;
			case "followUpMode":
				this.ctx.session.setFollowUpMode(value as "all" | "one-at-a-time");
				break;
			case "interruptMode":
				this.ctx.session.setInterruptMode(value as "immediate" | "wait");
				break;
			case "thinkingLevel":
			case "defaultThinkingLevel":
				this.ctx.session.setThinkingLevel(value as ThinkingLevel, true);
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorBorderColor();
				break;

			case "clearOnShrink":
				this.ctx.ui.setClearOnShrink(value as boolean);
				break;
			case "tui.hyperlinks":
				applyHyperlinkSetting(value);
				this.ctx.statusLine.invalidate();
				this.ctx.chatContainer.invalidate();
				this.ctx.ui.invalidate();
				this.ctx.ui.requestRender();
				break;

			case "autocompleteMaxVisible":
				this.ctx.editor.setAutocompleteMaxVisible(typeof value === "number" ? value : Number(value));
				break;

			// Settings with UI side effects
			case "showImages":
				for (const child of this.ctx.chatContainer.children) {
					const unwrapped = child instanceof GutterBlock ? child.child : child;
					if (unwrapped instanceof ToolExecutionComponent) {
						unwrapped.setShowImages(value as boolean);
					}
				}
				break;
			case "hideThinking":
				this.ctx.hideThinkingBlock = value as boolean;
				for (const child of this.ctx.chatContainer.children) {
					const unwrapped = child instanceof GutterBlock ? child.child : child;
					if (unwrapped instanceof AssistantMessageComponent) {
						unwrapped.setHideThinkingBlock(value as boolean);
					}
				}
				this.ctx.chatContainer.clear();
				this.ctx.rebuildChatFromMessages();
				break;
			case "theme": {
				setTheme(value as string, true).then(result => {
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
					this.ctx.ui.invalidate();
					if (!result.success) {
						this.ctx.showError(`Failed to load theme "${value}": ${result.error}\nFell back to dark theme.`);
					}
				});
				break;
			}
			case "symbolPreset": {
				setSymbolPreset(value as "unicode" | "nerd" | "ascii").then(() => {
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
					this.ctx.ui.invalidate();
				});
				break;
			}
			case "colorBlindMode": {
				setColorBlindMode(value === "true" || value === true).then(() => {
					this.ctx.ui.invalidate();
				});
				break;
			}
			case "temperature": {
				const temp = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.temperature = temp >= 0 ? temp : undefined;
				break;
			}
			case "topP": {
				const topP = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.topP = topP >= 0 ? topP : undefined;
				break;
			}
			case "topK": {
				const topK = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.topK = topK >= 0 ? topK : undefined;
				break;
			}
			case "minP": {
				const minP = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.minP = minP >= 0 ? minP : undefined;
				break;
			}
			case "presencePenalty": {
				const presencePenalty = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.presencePenalty = presencePenalty >= 0 ? presencePenalty : undefined;
				break;
			}
			case "repetitionPenalty": {
				const repetitionPenalty = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.repetitionPenalty = repetitionPenalty >= 0 ? repetitionPenalty : undefined;
				break;
			}
			case "statusLinePreset":
			case "statusLineSeparator":
			case "statusLineShowHooks":
			case "statusLineSegments":
			case "statusLineModelThinking":
			case "statusLinePathAbbreviate":
			case "statusLinePathMaxLength":
			case "statusLinePathStripWorkPrefix":
			case "statusLineGitShowBranch":
			case "statusLineGitShowStaged":
			case "statusLineGitShowUnstaged":
			case "statusLineGitShowUntracked":
			case "statusLineTimeFormat":
			case "statusLineTimeShowSeconds": {
				// When selecting a non-custom preset, sync the preset's separator
				// to the store so #resolveSettings picks it up correctly.
				if (id === "statusLinePreset" && value !== "custom") {
					const presetDef = getPreset(value as Parameters<typeof getPreset>[0]);
					if (presetDef.separator) {
						settings.set("statusLine.separator", presetDef.separator);
					}
				}
				const statusLineSettings = {
					preset: settings.get("statusLine.preset"),
					leftSegments: settings.get("statusLine.leftSegments"),
					rightSegments: settings.get("statusLine.rightSegments"),
					separator: settings.get("statusLine.separator"),
					showHookStatus: settings.get("statusLine.showHookStatus"),
					segmentOptions: settings.get("statusLine.segmentOptions"),
				};
				this.ctx.statusLine.updateSettings(statusLineSettings);
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.requestRender();
				break;
			}

			// Provider settings - update runtime preferences
			case "providers.webSearch":
				if (typeof value === "string" && isSearchProviderPreference(value)) {
					setPreferredSearchProvider(value);
				}
				break;
			case "providers.image":
				if (value === "auto" || value === "gemini" || value === "openrouter") {
					setPreferredImageProvider(value);
				}
				break;

			// MCP update injection - live subscribe/unsubscribe
			case "mcp.notifications":
				this.ctx.mcpManager?.setNotificationsEnabled(value as boolean);
				break;

			// All other settings are handled by the definitions (get/set on SettingsManager)
			// No additional side effects needed
		}
	}

	showModelSelector(options?: {
		temporaryOnly?: boolean;
		initialProvider?: string;
		initialSearchInput?: string;
		initialSelector?: string;
		openInitialSelection?: boolean;
		onCancel?: () => void;
	}): void {
		this.showSelector(done => {
			const selector = new ModelSelectorComponent(
				this.ctx.ui,
				this.ctx.session.model,
				this.ctx.settings,
				this.ctx.session.modelRegistry,
				this.ctx.session.scopedModels,
				async selection => {
					const sessionId = this.ctx.sessionManager?.getSessionId?.() ?? this.ctx.session.sessionId ?? "current";
					const proposal = prepareModelSelection(this.ctx.session, selection, sessionId);
					if (!proposal) throw new Error(`Model is no longer available: ${selection.selector}`);
					if (proposal.review.changes.length === 0) {
						this.ctx.showStatus(`${selection.selector} is already applied at this scope. Nothing changed.`);
						return false;
					}
					const outcome = await runReviewedAction(this.ctx, "model selection", {
						review: proposal.review,
						resolve: async () => prepareModelSelection(this.ctx.session, selection, sessionId),
						execute: target => applyModelSelection(this.ctx.session, target),
					});
					if (outcome === "busy") {
						this.ctx.showWarning("Another reviewed action is already active.");
						return false;
					}
					if (outcome !== "succeeded") {
						if (outcome === "unresolved")
							this.ctx.showError("Model selection is unresolved. Review the action again to retry.");
						return false;
					}
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorBorderColor();
					const scope =
						selection.scope === "conversation"
							? "This conversation"
							: selection.scope === "default"
								? "Saved default"
								: `Role ${selection.role}`;
					this.ctx.showStatus(`${scope}: ${selection.selector} · reasoning ${selection.thinkingLevel}`);
					if (selection.scope !== "role") {
						selector.dispose();
						done();
					}
					this.ctx.ui.requestRender();
					return true;
				},
				() => {
					selector.dispose();
					done();
					options?.onCancel?.();
					this.ctx.ui.requestRender();
				},
				{
					...options,
					currentThinkingLevel: this.ctx.session.thinkingLevel,
					onLogin: () => {
						const context = selector.getNavigationContext();
						selector.dispose();
						done();
						void this.showOAuthSelector("login", undefined, () =>
							this.showModelSelector({ ...options, ...context }),
						);
					},
				},
			);
			return { component: selector, focus: selector };
		});
	}

	async #showProviderConnected(provider: string, discoveryError?: string, reloadConnection = false): Promise<void> {
		this.ctx.showStatus("Credentials saved. Checking connection…");
		try {
			// New proxy settings and grouped routes must be loaded from disk before discovery.
			if (reloadConnection) await this.ctx.session.modelRegistry.refresh("online");
			else await this.ctx.session.modelRegistry.refreshProvider(provider, "online");
		} catch (error) {
			discoveryError = error instanceof Error ? error.message : String(error);
		}
		const discovery = this.ctx.session.modelRegistry.getProviderDiscoveryState?.(provider);
		if (discovery && (discovery.status !== "ok" || discovery.stale || discovery.models.length === 0)) {
			discoveryError ??=
				discovery.error ?? (discovery.models.length === 0 ? "No models returned" : "Connection unavailable");
		}
		const discoverySummary =
			discovery?.status === "ok" && discovery.models.length === 0 ? "no models returned" : "discovery unavailable";
		const result: ProviderConnectedResult = {
			provider,
			recommendation: discoveryError ? undefined : getLoginRecommendation(this.ctx.session.modelRegistry, provider),
			discoveryError,
		};
		const actions = [
			...(discoveryError
				? [
						{
							label: "Retry connection",
							description: "Check this saved connection again without changing model settings.",
						},
					]
				: []),
			...(result.recommendation
				? [
						{
							label: "Use recommended model",
							description: `${result.recommendation.label} · choose scope and reasoning next.`,
						},
					]
				: []),
			{ label: "Browse models", description: "Choose from this provider's model catalog." },
			{ label: "Done", description: "Keep this connection and your current model settings." },
		];
		this.showSelector(done => {
			const selector = new ConnectionChoiceComponent(
				discoveryError ? "Connection saved" : "Provider connected",
				`${getProviderDisplayName(provider)} · Credentials saved${discoveryError ? `; ${discoverySummary}` : ""}`,
				actions,
				index => {
					done();
					const action = actions[index]?.label;
					if (action === "Retry connection") {
						void this.#showProviderConnected(provider);
						return;
					}
					if (action === "Done") {
						this.#returnFromProviderSetup?.();
						return;
					}
					this.showModelSelector({
						initialProvider: provider,
						...(action === "Use recommended model" && result.recommendation
							? {
									initialSelector: `${result.recommendation.provider}/${result.recommendation.modelId}`,
									openInitialSelection: true,
								}
							: {}),
						onCancel: () => {
							void this.#showProviderConnected(provider);
						},
					});
				},
				() => {
					done();
					this.#returnFromProviderSetup?.();
				},
				() => this.ctx.ui.terminal?.rows ?? 24,
			);
			return { component: selector, focus: selector };
		});
	}

	async #promptLoginValue(prompt: OAuthPrompt): Promise<string> {
		const { promise, resolve, reject } = Promise.withResolvers<string>();
		const input = createLoginPromptInput(prompt);
		const closeInput = () => {
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			// The framed prompt can be taller than the normal editor. Force a full
			// redraw so submitted secret fields cannot linger while the connection
			// probe is running.
			this.ctx.ui.requestRender(true);
		};
		input.onSubmit = () => {
			const value = input.getValue();
			closeInput();
			resolve(value);
		};
		input.onEscape = () => {
			closeInput();
			reject(new LoginPromptCancelled());
		};
		this.ctx.editorContainer.clear();
		const frame = new ConnectionInputComponent(
			"Provider connection",
			prompt.message,
			input,
			() => this.ctx.ui.terminal?.rows ?? 24,
		);
		this.ctx.editorContainer.addChild(frame);
		this.ctx.ui.setFocus(frame);
		this.ctx.ui.requestRender();
		const endPrompt = this.#beginPromptSignal("input");
		return promise.finally(endPrompt);
	}

	async #showLoginRecovery(
		request: LoginRecoveryRequest | { stage: string; error: string; canEdit: boolean },
		flowLabel = "LiteLLM",
		editLabel = "Edit connection",
	): Promise<LoginRecoveryAction> {
		const options = request.canEdit ? ["Retry", editLabel, "Cancel"] : ["Retry", "Cancel"];
		const { promise, resolve } = Promise.withResolvers<LoginRecoveryAction>();
		this.showSelector(done => {
			const selector = new ConnectionChoiceComponent(
				`${flowLabel}: ${request.stage} failed`,
				request.error,
				options.map(label => ({ label })),
				index => {
					const option = options[index];
					done();
					resolve(option === "Retry" ? "retry" : option === editLabel ? "edit" : "cancel");
					this.ctx.ui.requestRender();
				},
				() => {
					done();
					resolve("cancel");
					this.ctx.ui.requestRender();
				},
				() => this.ctx.ui.terminal?.rows ?? 24,
			);
			return { component: selector, focus: selector };
		});
		return promise;
	}

	showUserMessageSelector(): void {
		const userMessages = this.ctx.session.getUserMessagesForBranching();

		if (userMessages.length === 0) {
			this.ctx.showStatus("No messages to branch from");
			return;
		}

		this.showSelector(done => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map(m => ({ id: m.entryId, text: m.text })),
				async entryId => {
					const manager = this.ctx.sessionManager;
					const sourceId = manager.getSessionId();
					const sourceFile = manager.getSessionFile();
					const entry = manager.getEntry(entryId);
					if (entry?.type !== "message" || entry.message.role !== "user") {
						this.ctx.showError("The selected branch point is no longer available.");
						return;
					}
					const selectedText = userMessages.find(message => message.entryId === entryId)?.text ?? "";
					const preview =
						this.#pendingBranch?.entryId === entryId && this.#pendingBranch.manager === manager
							? this.#pendingBranch.preview
							: manager.previewBranchedSession(entry.parentId);
					const read = () => {
						const recovery = Boolean(
							preview &&
								manager.getSessionId() === preview.targetSessionId &&
								manager.getSessionFile() === preview.targetSessionFile,
						);
						if (!recovery && (manager.getSessionId() !== sourceId || manager.getSessionFile() !== sourceFile))
							return undefined;
						const currentEntry = recovery ? entry : manager.getEntry(entryId);
						if (!currentEntry) return undefined;
						return {
							target: { recovery },
							review: {
								identity: `session-branch:${sourceId}:${entryId}`,
								scope: `Conversation branch · ${sourceFile ?? "in-memory session"}`,
								revision: createHash("sha256")
									.update(JSON.stringify([currentEntry, preview, manager.getEntries(), recovery]))
									.digest("hex"),
								changes: [
									{ field: "Branch point", before: manager.getLeafId() ?? "Root", after: entryId },
									{
										field: "Session identity",
										before: sourceId,
										after: preview
											? `${preview.targetSessionId}${recovery ? " (already created)" : ""}`
											: "New in-memory branch",
									},
									{
										field: "Session file",
										before: sourceFile ?? "In-memory",
										after: preview?.targetSessionFile ?? "In-memory",
									},
									{ field: "Editor draft", before: "Current draft", after: "Selected user message" },
								],
								consequence: recovery
									? "Retries only persistence and state restoration for the already-created branch. It does not create another branch."
									: "Creates and switches to a new session containing conversation through the selected point, preserves the source session, and prefills the selected user text for editing. Active asynchronous jobs are cancelled.",
							},
						};
					};
					const proposed = read();
					if (!proposed) {
						this.ctx.showError("The selected branch target changed. Choose it again.");
						return;
					}
					let resultText = selectedText;
					const outcome = await runReviewedAction(
						this.ctx,
						proposed.target.recovery ? "branch recovery" : "conversation branch",
						{
							review: proposed.review,
							resolve: async () => read(),
							execute: async target => {
								if (!target.recovery) {
									this.#pendingBranch = { manager, entryId, preview };
									const result = await this.ctx.session.branch(entryId, preview);
									if (result.cancelled) {
										this.#pendingBranch = undefined;
										throw new Error("Branch was declined by an extension; the source session is unchanged.");
									}
									resultText = result.selectedText;
								} else await this.ctx.session.retryReviewedBranchCompletion(preview);
								await manager.retryPersistence();
								this.#pendingBranch = undefined;
							},
						},
					);
					if (outcome === "succeeded") {
						this.ctx.chatContainer.clear();
						this.ctx.renderInitialMessages();
						this.ctx.editor.setText(resultText);
						done();
						this.ctx.showStatus(`Branched to session ${manager.getSessionId()}.`);
					} else if (outcome === "unresolved")
						this.ctx.showError("Branch completion is unresolved. Select the same branch point to retry it.");
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
				() => this.ctx.ui.terminal.rows,
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	showTreeSelector(): void {
		const tree = this.ctx.sessionManager.getTree();
		const realLeafId = this.ctx.sessionManager.getLeafId();

		if (tree.length === 0) {
			this.ctx.showStatus("No entries in session");
			return;
		}

		this.showSelector(done => {
			let navigating = false;
			const selector = new TreeSelectorComponent(
				tree,
				realLeafId,
				this.ctx.ui.terminal.rows,
				async entryId => {
					if (navigating) {
						this.ctx.showWarning("A tree navigation review or operation is already active.");
						return;
					}
					navigating = true;
					try {
						const manager = this.ctx.sessionManager;
						const session = this.ctx.session;
						const sourceSessionId = manager.getSessionId();
						const sourceFile = manager.getSessionFile();
						const sourceLeaf = manager.getLeafId();
						if (entryId === sourceLeaf) {
							this.ctx.showStatus("Already at this point.");
							return;
						}

						let wantsSummary = false;
						let customInstructions: string | undefined;
						while (settings.get("branchSummary.enabled")) {
							const summaryChoice = await this.ctx.showHookSelector("Navigation context", [
								"Navigate without summary",
								"Generate branch summary",
								"Generate summary with custom prompt",
							]);
							if (summaryChoice === undefined) return;
							wantsSummary = summaryChoice !== "Navigate without summary";
							if (summaryChoice === "Generate summary with custom prompt") {
								customInstructions = await this.ctx.showHookEditor("Custom summarization instructions");
								if (customInstructions === undefined) continue;
							}
							break;
						}

						const targetAtReview = manager.getEntry(entryId);
						if (!targetAtReview) throw new Error("The selected tree node is no longer available.");
						const targetLeaf =
							targetAtReview.type === "message" && targetAtReview.message.role === "user"
								? targetAtReview.parentId
								: targetAtReview.type === "custom_message"
									? targetAtReview.parentId
									: entryId;
						const read = () => {
							const recovery = session.hasPendingReviewedTreeNavigation(entryId);
							const target = manager.getEntry(entryId);
							if (
								this.ctx.session !== session ||
								this.ctx.sessionManager !== manager ||
								manager.getSessionId() !== sourceSessionId ||
								manager.getSessionFile() !== sourceFile ||
								!target ||
								(!recovery && manager.getLeafId() !== sourceLeaf)
							)
								return undefined;
							const review = {
								identity: `session-tree:${sourceSessionId}:${entryId}`,
								scope: `Session tree · ${sourceFile ?? "in-memory session"}`,
								revision: createHash("sha256")
									.update(
										JSON.stringify([
											target,
											manager.getEntries(),
											sourceLeaf,
											wantsSummary,
											customInstructions,
											session.model?.provider,
											session.model?.id,
											recovery,
										]),
									)
									.digest("hex"),
								changes: [
									{ field: "Tree position", before: sourceLeaf ?? "Root", after: targetLeaf ?? "Root" },
									{ field: "Selected node", before: "Current leaf", after: entryId },
									{
										field: "Abandoned branch context",
										before: recovery ? "Navigation already applied" : "Retained in session tree",
										after: wantsSummary
											? `Generate with ${session.model?.provider ?? "current provider"}/${session.model?.id ?? "current model"}`
											: "No summary generated",
									},
									{
										field: "Editor draft",
										before: this.ctx.editor.getText().trim() ? "Existing draft retained" : "Empty",
										after:
											target.type === "message" && target.message.role === "user"
												? "Prefill selected user message when editor is empty"
												: "Unchanged",
									},
								],
								consequence: recovery
									? "Retries only persistence and state restoration for the already-applied tree position. It does not regenerate or append another summary."
									: wantsSummary
										? `Generates and persists a branch summary before moving to the exact node. This can consume model tokens and incur cost. Instructions: ${customInstructions?.trim() || "default"}. Ctrl+C requests interruption; Escape only returns through navigation layers.`
										: "Moves the active conversation position within this session without deleting either branch. No summary or remote model work is performed.",
							};
							return { target: { recovery }, review };
						};
						const initial = read();
						if (!initial) throw new Error("The tree navigation proposal changed before review.");
						let result: Awaited<ReturnType<typeof session.navigateTree>> | undefined;
						const outcome = await runReviewedAction(this.ctx, "tree navigation", {
							review: initial.review,
							resolve: async () => read(),
							cancellable: wantsSummary,
							execute: async (_target, signal) => {
								const navigation = await session.navigateTree(entryId, {
									summarize: wantsSummary,
									customInstructions,
									signal,
								});
								result = navigation;
								if (navigation.aborted && signal.aborted)
									throw new ActionInterruptedError("Branch summarization stopped before navigation.");
								if (navigation.cancelled) throw new Error("Tree navigation was declined before mutation.");
								await manager.retryPersistence();
								const expectedLeaf = navigation.summaryEntry?.id ?? targetLeaf;
								if (manager.getLeafId() !== expectedLeaf)
									throw new Error("The active tree position does not match the reviewed destination.");
							},
						});
						if (outcome === "cancelled") return;
						if (outcome === "interrupted") {
							this.ctx.showStatus("Branch summarization interrupted; the original tree position is retained.");
							return;
						}
						if (outcome === "unresolved") {
							this.ctx.showError(
								"Tree navigation remains unresolved. Retry this exact node to finish without duplication.",
							);
							return;
						}
						if (!result) throw new Error("Tree navigation completed without a verified result.");
						this.ctx.chatContainer.clear();
						this.ctx.renderInitialMessages();
						await this.ctx.reloadTodos();
						if (result.editorText && !this.ctx.editor.getText().trim())
							this.ctx.editor.setText(result.editorText);
						done();
						this.ctx.showStatus(`Navigated to tree node ${entryId}.`);
					} catch (error) {
						this.ctx.showError(error instanceof Error ? error.message : String(error));
					} finally {
						navigating = false;
						this.ctx.ui.requestRender();
					}
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
				(entryId, label) => this.#reviewTreeLabelChange(entryId, label),
				settings.get("treeFilterMode"),
				() => this.ctx.ui.terminal.rows,
			);
			return { component: selector, focus: selector };
		});
	}

	async #reviewTreeLabelChange(entryId: string, label: string | undefined): Promise<boolean> {
		const manager = this.ctx.sessionManager;
		const sessionId = manager.getSessionId();
		const key = `${sessionId}:${entryId}`;
		const normalized = label?.trim() || undefined;
		if (!manager.getEntry(entryId)) {
			this.ctx.showError("The selected tree node is no longer available.");
			return false;
		}
		if (manager.getLabel(entryId) === normalized && !this.#pendingTreeLabels.has(key)) {
			this.ctx.showStatus("Tree label is unchanged; nothing saved.");
			return true;
		}
		const review = () => {
			const pending = this.#pendingTreeLabels.has(key);
			return {
				identity: `session-node:${sessionId}:${entryId}`,
				scope: `Session tree label · ${manager.getSessionFile() ?? "in-memory session"}`,
				revision: createHash("sha256")
					.update(JSON.stringify([manager.getEntry(entryId), manager.getLabel(entryId), pending]))
					.digest("hex"),
				changes: pending
					? [{ field: "Persistence", before: "Label change unresolved", after: "Save existing label change" }]
					: [
							{
								field: "Label",
								before: manager.getLabel(entryId) ?? "None",
								after: normalized ?? "Removed",
							},
						],
				consequence: pending
					? "Retries only saving the label change already applied to this node. It does not append another change."
					: "Persists a display label for this exact session node. Conversation content, branch identity, and active position remain unchanged.",
			};
		};
		const outcome = await runReviewedAction(this.ctx, "tree label", {
			review: review(),
			resolve: async () =>
				this.ctx.sessionManager === manager && manager.getSessionId() === sessionId && manager.getEntry(entryId)
					? { review: review(), target: manager }
					: undefined,
			execute: async target => {
				if (!this.#pendingTreeLabels.has(key)) {
					target.appendLabelChange(entryId, normalized);
					this.#pendingTreeLabels.set(key, normalized);
				}
				await target.retryPersistence();
				if (target.getLabel(entryId) !== normalized) throw new Error("Tree label changed while saving.");
				this.#pendingTreeLabels.delete(key);
			},
		});
		if (outcome === "succeeded") {
			this.ctx.showStatus(`Saved tree label for node ${entryId}.`);
			this.ctx.ui.requestRender();
			return true;
		}
		if (outcome === "unresolved")
			this.ctx.showError(`Tree label persistence is unresolved for node ${entryId}. Retry the same label.`);
		return false;
	}

	async showSessionSelector(): Promise<void> {
		const cwd = this.ctx.sessionManager.getCwd();
		const [sessions, allSessions] = await Promise.all([
			SessionManager.list(cwd, this.ctx.sessionManager.getSessionDir()),
			SessionManager.listAll(),
		]);
		let hideOverlay = () => {};
		const done = () => {
			hideOverlay();
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
		};
		const selector = new SessionSelectorComponent(
			sessions,
			async sessionPath => {
				const selected = [...sessions, ...allSessions].find(session => session.path === sessionPath);
				await this.handleResumeSession(sessionPath, selected);
				if (this.ctx.sessionManager.getSessionFile() === sessionPath) done();
			},
			done,
			() => {
				done();
				void this.ctx.shutdown();
			},
			async (session: SessionInfo) => {
				const pending = this.#pendingSessionDeletes.get(session.path);
				if (!pending) {
					const current = (await SessionManager.list(session.cwd, this.ctx.sessionManager.getSessionDir())).find(
						candidate => candidate.path === session.path,
					);
					if (!current || current.id !== session.id || current.modified.getTime() !== session.modified.getTime())
						throw new Error("Session changed since review. Close this result and review the refreshed target.");
				}
				const target =
					pending ??
					({
						id: session.id,
						path: session.path,
						cwd: session.cwd,
						name: session.title || session.firstMessage || session.id,
						artifactPath: session.path.slice(0, -6),
					} as const);
				this.#pendingSessionDeletes.set(session.path, target);
				if (!(await this.#detachActiveSessionBeforeDeletion(session.path))) {
					this.#pendingSessionDeletes.delete(session.path);
					return false;
				}
				const storage = new FileSessionStorage();
				try {
					await storage.deleteSessionWithArtifacts(session.path);
					if (await storage.exists(session.path)) throw new Error("Session file still exists after deletion.");
					try {
						await fs.stat(target.artifactPath);
						throw new Error("Session artifacts still exist after deletion.");
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
					this.#pendingSessionDeletes.delete(session.path);
					return true;
				} catch (err) {
					throw new Error(`Failed to delete session: ${err instanceof Error ? err.message : String(err)}`, {
						cause: err,
					});
				}
			},
			{ getTerminalRows: () => this.ctx.ui.terminal.rows, allSessions, currentCwd: cwd },
		);
		selector.setOnRequestRender(() => this.ctx.ui.requestRender());
		const overlay = this.ctx.ui.showOverlay(selector, {
			fullscreen: true,
			anchor: "top-left",
			width: "100%",
			maxHeight: "100%",
			margin: 0,
			mouseTracking: true,
		});
		hideOverlay = () => overlay.hide();
		this.ctx.ui.setFocus(selector);
	}

	#clearTransientSessionUi(): void {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();
		this.ctx.pendingMessagesContainer.clear();
		this.ctx.compactionQueuedMessages = [];
		this.ctx.streamingComponent = undefined;
		this.ctx.streamingMessage = undefined;
		this.ctx.pendingTools.clear();
	}

	#refreshSessionTerminalTitle(): void {
		const sessionManager = this.ctx.sessionManager as {
			getSessionName?: () => string | undefined;
			getCwd: () => string;
			titleSource?: "auto" | "user" | undefined;
		};
		setSessionTerminalTitle(sessionManager.getSessionName?.(), sessionManager.getCwd(), sessionManager.titleSource);
	}

	async #detachActiveSessionBeforeDeletion(sessionPath: string): Promise<boolean> {
		const currentSessionFile = this.ctx.sessionManager.getSessionFile();
		if (currentSessionFile !== sessionPath) {
			return true;
		}

		const detached = await this.ctx.session.newSession();
		if (!detached) {
			return false;
		}
		await this.ctx.sessionManager.retryPersistence();
		this.#refreshSessionTerminalTitle();

		this.#clearTransientSessionUi();
		this.ctx.statusLine.invalidate();
		this.ctx.statusLine.setSessionStartTime(Date.now());
		this.ctx.updateEditorTopBorder();
		this.ctx.updateEditorBorderColor();
		this.ctx.renderInitialMessages();
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender();
		return true;
	}

	async handleResumeSession(sessionPath: string, selected?: SessionInfo): Promise<void> {
		if (this.#resumingSession) {
			this.ctx.showStatus("A session resume review or operation is already active.");
			return;
		}
		this.#resumingSession = true;
		try {
			const manager = this.ctx.sessionManager;
			const session = this.ctx.session;
			const sourceId = this.#pendingResume?.sourceId ?? manager.getSessionId();
			const sourceFile = this.#pendingResume?.sourceFile ?? manager.getSessionFile();
			const candidates = selected
				? [selected]
				: [
						...(await SessionManager.list(manager.getCwd(), manager.getSessionDir())),
						...(await SessionManager.listAll()),
					];
			const target = this.#pendingResume?.target ?? candidates.find(candidate => candidate.path === sessionPath);
			if (!target) throw new Error(`Session is no longer available: ${sessionPath}`);
			if (manager.getSessionFile() === target.path && !this.#pendingResume) {
				this.ctx.showStatus(`Session ${target.id} is already active.`);
				return;
			}
			const statToken = async () => {
				const stat = await fs.stat(target.path);
				if (!stat.isFile()) throw new Error("Resume target is not a regular session file.");
				return [stat.dev, stat.ino, stat.size, stat.mtimeMs] as const;
			};
			const read = async () => {
				const recovery = Boolean(
					this.#pendingResume && manager.getSessionId() === target.id && manager.getSessionFile() === target.path,
				);
				if (
					this.ctx.session !== session ||
					this.ctx.sessionManager !== manager ||
					(!recovery && (manager.getSessionId() !== sourceId || manager.getSessionFile() !== sourceFile))
				)
					return undefined;
				const stat = await statToken();
				const current = (await SessionManager.list(target.cwd, path.dirname(target.path))).find(
					candidate => candidate.path === target.path,
				);
				if (!current || current.id !== target.id) return undefined;
				return {
					target: { recovery },
					review: {
						identity: `session-resume:${target.id}`,
						scope: `Saved session · ${target.cwd || "unknown working directory"}`,
						revision: createHash("sha256")
							.update(JSON.stringify([target, stat, recovery]))
							.digest("hex"),
						changes: [
							{ field: "Active session", before: sourceId, after: target.id },
							{ field: "Session file", before: sourceFile ?? "In-memory", after: target.path },
							{
								field: "Runtime working directory",
								before: manager.getCwd(),
								after: `Retained (${manager.getCwd()})`,
							},
							{
								field: "Session's recorded directory",
								before: "Not active",
								after: target.cwd || "Unknown",
							},
							{
								field: "Conversation view",
								before: recovery ? "Target loaded; UI refresh incomplete" : "Current transcript",
								after: `${target.messageCount} saved messages`,
							},
						],
						consequence: recovery
							? "Retries only UI and todo restoration for the session already loaded. It does not switch or interrupt work again."
							: "Flushes the current session, requests interruption of active work, loads this exact saved session into the current runtime working directory, restores its tools and state, and replaces the conversation view. The editor draft is retained.",
					},
				};
			};
			const initial = await read();
			if (!initial) throw new Error("The resume target changed before review.");
			const outcome = await runReviewedAction(this.ctx, "session resume", {
				review: initial.review,
				resolve: async () => read(),
				execute: async targetState => {
					if (!targetState.recovery) {
						await manager.retryPersistence();
						const switched = await session.switchSession(target.path);
						if (!switched) throw new Error("Session resume was declined; the current session is retained.");
						this.#pendingResume = { target, sourceId, sourceFile };
					}
					if (manager.getSessionId() !== target.id || manager.getSessionFile() !== target.path)
						throw new Error("The active session does not match the reviewed resume target.");
					this.#clearTransientSessionUi();
					this.#refreshSessionTerminalTitle();
					this.ctx.updateEditorBorderColor();
					this.ctx.chatContainer.clear();
					this.ctx.renderInitialMessages();
					await this.ctx.reloadTodos();
					this.#pendingResume = undefined;
				},
			});
			if (outcome === "succeeded") this.ctx.showStatus(`Resumed session ${target.id}.`);
			else if (outcome === "unresolved")
				this.ctx.showError(
					"Session resume remains unresolved. Retry the same target to finish without switching twice.",
				);
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#resumingSession = false;
		}
	}

	async handleSessionDeleteCommand(): Promise<void> {
		const pending = this.#pendingSessionDeletes.values().next().value as
			| { id: string; path: string; cwd: string; name: string; artifactPath: string }
			| undefined;
		const sessionFile = pending?.path ?? this.ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			this.ctx.showError("No session file to delete (in-memory session)");
			return;
		}

		const storage = new FileSessionStorage();
		const fileExists = await storage.exists(sessionFile);
		if (!fileExists && !pending) {
			this.ctx.showError("Session has not been saved yet");
			return;
		}
		const manager = this.ctx.sessionManager;
		const target =
			pending ??
			({
				id: manager.getSessionId(),
				path: sessionFile,
				cwd: manager.getCwd(),
				name: manager.getSessionName?.() ?? manager.getSessionId(),
				artifactPath: sessionFile.slice(0, -6),
			} as const);
		const statToken = async (targetPath: string) => {
			try {
				const stat = await fs.stat(targetPath);
				return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.isDirectory()] as const;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		};
		const review = async () => {
			const file = await statToken(target.path);
			const artifacts = await statToken(target.artifactPath);
			if (!file && !this.#pendingSessionDeletes.has(target.path) && !(await storage.exists(target.path)))
				return undefined;
			const isActive = this.ctx.sessionManager.getSessionFile() === target.path;
			return {
				identity: `session:${target.id}`,
				scope: `${this.#pendingSessionDeletes.has(target.path) ? "Deletion recovery" : "Saved session"} · ${target.cwd}`,
				revision: createHash("sha256")
					.update(JSON.stringify([target, file, artifacts, isActive]))
					.digest("hex"),
				changes: [
					{ field: "Session", before: target.name, after: "Permanently deleted" },
					{ field: "File", before: file ? target.path : "Already removed", after: "Removed" },
					{
						field: "Artifacts",
						before: artifacts ? target.artifactPath : "None present",
						after: "Removed",
					},
					...(isActive ? [{ field: "Active session", before: target.id, after: "New saved session" }] : []),
				],
				consequence:
					"Permanently removes the exact saved conversation and its artifacts. An active target is detached to a new saved session first. Partial cleanup is retained as unresolved and retry removes only what remains.",
			};
		};
		const proposed = await review();
		if (!proposed) {
			this.ctx.showError("The reviewed session is no longer available.");
			return;
		}
		const outcome = await runReviewedAction(this.ctx, pending ? "session deletion recovery" : "session deletion", {
			review: proposed,
			resolve: async () => {
				const current = await review();
				return current ? { review: current, target } : undefined;
			},
			execute: async current => {
				this.#pendingSessionDeletes.set(current.path, current);
				if (!(await this.#detachActiveSessionBeforeDeletion(current.path)))
					throw new Error("Session switch was declined; the target was not deleted.");
				await storage.deleteSessionWithArtifacts(current.path);
				if ((await statToken(current.path)) || (await statToken(current.artifactPath)))
					throw new Error("Session cleanup is incomplete.");
				this.#pendingSessionDeletes.delete(current.path);
			},
		});
		if (outcome === "succeeded") {
			this.ctx.showStatus(`Session ${target.id} and its artifacts were deleted.`);
			await this.showSessionSelector();
		} else if (outcome === "unresolved") {
			this.ctx.showError(`Session deletion is unresolved. Run /delete again to retry ${target.path}.`);
		}
	}

	async #handleLiteLLMLogin(): Promise<void> {
		this.ctx.showStatus("Configuring LiteLLM proxy…");
		const modelsPath = path.join(getAgentDir(), "models.yml");
		const configPath = path.join(path.dirname(modelsPath), "config.yml");
		let defaults = readLiteLLMConfig(modelsPath);

		try {
			const flowResult = await runProviderConnectionFlow({
				collectCredentials: async () => {
					try {
						const credentials = await loginLiteLLM({
							defaults,
							onPrompt: prompt => this.#promptLoginValue(prompt),
						});
						defaults = credentials;
						return credentials;
					} catch (error) {
						if (error instanceof LoginPromptCancelled) return null;
						throw error;
					}
				},
				probe: async credentials => {
					this.ctx.chatContainer.addChild(new Spacer(1));
					this.ctx.chatContainer.addChild(
						new Text(theme.fg("dim", `Connecting to ${credentials.baseUrl}…`), 1, 0),
					);
					this.ctx.ui.requestRender();
					const probe = await probeLiteLLMConnection(credentials.baseUrl, credentials.apiKey);
					if (probe.reachable) {
						this.ctx.chatContainer.addChild(
							new Text(
								theme.fg("success", `${theme.status.success} OK — ${probe.models.length} models available`),
								1,
								0,
							),
						);
						this.ctx.ui.requestRender();
					}
					return probe;
				},
				review: input => this.#reviewLiteLLMConnection(input.credentials, input.probe, modelsPath, configPath),
				commit: input =>
					commitLiteLLMLogin({
						credentials: input.credentials,
						probe: input.probe ?? { reachable: false, models: [] },
						modelsPath,
						configPath,
						session: this.ctx.session,
						connectionOnly: true,
					}),
				recover: request => this.#showLoginRecovery(request),
			});

			if (flowResult.status === "cancelled") {
				this.ctx.showStatus("LiteLLM login cancelled. Existing configuration unchanged.");
				return;
			}

			await this.#showProviderConnected("litellm", flowResult.discoveryError, true);
		} catch (error: unknown) {
			this.ctx.showError(`LiteLLM login failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async #handleVllmLogin(): Promise<void> {
		this.ctx.showStatus("Configuring vLLM…");
		const modelsPath = path.join(getAgentDir(), "models.yml");

		try {
			let defaultBaseUrl = readVllmConfig(modelsPath)?.baseUrl ?? DEFAULT_VLLM_BASE_URL;
			const storedCredential = this.ctx.session.modelRegistry.authStorage.get("vllm");
			const hadStoredKey = storedCredential?.type === "api_key" && storedCredential.key.length > 0;
			const flowResult = await runProviderConnectionFlow({
				collectCredentials: async () => {
					try {
						let baseUrl: string;
						while (true) {
							const value = await this.#promptLoginValue({
								message: `vLLM Base URL [${defaultBaseUrl}]`,
								placeholder: DEFAULT_VLLM_BASE_URL,
								allowEmpty: true,
							});
							try {
								baseUrl = normalizeVllmBaseUrl(value.trim() || defaultBaseUrl);
								break;
							} catch (error) {
								this.ctx.showError(error instanceof Error ? error.message : String(error));
							}
						}
						const apiKey = await this.#promptLoginValue({
							message: hadStoredKey
								? "Optional vLLM API key [stored securely; leave blank to remove authentication]"
								: "Optional vLLM API key [leave blank for keyless local service]",
							allowEmpty: true,
							secret: true,
						});
						defaultBaseUrl = baseUrl;
						return { baseUrl, apiKey };
					} catch (error) {
						if (error instanceof LoginPromptCancelled) return null;
						throw error;
					}
				},
				probe: async credentials => {
					this.ctx.chatContainer.addChild(new Spacer(1));
					this.ctx.chatContainer.addChild(
						new Text(theme.fg("dim", `Connecting to ${credentials.baseUrl}/models…`), 1, 0),
					);
					this.ctx.ui.requestRender();
					const probe = await probeVllmConnection(credentials.baseUrl, credentials.apiKey);
					this.ctx.chatContainer.addChild(
						new Text(
							theme.fg("success", `${theme.status.success} OK — ${probe.models.length} vLLM models available`),
							1,
							0,
						),
					);
					this.ctx.ui.requestRender();
					return probe;
				},
				review: input => this.#reviewVllmConnection(input.credentials, input.probe, modelsPath),
				commit: input =>
					commitVllmLogin({
						modelsPath,
						credentials: input.credentials,
						session: this.ctx.session,
						connectionOnly: true,
					}),
				recover: request => this.#showLoginRecovery(request, "vLLM"),
			});

			if (flowResult.status === "cancelled") {
				this.ctx.showStatus("vLLM login cancelled. Existing configuration unchanged.");
				return;
			}
			await this.#showProviderConnected("vllm", flowResult.discoveryError, true);
		} catch (error) {
			this.ctx.showError(`vLLM login failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async #handleOAuthLogin(providerId: string, reviewed = false): Promise<void> {
		if (providerId === "google-vertex") {
			await this.#handleVertexLogin();
			return;
		}
		if (providerId === "openai") {
			this.#showOpenAIApiKeyGuidance();
			return;
		}
		// LiteLLM has its own flow with config persistence
		if (providerId === "litellm") {
			return this.#handleLiteLLMLogin();
		}
		if (providerId === "vllm") {
			return this.#handleVllmLogin();
		}

		let openAICodexMethod: "browser" | "device" | undefined;
		if (providerId === "openai-codex") {
			openAICodexMethod = await this.#selectOpenAICodexLoginMethod();
			if (!openAICodexMethod) {
				this.ctx.showStatus("ChatGPT login cancelled.");
				this.#returnFromProviderSetup?.();
				return;
			}
		}
		if (!reviewed && !(await this.#reviewProviderLogin(providerId))) {
			this.#returnFromProviderSetup?.();
			return;
		}
		this.ctx.showStatus(`Logging in to ${providerId}…`);
		const manualInput = this.ctx.oauthManualInput;
		const useManualInput =
			CALLBACK_SERVER_PROVIDERS.has(providerId as OAuthProvider) || providerId === "openai-codex";
		const shouldOpenBrowser = providerId !== "openai-codex" || openAICodexMethod === "browser";
		let endAuthorizationWait: (() => void) | undefined;

		const abort = new AbortController();
		let closeAuthFrame: (() => void) | undefined;
		let authFrame: ConnectionInputComponent | undefined;
		const cancel = () => {
			abort.abort();
			manualInput.clear("Login cancelled");
			closeAuthFrame?.();
			closeAuthFrame = undefined;
		};
		const waitingInput = () => {
			const input = createLoginPromptInput({
				message: "Paste the redirect URL or authorization code",
				allowEmpty: true,
			});
			input.onEscape = cancel;
			input.onSubmit = () => {
				const value = input
					.getValue()
					.trim()
					.replace(/^\/login\s+/, "");
				if (value) manualInput.submit(value);
				input.setValue("");
			};
			return input;
		};
		const showAuthFrame = () => {
			if (authFrame) return authFrame;
			authFrame = new ConnectionInputComponent(
				`Sign in to ${getProviderDisplayName(providerId)}`,
				"Waiting for sign-in…",
				waitingInput(),
				() => this.ctx.ui.terminal?.rows ?? 24,
			);
			this.showSelector(done => {
				closeAuthFrame = done;
				return { component: authFrame!, focus: authFrame! };
			});
			return authFrame;
		};
		const loginCallbacks = {
			signal: abort.signal,
			method: openAICodexMethod,
			onAuth: (info: {
				url: string;
				openUrl?: string;
				instructions?: string;
				kind?: "browser" | "device";
				userCode?: string;
			}) => {
				const frame = showAuthFrame();
				frame.content.clear();
				if (info.kind === "device" && info.userCode) presentDeviceCode(frame.content, info.url, info.userCode);
				else presentAuthLink(frame.content, info.url);
				if (info.instructions) frame.content.addChild(new Text(theme.fg("muted", info.instructions), 0, 0));
				if (useManualInput) frame.content.addChild(new Text(theme.fg("dim", MANUAL_LOGIN_TIP), 0, 0));
				this.ctx.ui.requestRender();
				if (shouldOpenBrowser)
					void this.#launchHttpUrl(info.openUrl ?? info.url).then(result => {
						if (!result.ok) this.ctx.showWarning(`Could not open the sign-in page: ${result.error}`);
					});
				endAuthorizationWait ??= this.#beginPromptSignal("input");
			},
			onPrompt: async (prompt: OAuthPrompt) => {
				if (abort.signal.aborted) throw new LoginPromptCancelled();
				const frame = showAuthFrame();
				const { promise, resolve, reject } = Promise.withResolvers<string>();
				const input = createLoginPromptInput(prompt);
				const restoreWaiting = () => {
					frame.input = waitingInput();
					frame.purpose = "Waiting for approval in your browser…";
					this.ctx.ui.requestRender();
				};
				input.onSubmit = () => {
					const value = input.getValue();
					if (prompt.copyText && /^(?:c|copy)$/i.test(value.trim())) {
						void reviewClipboardAction(this.ctx, {
							title: "login recovery copy",
							identity: `login:${providerId}:prompt`,
							label: "One-time login recovery value",
							success: "One-time login recovery value copied to the local clipboard.",
							reopen: "Enter copy at the login prompt to review it again.",
							current: () => !abort.signal.aborted && frame.input === input,
							resolveText: () => prompt.copyText,
						}).then(outcome => {
							if (outcome === "copied" || outcome === "requested") {
								restoreWaiting();
								resolve("");
							} else {
								input.setValue("");
								frame.input = input;
								this.ctx.ui.requestRender();
							}
						});
					} else {
						restoreWaiting();
						resolve(value);
					}
				};
				input.onEscape = () => {
					cancel();
					reject(new LoginPromptCancelled());
				};
				frame.purpose = prompt.message;
				frame.input = input;
				this.ctx.ui.requestRender();
				const endPrompt = this.#beginPromptSignal("input");
				return promise.finally(endPrompt);
			},
			onProgress: (message: string) => {
				const frame = showAuthFrame();
				frame.purpose = message;
				this.ctx.ui.requestRender();
			},
			onManualCodeInput: useManualInput ? () => manualInput.waitForInput(providerId) : undefined,
		};
		try {
			await this.ctx.session.modelRegistry.authStorage.login(providerId as OAuthProvider, loginCallbacks);
			closeAuthFrame?.();
			closeAuthFrame = undefined;
			await this.#showProviderConnected(canonicalizeOAuthProviderId(providerId));
		} catch (error: unknown) {
			if (abort.signal.aborted || error instanceof LoginPromptCancelled) {
				this.ctx.showStatus("Login cancelled.");
				this.#returnFromProviderSetup?.();
			} else this.ctx.showError(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			closeAuthFrame?.();
			if (useManualInput) {
				manualInput.clear(`Manual OAuth input cleared for ${providerId}`);
			}
			endAuthorizationWait?.();
		}
	}

	#selectOpenAICodexLoginMethod(): Promise<"browser" | "device" | undefined> {
		const ordered = getOpenAICodexLoginMethods();
		const labels = ordered.map(method => (method === "browser" ? "Browser sign-in" : "Device code"));
		return new Promise(resolve => {
			this.showSelector(done => {
				const selector = new ConnectionChoiceComponent(
					"Sign in to ChatGPT",
					"Use your ChatGPT subscription.",
					labels.map((label, index) => ({
						label,
						description:
							ordered[index] === "browser"
								? "Open a browser on this computer to sign in."
								: "Open the sign-in page on another device; works over SSH.",
					})),
					index => {
						done();
						resolve(ordered[index]);
					},
					() => {
						done();
						resolve(undefined);
					},
					() => this.ctx.ui.terminal?.rows ?? 24,
				);
				return { component: selector, focus: selector };
			});
		});
	}

	/** Corporate Vertex uses isolated standalone OAuth, never consumer Google credentials or ambient ADC. */
	async #handleVertexLogin(): Promise<void> {
		const runtime = defaultVertexLoginRuntime;
		try {
			const authStorage = this.ctx.session.modelRegistry.authStorage;
			let accessToken = await authStorage.getApiKey("google-vertex");
			if (!accessToken) {
				if (!(await this.#reviewProviderLogin("google-vertex"))) {
					this.ctx.showStatus("Vertex AI login cancelled. Existing configuration unchanged.");
					return;
				}
				this.ctx.showStatus("Authenticating Corporate Vertex with the authorized Google enterprise flow…");
				let endAuthorizationWait: (() => void) | undefined;
				try {
					await authStorage.login("google-vertex", {
						onAuth: info => {
							presentAuthLink(this.ctx.chatContainer, info.url);
							this.ctx.chatContainer.addChild(new Text(theme.fg("dim", VERTEX_MANUAL_LOGIN_TIP), 1, 0));
							if (!isHeadlessTerminal(runtime.environment)) {
								const launch = this.#launchHttpUrl(info.url);
								void launch.then(result => {
									if (!result.ok) this.ctx.showWarning(`Could not open the sign-in page: ${result.error}`);
								});
							}
							this.ctx.ui.requestRender();
							endAuthorizationWait ??= this.#beginPromptSignal("input");
						},
						onPrompt: prompt =>
							this.#promptLoginValue({
								message: prompt.message,
								placeholder: prompt.placeholder,
								allowEmpty: prompt.allowEmpty,
							}),
						onProgress: message => this.ctx.showStatus(message),
						onManualCodeInput: () => this.ctx.oauthManualInput.waitForInput("google-vertex"),
					});
				} finally {
					endAuthorizationWait?.();
				}
				accessToken = await authStorage.getApiKey("google-vertex");
				if (!accessToken) throw new Error("Vertex OAuth authentication did not return an access token");
			}
			const detected = await detectVertexProject(runtime);
			const proposed = await this.#promptLoginValue({
				message: detected
					? `Vertex AI project: ${detected.id} (${detected.source}). Press Enter to confirm, or type another project.`
					: "Vertex AI project ID (required; Esc cancels):",
				placeholder: detected?.id,
				allowEmpty: true,
			});
			const project = proposed.trim() || detected?.id;
			if (!project) {
				this.ctx.showStatus("Vertex AI login cancelled. Existing configuration unchanged.");
				return;
			}

			try {
				this.ctx.showStatus("Validating Vertex AI OAuth credentials and Gemini 3.8 Flash access…");
				await validateVertexLogin(runtime, project, accessToken);
			} catch (error) {
				const action = await this.#showLoginRecovery(
					{ stage: "validation", error: vertexFailureGuidance(error, project), canEdit: true },
					"Google Cloud Vertex AI",
					"Sign in with gcloud",
				);
				if (action === "cancel") {
					this.ctx.showStatus("Vertex AI login cancelled. Existing configuration unchanged.");
					return;
				}
				if (action === "edit") throw new Error("Retry `/login google-vertex` to authenticate again.");
				await validateVertexLogin(runtime, project, accessToken);
			}

			if (!(await this.#reviewVertexProject(project))) {
				this.ctx.showStatus("Vertex AI project configuration cancelled. Existing settings unchanged.");
				return;
			}
			await this.#showProviderConnected("google-vertex");
		} catch (error) {
			if (error instanceof LoginPromptCancelled) {
				this.ctx.showStatus("Vertex AI login cancelled. Existing configuration unchanged.");
				return;
			}
			this.ctx.showError(`Vertex AI login failed: ${vertexFailureGuidance(error)}`);
		}
	}

	#showOpenAIApiKeyGuidance(): void {
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(
			new Text(theme.fg("warning", "OpenAI Responses API uses usage-based Platform API access."), 1, 0),
		);
		this.ctx.chatContainer.addChild(
			new Text(theme.fg("dim", "Set OPENAI_API_KEY, then select an OpenAI model with /model."), 1, 0),
		);
		this.ctx.chatContainer.addChild(
			new Text(theme.fg("dim", "For ChatGPT subscription access, choose ChatGPT Plus/Pro in /login."), 1, 0),
		);
		this.ctx.ui.requestRender();
	}

	async #handleOAuthLogout(providerId: string): Promise<boolean> {
		const proposal = this.#providerCredentialProposal(providerId, "logout");
		const outcome = await runReviewedAction(this.ctx, "provider credential removal", {
			review: proposal.review,
			resolve: async () => {
				const current = this.#providerCredentialProposal(providerId, "logout");
				return current.review.revision.endsWith(":stored") ? current : undefined;
			},
			execute: async () => {
				await this.ctx.session.modelRegistry.authStorage.logout(providerId);
			},
		});
		if (outcome === "busy") {
			this.ctx.showWarning("Another reviewed action is already active.");
			return false;
		}
		if (outcome !== "succeeded") {
			if (outcome === "cancelled") this.ctx.showStatus("Logout cancelled. Existing credentials unchanged.");
			else if (outcome === "unresolved")
				this.ctx.showError("Credential removal is unresolved. Review the action again to retry.");
			return false;
		}
		try {
			await this.ctx.session.modelRegistry.refresh();
			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(
				new Text(theme.fg("success", `${theme.status.success} Successfully logged out of ${providerId}`), 1, 0),
			);
			this.ctx.chatContainer.addChild(
				new Text(theme.fg("dim", `Credentials removed from ${getAgentDbPath()}`), 1, 0),
			);
			this.ctx.ui.requestRender();
		} catch (error: unknown) {
			this.ctx.showWarning(
				`Credentials were removed, but provider refresh failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return true;
	}

	async showFirstRunLogin(): Promise<void> {
		await this.showOAuthSelector("login");
	}

	async showOAuthSelector(mode: "login" | "logout", providerId?: string, onReturn?: () => void): Promise<void> {
		this.#returnFromProviderSetup = onReturn;
		if (providerId) {
			if (mode === "login") {
				await this.#handleOAuthLogin(providerId);
			} else {
				await this.#handleOAuthLogout(providerId);
			}
			return;
		}

		if (mode === "logout") {
			await this.#refreshOAuthProviderAuthState();
			const loggedInProviders = getLoginOptions().filter(
				provider => !provider.loginOnly && this.ctx.session.modelRegistry.authStorage.has(provider.id),
			);
			if (loggedInProviders.length === 0) {
				this.ctx.showStatus("No stored provider credentials to remove. Use /login first.");
				return;
			}
		}

		const registry = this.ctx.session.modelRegistry;
		const providerAllowlist = this.ctx.settings?.get?.("modelProviderAllowlist") ?? [];
		const providers = buildProviderManagementOptions({
			mode,
			providerInventory: registry.getProviderInventory(),
			configuredProviderIds: registry.getConfiguredProviderIds(),
			providerAllowlist,
			excludedProviderIds: this.ctx.settings?.get?.("disabledProviders") ?? [],
			getAccessState: selectedProviderId => registry.getProviderAccessState(selectedProviderId),
			getPickerMetadata: selectedProviderId => registry.getProviderPickerMetadata(selectedProviderId),
			hasStoredCredential: selectedProviderId => registry.authStorage.has(selectedProviderId),
		});

		this.showSelector(
			done => {
				let selector: OAuthSelectorComponent;
				selector = new OAuthSelectorComponent(
					mode,
					this.ctx.session.modelRegistry.authStorage,
					async (selectedProviderId: string) => {
						if (mode === "login") {
							const needsReview = this.#usesStandaloneCredentialReview(selectedProviderId);
							if (needsReview && !(await this.#reviewProviderLogin(selectedProviderId))) {
								selector.resumeValidation();
								return;
							}
							selector.stopValidation();
							done();
							await this.#handleOAuthLogin(selectedProviderId, needsReview);
						} else {
							if (!(await this.#handleOAuthLogout(selectedProviderId))) {
								selector.resumeValidation();
								return;
							}
							selector.stopValidation();
							done();
						}
					},
					() => {
						selector.stopValidation();
						done();
						onReturn?.();
						this.ctx.ui.requestRender();
					},
					{
						rows: () => this.ctx.ui.terminal?.rows ?? 24,
						onChooseModel: selectedProvider => {
							done();
							this.showModelSelector({
								initialProvider: selectedProvider,
								onCancel: () => {
									void this.showOAuthSelector("login", undefined, onReturn);
								},
							});
						},
						initialCatalog:
							mode === "login" &&
							registry.getConfiguredProviderIds().size === 0 &&
							providers.every(
								option =>
									option.action === "add-provider" ||
									(registry.getProviderAccessState(option.id).credentialSource === "keyless" &&
										!registry.authStorage.hasAuth(option.id)),
							),
						providers,
						catalogProviders: getLoginOptions().map(option => ({ ...option, providerIds: [option.id] })),
						getAccessState: provider => this.ctx.session.modelRegistry.getProviderAccessState?.(provider),
						getDiscoveryState: provider => this.ctx.session.modelRegistry.getProviderDiscoveryState?.(provider),
						validateAccess: async selectedProviderId => {
							await this.ctx.session.modelRegistry.refreshProvider(selectedProviderId, "online");
							return this.ctx.session.modelRegistry.getProviderAccessState?.(selectedProviderId);
						},
						isExcluded: provider => {
							return providerAllowlist.length > 0 && !providerAllowlist.includes(provider);
						},
						requestRender: () => {
							this.ctx.ui.requestRender();
						},
					},
				);
				return { component: selector, focus: selector };
			},
			mode === "login" ? "select" : undefined,
		);
	}

	showDebugSelector(): void {
		this.showSelector(done => {
			const selector = new DebugSelectorComponent(this.ctx, done);
			return { component: selector, focus: selector };
		});
	}

	showSessionObserver(registry: SessionObserverRegistry): void {
		const observeKeys = this.ctx.keybindings.getKeys("app.session.observe");

		this.showSelector(done => {
			let cleanup: (() => void) | undefined;

			const selector = new SessionObserverOverlayComponent(
				registry,
				() => {
					cleanup?.();
					done();
				},
				observeKeys,
			);

			cleanup = registry.onChange(() => {
				selector.refreshFromRegistry();
				this.ctx.ui.requestRender();
			});

			return { component: selector, focus: selector };
		});
	}
}
