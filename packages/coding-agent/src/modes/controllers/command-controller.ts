import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	getEnvApiKey,
	getProviderDetails,
	type ProviderDetails,
	type UsageLimit,
	type UsageReport,
} from "@f5-sales-demo/pi-ai";
import { Loader, Markdown, padding, Spacer, Text, visibleWidth } from "@f5-sales-demo/pi-tui";
import { APP_NAME, formatDuration, isEnoent, Snowflake, setProjectDir, setShellPwd, t } from "@f5-sales-demo/pi-utils";
import { $ } from "bun";
import { reset as resetCapabilities } from "../../capability";
import { clearXcshPluginRootsCache } from "../../discovery/helpers";
import { getCustomSharePath, loadCustomShare } from "../../export/custom-share";
import { prepareSessionHtmlExport } from "../../export/html";
import type { CompactOptions } from "../../extensibility/extensions/types";
import { getGatewayStatus } from "../../ipy/gateway-coordinator";
import {
	clearReviewedMemoryData,
	enqueueReviewedMemoryConsolidation,
	getMemoryRoot,
	inspectMemoryClear,
	inspectMemoryConsolidation,
} from "../../memories";
import { BashExecutionComponent } from "../../modes/components/bash-execution";
import { BorderedLoader } from "../../modes/components/bordered-loader";
import { createToolGutter } from "../../modes/components/gutter-block";
import { controlMediaPlayback, type MediaPlaybackAction } from "../../modes/components/media-message";
import { PythonExecutionComponent } from "../../modes/components/python-execution";
import type { ActionReview } from "../../modes/components/reviewed-action";
import { ActionInterruptedError, runReviewedAction } from "../../modes/components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../../modes/components/selector-frame";
import { SettingsTextEditor } from "../../modes/components/settings-editors";
import { getCurrentThemeName, getMarkdownTheme, getSymbolTheme, theme } from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import { extractLastLink } from "../../modes/utils/copy-targets";
import { buildHotkeysMarkdown } from "../../modes/utils/hotkeys-markdown";
import { buildToolsMarkdown } from "../../modes/utils/tools-markdown";
import type { AsyncJobSnapshotItem } from "../../session/agent-session";
import type { AuthStorage } from "../../session/auth-storage";
import type { NewSessionOptions } from "../../session/session-manager";
import { outputMeta } from "../../tools/output-meta";
import { resolveToCwd, stripOuterDoubleQuotes } from "../../tools/path-utils";
import { replaceTabs } from "../../tools/render-utils";
import { getChangelogPath, parseChangelog } from "../../utils/changelog";
import {
	type OpenHttpUrlResult,
	type OpenPathResult,
	openHttpUrl,
	openPath,
	openPathWithResult,
} from "../../utils/open";
import { setSessionTerminalTitle } from "../../utils/title-generator";
import { reviewClipboardAction } from "../utils/clipboard-action";
import { reviewExternalUrlAction } from "../utils/open-action";

/** Accept macOS's documented logical temporary-directory aliases, but not arbitrary symlinks. */
function isExpectedResolvedDirectory(requested: string, resolved: string): boolean {
	const absolute = path.resolve(requested);
	const expected =
		process.platform === "darwin" && (absolute === "/var" || absolute.startsWith("/var/"))
			? `/private${absolute}`
			: process.platform === "darwin" && (absolute === "/tmp" || absolute.startsWith("/tmp/"))
				? `/private${absolute}`
				: absolute;
	return resolved === expected;
}

async function showMarkdownPanel(
	ctx: InteractiveModeContext,
	title: string,
	purpose: string,
	markdown: string,
): Promise<void> {
	await ctx.showHookCustom<void>(
		(ui, _theme, _keys, done) =>
			new ReportDetailsComponent(
				title,
				purpose,
				markdown.trim(),
				() => done(),
				() => ui.terminal.rows,
				(content, width) => new Markdown(content, 0, 0, getMarkdownTheme()).render(width),
			),
	);
}

type ManualCompactionTarget =
	| {
			kind: "persist";
			manager: InteractiveModeContext["sessionManager"];
			session: InteractiveModeContext["session"];
	  }
	| {
			kind: "compact";
			manager: InteractiveModeContext["sessionManager"];
			session: InteractiveModeContext["session"];
			leafId: string | null;
			messageCount: number;
			alreadyCompacted: boolean;
			instructions: string | undefined;
	  };

export class CommandController {
	#clearingMemory = false;
	#exportingSession = false;
	#fetchingUsage = false;
	#writingDebugTranscript = false;
	#lastUsageReports: UsageReport[] | null = null;
	#forkingSession = false;
	#openingLink = false;
	#sharingSession = false;
	#handingOff = false;
	#pendingFork:
		| {
				manager: InteractiveModeContext["sessionManager"];
				preview: NonNullable<ReturnType<InteractiveModeContext["sessionManager"]["previewFork"]>>;
		  }
		| undefined;
	#pendingManualCompaction:
		| {
				manager: InteractiveModeContext["sessionManager"];
				session: InteractiveModeContext["session"];
				leafId: string | null;
				instructions: string | undefined;
		  }
		| undefined;
	constructor(private readonly ctx: InteractiveModeContext) {}

	openInBrowser(urlOrPath: string): void {
		openPath(urlOrPath);
	}

	openHttpUrl(url: string): Promise<OpenHttpUrlResult> {
		return openHttpUrl(url);
	}

	openLocalPath(target: string): Promise<OpenPathResult> {
		return openPathWithResult(target);
	}

	async handleExportCommand(text: string): Promise<void> {
		if (this.#exportingSession) {
			this.ctx.showWarning("A session export is already open or running.");
			return;
		}
		const arg = text.replace(/^\S+\s*/, "").trim();

		if (arg === "--copy" || arg === "clipboard" || arg === "copy") {
			this.ctx.showWarning(t("controller.export.warnings.useDump"));
			return;
		}

		this.#exportingSession = true;
		try {
			const session = this.ctx.session;
			const manager = this.ctx.sessionManager;
			const sessionId = manager.getSessionId();
			const sessionFile = manager.getSessionFile();
			if (!sessionFile) throw new Error("Cannot export in-memory session to HTML");
			const requested = arg || `${APP_NAME}-session-${path.basename(sessionFile, ".jsonl")}.html`;
			const outputPath = resolveToCwd(stripOuterDoubleQuotes(requested), manager.getCwd());
			const current = () =>
				this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
			const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
			const inspect = async (file: string) => {
				try {
					const stat = await fs.lstat(file);
					if (!stat.isFile() || stat.isSymbolicLink())
						throw new Error(`Export destination must be a regular file, not a link or directory: ${file}`);
					const bytes = await fs.readFile(file);
					return {
						hash: digest(bytes),
						size: bytes.length,
						identity: `${stat.dev}:${stat.ino}`,
						mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
						owner: `${stat.uid}:${stat.gid}`,
					};
				} catch (error) {
					if (isEnoent(error)) return undefined;
					throw error;
				}
			};
			const canonical = async (directory: string): Promise<string> => {
				try {
					return await fs.realpath(directory);
				} catch (error) {
					if (!isEnoent(error) || path.dirname(directory) === directory) throw error;
					return path.join(await canonical(path.dirname(directory)), path.basename(directory));
				}
			};
			const prepare = async () => {
				const snapshot = await prepareSessionHtmlExport(manager, session.state, {
					outputPath,
					themeName: getCurrentThemeName(),
				});
				const files = [];
				for (const file of snapshot.files) {
					const destination = path.join(await canonical(path.dirname(file.path)), path.basename(file.path));
					if (destination === path.join(await canonical(path.dirname(sessionFile)), path.basename(sessionFile)))
						throw new Error("Export cannot overwrite the active session file.");
					const before = await inspect(destination);
					files.push({
						...file,
						path: destination,
						before,
						hash: digest(file.bytes),
					});
				}
				const hasWrites = files.some(file => file.before?.hash !== file.hash);
				const review: ActionReview = {
					identity: `session-export:${sessionId}`,
					scope: `Local HTML export · ${outputPath}`,
					revision: JSON.stringify(files.map(file => [file.path, file.before, file.hash])),
					changes: files.map(file => ({
						field: file.path,
						before: file.before
							? `${file.before.size} bytes · SHA256 ${file.before.hash.slice(0, 12)} · permissions ${file.before.mode} · owner ${file.before.owner}`
							: "Absent",
						after: `${file.bytes.length} bytes · SHA256 ${file.hash.slice(0, 12)}${file.before?.hash === file.hash ? " (unchanged; no write)" : process.platform === "win32" ? " · platform file permissions" : " · permissions 0600 · owned by current user"}`,
					})),
					consequence: `${hasWrites ? "Write changed HTML and media files, creating parent directories as needed. Changed existing files are replaced; matching files are left unchanged." : "All export files already match; no files or directories will be written."} Contains conversation, system prompt and tool information; anyone with file access can read it. Opens the local HTML after completion; no remote publication.${snapshot.missingAssets ? ` Warning: ${snapshot.missingAssets} media assets are unavailable and will be omitted.` : ""}`,
				};
				return { review, target: { snapshot, files } };
			};
			const proposal = await prepare();
			if (!current()) throw new Error("The export session changed. Open /export again.");
			const outcome = await runReviewedAction(this.ctx, "session export", {
				review: proposal.review,
				resolve: async () => {
					if (!current()) return undefined;
					const prepared = await prepare();
					return current() ? prepared : undefined;
				},
				execute: async ({ files }) => {
					let saved = 0;
					for (const file of files) {
						try {
							if (!current()) throw new Error("The export session changed");
							if (JSON.stringify(await inspect(file.path)) !== JSON.stringify(file.before))
								throw new Error(`Destination changed: ${file.path}. Review again before overwriting.`);
							if (file.before?.hash === file.hash) continue;
							await fs.mkdir(path.dirname(file.path), { recursive: true });
							if (
								!isExpectedResolvedDirectory(
									path.dirname(file.path),
									await fs.realpath(path.dirname(file.path)),
								)
							)
								throw new Error("Export parent directory changed");
							const temporary = path.join(path.dirname(file.path), `.xcsh-export-${Snowflake.next()}.tmp`);
							const handle = await fs.open(temporary, "wx", 0o600);
							try {
								await fs.writeFile(handle, file.bytes);
								await handle.sync();
								await handle.close();
								if (JSON.stringify(await inspect(file.path)) !== JSON.stringify(file.before))
									throw new Error("Export destination changed while preparing the write");
								await fs.rename(temporary, file.path);
							} finally {
								try {
									await handle.close();
								} finally {
									await fs.unlink(temporary).catch(error => {
										if (!isEnoent(error)) throw error;
									});
								}
							}
							saved++;
						} catch (error) {
							throw new Error(
								`${saved} export files saved in this attempt; remaining writes unresolved. ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}
				},
			});
			if (outcome === "succeeded") {
				this.ctx.showStatus(t("controller.export.status.exported", { path: outputPath }));
				const opened = await this.openLocalPath(outputPath);
				if (!opened.ok)
					this.ctx.showWarning(
						`Export saved but automatic open failed: ${opened.error}\nOpen manually: ${outputPath}`,
					);
			}
		} catch (error: unknown) {
			this.ctx.showError(`Failed to export session: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.#exportingSession = false;
		}
	}

	async handleDumpCommand(): Promise<void> {
		const session = this.ctx.session;
		const manager = this.ctx.sessionManager;
		const sessionId = manager.getSessionId();
		await reviewClipboardAction(this.ctx, {
			title: "conversation copy",
			identity: `conversation:${sessionId}`,
			label: "Current conversation",
			success: "Conversation copied to the local clipboard.",
			reopen: "Open /dump to review and retry.",
			current: () =>
				this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId,
			resolveText: () => session.formatSessionAsText(),
		});
	}

	async handleDebugTranscriptCommand(): Promise<void> {
		if (this.#writingDebugTranscript) {
			this.ctx.showWarning("A transcript export review or write is already active.");
			return;
		}
		this.#writingDebugTranscript = true;
		const session = this.ctx.session;
		const manager = this.ctx.sessionManager;
		const sessionId = manager.getSessionId();
		const outputPath = path.join(os.tmpdir(), `${Snowflake.next()}-tui-transcript.txt`);
		try {
			const current = () =>
				this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
			const inspect = async () => {
				try {
					const stat = await fs.lstat(outputPath);
					if (!stat.isFile() || stat.isSymbolicLink())
						throw new Error("Transcript destination is not a regular file.");
					const bytes = await fs.readFile(outputPath);
					return { size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
				} catch (error) {
					if (isEnoent(error)) return undefined;
					throw error;
				}
			};
			const prepare = async () => {
				if (!current()) throw new Error("The session changed. Open the transcript export again.");
				const width = Math.max(1, this.ctx.ui.terminal.columns);
				const rendered = this.ctx.chatContainer
					.render(width)
					.map(line => replaceTabs(Bun.stripANSI(line)))
					.join("\n")
					.trimEnd();
				if (!rendered) throw new Error(t("controller.debug.errors.noMessages"));
				const content = `${rendered}\n`;
				const hash = createHash("sha256").update(content).digest("hex");
				const before = await inspect();
				const review: ActionReview = {
					identity: `tui-transcript:${sessionId}`,
					scope: `Local diagnostic export · ${outputPath}`,
					revision: JSON.stringify({ width, before, hash }),
					changes: [
						{
							field: outputPath,
							before: before ? `${before.size} bytes · SHA256 ${before.hash.slice(0, 12)}` : "Absent",
							after: `${Buffer.byteLength(content)} bytes · SHA256 ${hash.slice(0, 12)} · permissions 0600`,
						},
					],
					consequence:
						"Writes the currently rendered conversation to a local temporary text file. It can contain sensitive transcript and tool output; anyone with file access can read it. A changed existing destination is atomically replaced.",
				};
				return { review, target: { before, content } };
			};
			const proposal = await prepare();
			const outcome = await runReviewedAction(this.ctx, "TUI transcript export", {
				review: proposal.review,
				resolve: prepare,
				execute: async ({ before, content }) => {
					if (JSON.stringify(await inspect()) !== JSON.stringify(before))
						throw new Error("Transcript destination changed after review.");
					const temporary = `${outputPath}.${Snowflake.next()}.tmp`;
					const handle = await fs.open(temporary, "wx", 0o600);
					try {
						await handle.writeFile(content, "utf8");
						await handle.sync();
						await handle.close();
						if (JSON.stringify(await inspect()) !== JSON.stringify(before))
							throw new Error("Transcript destination changed while preparing the write.");
						await fs.rename(temporary, outputPath);
					} finally {
						await handle.close().catch(() => {});
						await fs.unlink(temporary).catch(() => {});
					}
				},
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "succeeded")
				this.ctx.showStatus(t("controller.debug.status.written", { path: outputPath }));
		} catch (error: unknown) {
			this.ctx.showError(
				t("controller.debug.errors.failed", {
					message: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		} finally {
			this.#writingDebugTranscript = false;
		}
	}

	async handleShareCommand(): Promise<void> {
		if (this.#sharingSession) {
			this.ctx.showWarning("A session share review or publication is already active.");
			return;
		}
		this.#sharingSession = true;
		const session = this.ctx.session;
		const manager = this.ctx.sessionManager;
		const sessionId = manager.getSessionId();
		const stagingRoot = path.join(os.tmpdir(), `xcsh-share-${Snowflake.next()}`);
		const htmlPath = path.join(stagingRoot, "session.html");
		const current = () =>
			this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
		let resultUrl: string | undefined;
		let resultMessage: string | undefined;
		try {
			const prepare = async () => {
				if (!current()) throw new Error("The session changed. Open /share again.");
				const customPath = getCustomSharePath();
				let customRevision: string | undefined;
				if (customPath)
					customRevision = createHash("sha256")
						.update(await fs.readFile(customPath))
						.digest("hex");
				else {
					let authResult: Awaited<ReturnType<typeof $>>;
					try {
						authResult = await $`gh auth status`.quiet().nothrow();
					} catch {
						throw new Error(t("controller.share.ghNotInstalled"));
					}
					if (authResult.exitCode !== 0) throw new Error(t("controller.share.ghNotLoggedIn"));
				}
				const snapshot = await prepareSessionHtmlExport(manager, session.state, {
					outputPath: htmlPath,
					themeName: getCurrentThemeName(),
				});
				try {
					await fs.lstat(stagingRoot);
					throw new Error("Share staging destination unexpectedly exists. Reopen /share.");
				} catch (error) {
					if (!isEnoent(error)) throw error;
				}
				const hashes = snapshot.files.map(file => ({
					path: path.relative(stagingRoot, file.path),
					hash: createHash("sha256").update(file.bytes).digest("hex"),
					size: file.bytes.length,
				}));
				const provider = customPath ? `custom handler ${customPath}` : "GitHub secret gist";
				const review: ActionReview = {
					identity: `session-share:${sessionId}`,
					scope: `Remote publication · ${provider}`,
					revision: JSON.stringify({ sessionId, customPath, customRevision, hashes }),
					changes: [
						{
							field: "Published transcript",
							before: "Not published by this action",
							after: `${hashes.reduce((sum, file) => sum + file.size, 0)} bytes · SHA256 ${hashes.at(-1)?.hash.slice(0, 12)}`,
						},
						{
							field: "Visibility",
							before: "None",
							after: customPath
								? "Determined by the custom share handler"
								: "Secret/unlisted gist; accessible to anyone with its URL",
						},
					],
					consequence: `Stages the current conversation, system prompt, tool information and available media in a private temporary directory, then passes the HTML to ${provider}. This may publish sensitive conversation content remotely. Temporary files are removed after the handler finishes. A returned URL is shown but never opened automatically.${snapshot.missingAssets ? ` ${snapshot.missingAssets} media asset(s) are unavailable and will be omitted.` : ""}`,
				};
				return { review, target: { snapshot, customPath, customRevision } };
			};
			const proposal = await prepare();
			const outcome = await runReviewedAction(this.ctx, "session publication", {
				review: proposal.review,
				resolve: prepare,
				execute: async ({ snapshot, customPath, customRevision }) => {
					await fs.mkdir(stagingRoot, { recursive: false, mode: 0o700 });
					for (const file of snapshot.files) {
						await fs.mkdir(path.dirname(file.path), { recursive: true, mode: 0o700 });
						await fs.writeFile(file.path, file.bytes, { mode: 0o600, flag: "wx" });
					}
					try {
						if (customPath) {
							if (
								createHash("sha256")
									.update(await fs.readFile(customPath))
									.digest("hex") !== customRevision
							)
								throw new Error("Custom share handler changed after review.");
							const customShare = await loadCustomShare();
							if (!customShare || customShare.path !== customPath)
								throw new Error("Custom share handler changed after review.");
							const result = await customShare.fn(htmlPath);
							if (typeof result === "string") resultUrl = result;
							else if (result) {
								resultUrl = result.url;
								resultMessage = result.message;
							}
						} else {
							const result = await $`gh gist create --public=false ${htmlPath}`.quiet().nothrow();
							if (result.exitCode !== 0)
								throw new Error(result.stderr.toString("utf-8").trim() || "Unknown GitHub Gist error");
							const gistUrl = result.stdout.toString("utf-8").trim();
							const gistId = gistUrl.split("/").pop();
							if (!gistId) throw new Error(t("controller.share.gistParseFailed"));
							resultUrl = `https://gistpreview.github.io/?${gistId}`;
							resultMessage = `Gist: ${gistUrl}`;
						}
					} finally {
						await fs.rm(stagingRoot, { recursive: true, force: true });
					}
				},
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "succeeded") {
				const parts = [
					resultUrl ? `Share URL: ${resultUrl}` : t("controller.share.sessionShared"),
					resultMessage,
				].filter((value): value is string => Boolean(value));
				this.ctx.showStatus(parts.join("\n"));
			}
		} catch (error) {
			await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#sharingSession = false;
		}
	}

	handleMediaCommand(text: string): void {
		const [, action, target = "latest", ...extra] = text.trim().split(/\s+/u);
		if (!["play", "pause", "stop"].includes(action ?? "") || extra.length > 0) {
			this.ctx.showError("Usage: /media play|pause|stop <latest|media-id>");
			return;
		}
		const result = controlMediaPlayback(action as MediaPlaybackAction, target);
		if (!result) {
			this.ctx.showError(
				target === "latest" ? "No media is available in this transcript." : `Media not found: ${target}`,
			);
			return;
		}
		this.ctx.showStatus(`Media ${result.id}: ${result.state}`);
	}

	async handleCopyCommand(sub?: string): Promise<void> {
		if (sub === undefined) {
			this.ctx.showCopySelector();
			return;
		}
		const labels: Record<string, string> = {
			last: "Last assistant message",
			code: "Last code block",
			all: "All code blocks",
			cmd: "Last shell or Python command",
			link: "Last link",
		};
		const label = labels[sub];
		if (!label) {
			this.ctx.showError(t("controller.copy.errors.unknownSub", { sub }));
			return;
		}
		const session = this.ctx.session;
		const manager = this.ctx.sessionManager;
		const sessionId = manager.getSessionId();
		const resolveText = () => {
			if (sub === "link") return extractLastLink(session.messages) ?? undefined;
			if (sub === "cmd") {
				for (const message of [...session.messages].reverse()) {
					if (message.role !== "assistant") continue;
					for (const part of [...message.content].reverse()) {
						if (part.type !== "toolCall") continue;
						if (part.name === "bash" && typeof part.arguments.command === "string") return part.arguments.command;
						if (part.name === "python" && typeof part.arguments.code === "string") return part.arguments.code;
					}
				}
				return undefined;
			}
			const text = session.getLastAssistantText();
			if (sub === "last" || !text) return text ?? undefined;
			const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map(match => match[1].replace(/\n$/, ""));
			return sub === "code" ? blocks.at(-1) : blocks.length ? blocks.join("\n\n") : undefined;
		};
		await reviewClipboardAction(this.ctx, {
			title: "clipboard copy",
			identity: `clipboard:${sessionId}:${sub}`,
			label,
			success: `${label} copied to the local clipboard.`,
			reopen: `Open /copy ${sub} to review and retry.`,
			current: () =>
				this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId,
			resolveText,
		});
	}

	async handleOpenCommand(args?: string): Promise<void> {
		if (args?.trim()) {
			this.ctx.showError(t("controller.open.usage"));
			return;
		}
		if (this.#openingLink) {
			this.ctx.showWarning("Another link review or launch is already active.");
			return;
		}
		this.#openingLink = true;
		try {
			const session = this.ctx.session;
			const manager = this.ctx.sessionManager;
			const sessionId = manager.getSessionId();
			const current = () =>
				this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
			if (!extractLastLink(session.messages)) {
				this.ctx.showWarning(t("controller.copy.warnings.noLink"));
				return;
			}
			const outcome = await reviewExternalUrlAction(this.ctx, {
				title: "external link",
				identity: `session-link:${sessionId}`,
				scope: `External browser navigation · session ${sessionId}`,
				current,
				resolveUrl: () => extractLastLink(session.messages) ?? undefined,
				open: link => this.openHttpUrl(link),
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "missing") this.ctx.showWarning(t("controller.copy.warnings.noLink"));
			else if (outcome === "succeeded") this.ctx.showStatus(t("controller.open.status"));
		} finally {
			this.#openingLink = false;
		}
	}

	async handleSessionCommand(): Promise<void> {
		const stats = this.ctx.session.getSessionStats();
		const premiumRequests =
			"premiumRequests" in stats && typeof stats.premiumRequests === "number"
				? stats.premiumRequests
				: this.ctx.session.sessionManager.getUsageStatistics().premiumRequests;
		const normalizedPremiumRequests = Math.round((premiumRequests + Number.EPSILON) * 100) / 100;

		let info = `${theme.bold(t("controller.session.title"))}\n\n`;
		info += `${theme.fg("dim", t("controller.session.file"))} ${stats.sessionFile ?? t("controller.session.inMemory")}\n`;
		info += `${theme.fg("dim", t("controller.session.id"))} ${stats.sessionId}\n\n`;
		info += `\n${theme.bold(t("controller.session.provider"))}\n`;
		const model = this.ctx.session.model;
		if (!model) {
			info += `${theme.fg("dim", t("controller.session.noModel"))}\n`;
		} else {
			const authMode = resolveProviderAuthMode(this.ctx.session.modelRegistry.authStorage, model.provider);
			const openaiWebsocketSetting = this.ctx.settings.get("providers.openaiWebsockets") ?? "auto";
			const preferOpenAICodexWebsockets =
				openaiWebsocketSetting === "on" ? true : openaiWebsocketSetting === "off" ? false : undefined;
			const providerDetails = getProviderDetails({
				model,
				sessionId: stats.sessionId,
				authMode,
				preferWebsockets: preferOpenAICodexWebsockets,
				providerSessionState: this.ctx.session.providerSessionState,
			});
			info += renderProviderSection(providerDetails, theme);
		}
		info += `\n`;
		info += `${theme.bold(t("controller.session.messages"))}\n`;
		info += `${theme.fg("dim", t("controller.session.user"))} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", t("controller.session.assistant"))} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", t("controller.session.toolCalls"))} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", t("controller.session.toolResults"))} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", t("controller.session.total"))} ${stats.totalMessages}\n\n`;
		info += `${theme.bold(t("controller.session.tokens"))}\n`;
		info += `${theme.fg("dim", t("controller.session.input"))} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", t("controller.session.output"))} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", t("controller.session.cacheRead"))} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", t("controller.session.cacheWrite"))} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", t("controller.session.total"))} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0 || normalizedPremiumRequests > 0) {
			info += `\n${theme.bold(t("controller.session.cost"))}\n`;
			if (stats.cost > 0) {
				info += `${theme.fg("dim", t("controller.session.total"))} ${stats.cost.toFixed(4)}\n`;
			}
			if (normalizedPremiumRequests > 0) {
				info += `${theme.fg("dim", t("controller.session.premiumRequests"))} ${normalizedPremiumRequests.toLocaleString()}\n`;
			}
		}

		const gateway = await getGatewayStatus();
		info += `\n${theme.bold(t("controller.session.pythonGateway"))}\n`;
		if (gateway.active) {
			info += `${theme.fg("dim", t("controller.session.status"))} ${theme.fg("success", t("controller.session.gatewayActive"))}\n`;
			info += `${theme.fg("dim", t("controller.session.url"))} ${gateway.url}\n`;
			info += `${theme.fg("dim", t("controller.session.pid"))} ${gateway.pid}\n`;
			if (gateway.pythonPath) {
				info += `${theme.fg("dim", t("controller.session.python"))} ${gateway.pythonPath}\n`;
			}
			if (gateway.venvPath) {
				info += `${theme.fg("dim", t("controller.session.venv"))} ${gateway.venvPath}\n`;
			}
			if (gateway.uptime !== null) {
				const uptimeSec = Math.floor(gateway.uptime / 1000);
				const mins = Math.floor(uptimeSec / 60);
				const secs = uptimeSec % 60;
				info += `${theme.fg("dim", t("controller.session.uptime"))} ${mins}m ${secs}s\n`;
			}
		} else {
			info += `${theme.fg("dim", t("controller.session.status"))} ${theme.fg("dim", t("controller.session.gatewayInactive"))}\n`;
		}

		if (this.ctx.lspServers && this.ctx.lspServers.length > 0) {
			info += `\n${theme.bold(t("controller.session.lspServers"))}\n`;
			for (const server of this.ctx.lspServers) {
				const statusColor =
					server.status === "ready" ? "success" : server.status === "connecting" ? "warning" : "error";
				const statusText =
					server.status === "error" && server.error ? `${server.status}: ${server.error}` : server.status;
				info += `${theme.fg("dim", `${server.name}:`)} ${theme.fg(statusColor, statusText)} ${theme.fg("dim", `(${server.fileTypes.join(", ")})`)}\n`;
			}
		}

		if (this.ctx.mcpManager) {
			const mcpServers = this.ctx.mcpManager.getConnectedServers();
			info += `\n${theme.bold(t("controller.session.mcpServers"))}\n`;
			if (mcpServers.length === 0) {
				info += `${theme.fg("dim", t("controller.session.noneConnected"))}\n`;
			} else {
				for (const name of mcpServers) {
					const conn = this.ctx.mcpManager.getConnection(name);
					const toolCount = conn?.tools?.length ?? 0;
					info += `${theme.fg("dim", `${name}:`)} ${theme.fg("success", "connected")} ${theme.fg("dim", `(${toolCount} tools)`)}\n`;
				}
			}
		}

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(info, 1, 0));
		this.ctx.ui.requestRender();
	}

	async handleJobsCommand(): Promise<void> {
		const snapshot = this.ctx.session.getAsyncJobSnapshot({ recentLimit: 5 });
		if (!snapshot) {
			this.ctx.showWarning(t("controller.jobs.unavailable"));
			return;
		}

		const now = Date.now();
		const lineWidth = Math.max(24, Math.min(96, (this.ctx.ui.terminal.columns ?? 100) - 8));
		let info = "";

		if (snapshot.running.length === 0 && snapshot.recent.length === 0) {
			await this.showReport(t("controller.jobs.title"), "Current session · empty", t("controller.jobs.noJobs"));
			return;
		}

		if (snapshot.running.length > 0) {
			info += `\n${theme.bold(t("controller.jobs.runningJobs"))}\n`;
			for (const job of snapshot.running) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		if (snapshot.recent.length > 0) {
			info += `\n${theme.bold(t("controller.jobs.recentJobs"))}\n`;
			for (const job of snapshot.recent) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		await this.showReport(
			t("controller.jobs.title"),
			`Current session · ${snapshot.running.length} running · ${snapshot.recent.length} recent`,
			info.trimEnd(),
		);
	}

	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			if (this.#fetchingUsage) {
				this.ctx.showStatus("Usage refresh is already running; duplicate request ignored.");
				return;
			}
			const provider = this.ctx.session as {
				fetchUsageReports?: () => Promise<UsageReport[] | null>;
			};
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning(t("controller.usage.notConfigured"));
				return;
			}
			this.#fetchingUsage = true;
			const loader = new BorderedLoader(this.ctx.ui, theme, "Refreshing provider usage", false);
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(loader);
			this.ctx.ui.setFocus(loader);
			this.ctx.ui.requestRender();
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				const message = t("controller.usage.fetchFailed", {
					message: error instanceof Error ? error.message : String(error),
				});
				if (this.#lastUsageReports?.length) {
					await this.showUsageReport(this.#lastUsageReports, `Cached data · refresh failed: ${message}`);
				} else this.ctx.showError(message);
				return;
			} finally {
				loader.dispose();
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(this.ctx.editor);
				this.ctx.ui.setFocus(this.ctx.editor);
				this.ctx.ui.requestRender();
				this.#fetchingUsage = false;
			}
		}

		if (!usageReports || usageReports.length === 0) {
			this.ctx.showWarning(t("controller.usage.noData"));
			return;
		}

		this.#lastUsageReports = usageReports;
		await this.showUsageReport(usageReports);
	}

	async handleChangelogCommand(showFull = false): Promise<void> {
		const changelogPath = getChangelogPath();
		const allEntries = await parseChangelog(changelogPath);
		// Default to showing only the latest 3 versions unless --full is specified
		// allEntries comes from parseChangelog with newest first, reverse to show oldest->newest
		const entriesToShow = showFull ? allEntries : allEntries.slice(0, 3);
		const changelogMarkdown =
			entriesToShow.length > 0
				? [...entriesToShow]
						.reverse()
						.map(e => e.content)
						.join("\n\n")
				: t("controller.changelog.noEntries");
		const title = showFull ? t("controller.changelog.fullTitle") : t("controller.changelog.recentTitle");
		const hint = showFull
			? ""
			: `\n\n${theme.fg("dim", "Use")} ${theme.bold("/changelog full")} ${theme.fg("dim", "to view the complete changelog.")}`;

		await showMarkdownPanel(
			this.ctx,
			title,
			showFull ? "Complete release history" : `Latest ${entriesToShow.length} releases`,
			changelogMarkdown + hint,
		);
	}

	async handleHotkeysCommand(): Promise<void> {
		const hotkeys = buildHotkeysMarkdown({ keybindings: this.ctx.keybindings });
		await showMarkdownPanel(this.ctx, t("controller.hotkeys.title"), "Effective terminal keybindings", hotkeys);
	}

	async handleToolsCommand(): Promise<void> {
		const tools = buildToolsMarkdown({
			tools: this.ctx.session.agent.state.tools,
		});
		await showMarkdownPanel(this.ctx, t("controller.tools.title"), "Tools available to the active model", tools);
	}

	private async showReport(title: string, purpose: string, content: string): Promise<void> {
		await this.ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					title,
					purpose,
					content,
					() => done(),
					() => ui.terminal.rows,
				),
		);
	}

	private async showUsageReport(reports: UsageReport[], purpose?: string): Promise<void> {
		const now = Date.now();
		const latestFetchedAt = Math.max(...reports.map(report => report.fetchedAt ?? 0));
		const age = latestFetchedAt ? `${formatDuration(Math.max(0, now - latestFetchedAt))} old` : "age unavailable";
		await this.ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					"Usage",
					purpose ?? `Provider limits · ${age}`,
					"",
					() => done(),
					() => ui.terminal.rows,
					(_content, width) => renderUsageReports(reports, theme, now, width).split("\n"),
				),
		);
	}

	async handleMemoryCommand(text: string): Promise<void> {
		const argumentText = text.slice(7).trim();
		if (argumentText.split(/\s+/).length > 1) {
			this.ctx.showError(t("controller.memory.usage"));
			return;
		}
		const action = argumentText.split(/\s+/, 1)[0]?.toLowerCase() || "view";
		const agentDir = this.ctx.settings.getAgentDir();

		if (action === "view") {
			const cwd = this.ctx.sessionManager.getCwd();
			const file = path.join(getMemoryRoot(agentDir, cwd), "memory_summary.md");
			let content: string;
			try {
				content = (await Bun.file(file).text()).trim();
				if (!content) content = "The saved memory summary is empty.";
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					content = "No saved memory summary exists for this project.";
				else {
					this.ctx.showError("Memory summary is unavailable. Check file access and retry; no data was changed.");
					return;
				}
			}
			const enabled = this.ctx.settings.get("memories.enabled");
			await this.ctx.showHookCustom<void>(
				(ui, _theme, _keys, done) =>
					new ReportDetailsComponent(
						"Project memory",
						`Memory ${enabled ? "enabled" : "disabled"} · ${cwd}`,
						`${enabled ? "Full saved summary; prompt injection may use a shorter excerpt." : "Memory use is disabled; any saved summary below remains on disk."}\nSource: ${file}\n\n${Bun.stripANSI(content)}`,
						() => done(),
						() => ui.terminal.rows,
					),
			);
			return;
		}

		if (action === "reset" || action === "clear") {
			if (this.#clearingMemory) {
				this.ctx.showStatus("A memory-clear operation is already open.");
				return;
			}
			this.#clearingMemory = true;
			try {
				const manager = this.ctx.sessionManager;
				const session = this.ctx.session;
				const cwd = manager.getCwd();
				const read = async () => {
					const snapshot = await inspectMemoryClear(agentDir, cwd);
					if (snapshot.activeJobs)
						throw new Error(
							"Memory jobs are still marked running. Wait for them to finish before clearing memory.",
						);
					const review: ActionReview = {
						identity: `memory:${agentDir}:${cwd}`,
						scope: "All-project database records · Current-project generated files",
						revision: snapshot.revision,
						changes: [
							{
								field: "Database",
								before: snapshot.database,
								after: "Keep database; remove memory records",
							},
							{
								field: "All-project memory records",
								before: `${snapshot.threads} threads, ${snapshot.outputs} outputs, ${snapshot.jobs} jobs`,
								after: "0",
							},
							{
								field: "Current-project artifacts",
								before: `${snapshot.artifacts} (${snapshot.files} files/links)`,
								after: "Removed",
							},
						],
						consequence:
							"Permanently removes learned memory records across all projects and generated memory files for this project. Other projects' generated files and conversation transcripts remain. Memory may be regenerated by later consolidation. Refreshes this session's memory prompt after deletion.",
					};
					return { target: snapshot, review };
				};
				const initial = await read();
				const outcome = await runReviewedAction(this.ctx, "memory clear", {
					review: initial.review,
					resolve: async () =>
						this.ctx.sessionManager === manager &&
						this.ctx.session === session &&
						manager.getCwd() === cwd &&
						this.ctx.settings.getAgentDir() === agentDir
							? read()
							: undefined,
					execute: async snapshot => {
						if (snapshot.threads || snapshot.outputs || snapshot.jobs || snapshot.files)
							await clearReviewedMemoryData(agentDir, cwd, snapshot);
						try {
							await session.refreshBaseSystemPrompt();
						} catch {
							throw new Error(
								"Memory deletion finished, but refreshing the session prompt failed. Retry to refresh the prompt; deleted data cannot be restored.",
							);
						}
						const remaining = await inspectMemoryClear(agentDir, cwd);
						if (remaining.threads || remaining.outputs || remaining.jobs || remaining.files)
							throw new Error(
								"Memory data remains or was recreated during clearing. Review the remaining data before retrying.",
							);
					},
				});
				if (outcome === "succeeded") this.ctx.showStatus(t("controller.memory.cleared"));
				else if (outcome === "unresolved")
					this.ctx.showError(
						"Memory clearing is unresolved; some data may already be deleted. Run /memory clear again to review remaining data or retry prompt refresh.",
					);
			} catch (error) {
				this.ctx.showError(
					t("controller.memory.clearFailed", {
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			} finally {
				this.#clearingMemory = false;
			}
			return;
		}

		if (action === "enqueue" || action === "rebuild") {
			if (this.#clearingMemory) {
				this.ctx.showStatus("A memory operation is already open.");
				return;
			}
			this.#clearingMemory = true;
			try {
				const manager = this.ctx.sessionManager;
				const cwd = manager.getCwd();
				const read = () => {
					const target = inspectMemoryConsolidation(agentDir, cwd);
					const review: ActionReview = {
						identity: `memory-queue:${agentDir}:${cwd}`,
						scope: `Project ${cwd} · ${target.database}`,
						revision: target.revision,
						changes: [
							{
								field: "Consolidation request",
								before: target.state,
								after: "Request pending consolidation for this project",
							},
						],
						consequence:
							"Persists a consolidation request. It does not rebuild memory immediately or restart an active worker. Later consolidation can use model tokens and update generated memory files. Existing memory and conversation transcripts are not deleted.",
					};
					return { target, review };
				};
				const outcome = await runReviewedAction(this.ctx, "memory consolidation", {
					review: read().review,
					resolve: async () =>
						this.ctx.sessionManager === manager &&
						manager.getCwd() === cwd &&
						this.ctx.settings.getAgentDir() === agentDir
							? read()
							: undefined,
					execute: async target => {
						enqueueReviewedMemoryConsolidation(agentDir, cwd, target);
					},
				});
				if (outcome === "succeeded")
					this.ctx.showStatus(
						"Memory consolidation request saved for this project. Consolidation has not been verified as started or completed.",
					);
				else if (outcome === "unresolved")
					this.ctx.showError("Memory queue update is unresolved. Review the current queue state before retrying.");
			} catch (error) {
				this.ctx.showError(
					t("controller.memory.enqueueFailed", {
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			} finally {
				this.#clearingMemory = false;
			}
			return;
		}

		this.ctx.showError(t("controller.memory.usage"));
	}

	/** Execute the session-switch portion of a larger, already reviewed action. */
	async executeReviewedNewSession(
		originalId: string,
		beforeSwitch: () => Promise<void>,
		preview: ReturnType<InteractiveModeContext["sessionManager"]["previewNewSession"]>,
		options?: NewSessionOptions,
	): Promise<string> {
		if (this.#startingSession) throw new Error("A new-session transition is already open.");
		this.#startingSession = true;
		try {
			const manager = this.ctx.sessionManager;
			const session = this.ctx.session;
			const currentId = manager.getSessionId();
			if (currentId !== originalId) {
				if (!this.#unsavedNewSessions.has(currentId)) {
					throw new Error("The reviewed session target changed before the execution session was ready.");
				}
				await manager.retryPersistence();
				this.#unsavedNewSessions.delete(currentId);
				return currentId;
			}

			await manager.retryPersistence();
			if (session.isCompacting) {
				session.abortCompaction();
				while (session.isCompacting) await Bun.sleep(10);
			}
			if (
				this.ctx.session !== session ||
				this.ctx.sessionManager !== manager ||
				manager.getSessionId() !== originalId
			)
				throw new Error("The reviewed session target changed before the execution session was created.");

			let switched = false;
			let createdId: string | undefined;
			try {
				switched = await session.newSessionWithReviewedPreparation(beforeSwitch, options, preview);
			} finally {
				if (manager.getSessionId() !== originalId) {
					createdId = manager.getSessionId();
					this.#unsavedNewSessions.add(createdId);
				}
			}
			if (!switched)
				throw new Error("New execution session was declined by an extension. The planning session is unchanged.");
			if (createdId !== preview.targetSessionId)
				throw new Error("New execution session did not produce the reviewed identity.");
			await manager.retryPersistence();
			this.#unsavedNewSessions.delete(createdId);
			return createdId;
		} finally {
			this.#startingSession = false;
		}
	}

	async handleClearCommand(
		options?: NewSessionOptions,
		createSession?: (options?: NewSessionOptions) => Promise<boolean>,
	): Promise<void> {
		if (options || createSession) {
			if (this.ctx.session.isCompacting) {
				this.ctx.session.abortCompaction();
				while (this.ctx.session.isCompacting) await Bun.sleep(10);
			}
			if (!(await (createSession ? createSession(options) : this.ctx.session.newSession(options)))) return;
			await this.resetNewSessionView();
			return;
		}
		if (this.#startingSession) {
			this.ctx.showStatus("A new-session review is already open.");
			return;
		}
		this.#startingSession = true;
		try {
			const manager = this.ctx.sessionManager;
			const session = this.ctx.session;
			const originalId = manager.getSessionId();
			if (this.#unsavedNewSessions.has(originalId)) {
				const review = (): ActionReview => ({
					identity: `session:${originalId}`,
					scope: `Recover session persistence · ${manager.getSessionFile() ?? "in-memory session"}`,
					revision: createHash("sha256").update(JSON.stringify(manager.getEntries())).digest("hex"),
					changes: [
						{
							field: "Persistence",
							before: "Unresolved previous session switch",
							after: "Save current session",
						},
					],
					consequence:
						"Retries saving the session already created. Does not create another session or clear current messages.",
				});
				const outcome = await runReviewedAction(this.ctx, "session save recovery", {
					review: review(),
					resolve: async () =>
						this.ctx.sessionManager === manager && manager.getSessionId() === originalId
							? { review: review(), target: manager }
							: undefined,
					execute: async target => {
						await target.retryPersistence();
						this.#unsavedNewSessions.delete(originalId);
					},
				});
				if (outcome === "succeeded")
					this.ctx.showStatus(`Session ${originalId} saved. No additional session was created.`);
				else if (outcome === "unresolved")
					this.ctx.showError("Session persistence remains unresolved. Run /new to retry saving this session.");
				return;
			}
			const preview = manager.previewNewSession();
			const review = (): ActionReview => ({
				identity: `session-new:${originalId}:${preview.targetSessionId}`,
				scope: `New session in ${manager.getCwd()} · ${manager.getSessionDir()}`,
				revision: createHash("sha256")
					.update(
						JSON.stringify([
							preview,
							manager.getEntries(),
							session.isStreaming,
							session.isCompacting,
							session.queuedMessageCount,
							this.ctx.compactionQueuedMessages,
						]),
					)
					.digest("hex"),
				changes: [
					{
						field: "Active conversation",
						before: manager.getSessionName() ?? originalId,
						after: `New empty session ${preview.targetSessionId}`,
					},
					{
						field: "Session file",
						before: preview.sourceSessionFile ?? "In-memory",
						after: preview.targetSessionFile ?? "In-memory",
					},
					{
						field: "Active work",
						before: session.isStreaming || session.isCompacting ? "Running" : "Idle",
						after: "Interrupted; queued prompts cleared",
					},
					{
						field: "Queued prompts",
						before: String((session.queuedMessageCount ?? 0) + this.ctx.compactionQueuedMessages.length),
						after: "0",
					},
				],
				consequence: manager.isPersisted()
					? "Keeps the previous saved conversation for resume. Starts and saves a new session; requests interruption of active jobs and clears queued messages."
					: "This session is not persisted. Its conversation cannot be resumed after switching; requests interruption of active work and clears queued messages.",
			});
			const proposed = review();
			let createdId: string | undefined;
			const outcome = await runReviewedAction(this.ctx, "new session", {
				review: proposed,
				resolve: async () => {
					if (
						this.ctx.session !== session ||
						this.ctx.sessionManager !== manager ||
						manager.getSessionId() !== (createdId ?? originalId)
					)
						return undefined;
					return { review: proposed, target: session };
				},
				execute: async target => {
					if (!createdId) {
						// Fail before resetting the live agent if old-session persistence is unhealthy.
						await manager.retryPersistence();
						if (target.isCompacting) {
							target.abortCompaction();
							while (target.isCompacting) await Bun.sleep(10);
						}
						let switched = false;
						try {
							switched = await target.newSession(undefined, preview);
						} finally {
							if (manager.getSessionId() !== originalId) {
								createdId = manager.getSessionId();
								this.#unsavedNewSessions.add(createdId);
							}
						}
						if (!switched)
							throw new Error(
								"New session was declined by an extension or could not be created. Existing view retained.",
							);
						if (createdId !== preview.targetSessionId)
							throw new Error("New session did not produce the reviewed identity.");
					}
					await manager.retryPersistence();
					if (
						manager.getSessionId() !== preview.targetSessionId ||
						manager.getSessionFile() !== preview.targetSessionFile
					)
						throw new Error("The active session does not match the reviewed destination.");
					this.#unsavedNewSessions.delete(createdId!);
				},
			});
			if (outcome === "succeeded") await this.resetNewSessionView();
			else if (outcome === "unresolved") {
				if (createdId) {
					this.ctx.rebuildChatFromMessages();
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
				}
				this.ctx.showError(
					createdId
						? `Session ${createdId} is active, but saving is unresolved. Run /new to retry saving it without creating another session.`
						: "Session switch is unresolved. Existing view retained; no completion is claimed.",
				);
			}
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#startingSession = false;
		}
	}
	#startingSession = false;
	#unsavedNewSessions = new Set<string>();

	async resetNewSessionView(): Promise<void> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();
		this.ctx.resetObserverRegistry();
		setSessionTerminalTitle(
			this.ctx.sessionManager.getSessionName(),
			this.ctx.sessionManager.getCwd(),
			this.ctx.sessionManager.titleSource,
		);

		this.ctx.statusLine.invalidate();
		this.ctx.statusLine.setSessionStartTime(Date.now());
		this.ctx.updateEditorTopBorder();
		this.ctx.updateEditorBorderColor();
		this.ctx.ui.requestRender();

		this.ctx.chatContainer.clear();
		this.ctx.pendingMessagesContainer.clear();
		this.ctx.compactionQueuedMessages = [];
		this.ctx.streamingComponent = undefined;
		this.ctx.streamingMessage = undefined;
		this.ctx.pendingTools.clear();

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(
			new Text(`${theme.fg("contentAccent", `${theme.status.success} ${t("controller.newSession")}`)}`, 1, 1),
		);
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender();
	}

	async handleForkCommand(): Promise<void> {
		if (this.#forkingSession) {
			this.ctx.showStatus("A session fork review is already open.");
			return;
		}
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(t("controller.fork.streaming"));
			return;
		}
		this.#forkingSession = true;
		try {
			const manager = this.ctx.sessionManager;
			if (this.#pendingFork && this.#pendingFork.manager !== manager)
				throw new Error("A previous fork remains unresolved in another session. Return to it before retrying.");
			const preview = this.#pendingFork?.preview ?? manager.previewFork();
			if (!preview) throw new Error("This in-memory session cannot be forked because it has no saved file.");
			const statToken = async (targetPath: string) => {
				try {
					const stat = await fs.stat(targetPath);
					return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.isDirectory()] as const;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
					throw error;
				}
			};
			const read = async () => {
				const recovery =
					manager.getSessionId() === preview.targetSessionId &&
					manager.getSessionFile() === preview.targetSessionFile;
				const source = await statToken(preview.sourceSessionFile);
				const sourceArtifacts = await statToken(preview.sourceArtifactDir);
				const target = await statToken(preview.targetSessionFile);
				const targetArtifacts = await statToken(preview.targetArtifactDir);
				const validSource =
					manager.getSessionId() === preview.sourceSessionId &&
					manager.getSessionFile() === preview.sourceSessionFile;
				if (!validSource && !recovery) return undefined;
				return {
					target: { preview, recovery },
					review: {
						identity: `session:${preview.sourceSessionId}->${preview.targetSessionId}`,
						scope: `Session fork · ${manager.getCwd()}`,
						revision: createHash("sha256")
							.update(
								JSON.stringify([
									manager.getEntries(),
									preview,
									source,
									sourceArtifacts,
									target,
									targetArtifacts,
									recovery,
								]),
							)
							.digest("hex"),
						changes: [
							{
								field: "Session identity",
								before: preview.sourceSessionId,
								after: recovery ? `${preview.targetSessionId} (already created)` : preview.targetSessionId,
							},
							{
								field: "Session file",
								before: preview.sourceSessionFile,
								after: preview.targetSessionFile,
							},
							{
								field: "Artifacts",
								before: sourceArtifacts ? preview.sourceArtifactDir : "None present",
								after: sourceArtifacts ? preview.targetArtifactDir : "None to copy",
							},
						],
						consequence: recovery
							? "Retries only unresolved saving, artifact copying, and switch notification for the already-created fork. It does not create another session."
							: "Creates an exact saved conversation copy with a new stable identity and parent link, switches to it, and copies artifacts. The source session remains unchanged; existing destinations are never overwritten.",
					} satisfies ActionReview,
				};
			};
			const proposed = await read();
			if (!proposed) throw new Error("The session changed before its fork could be reviewed.");
			const outcome = await runReviewedAction(
				this.ctx,
				proposed.target.recovery ? "session fork recovery" : "session fork",
				{
					review: proposed.review,
					resolve: read,
					execute: async target => {
						if (!target.recovery) {
							this.#pendingFork = { manager, preview: target.preview };
							const success = await this.ctx.session.fork(target.preview);
							if (!success) {
								this.#pendingFork = undefined;
								throw new Error("Fork was declined by an extension; the source session is unchanged.");
							}
						} else {
							await this.ctx.session.completeReviewedFork(target.preview, true);
						}
						await manager.retryPersistence();
						if (
							manager.getSessionId() !== target.preview.targetSessionId ||
							manager.getSessionFile() !== target.preview.targetSessionFile
						)
							throw new Error("Forked session identity changed before completion.");
						this.#pendingFork = undefined;
					},
				},
			);
			if (outcome === "succeeded") {
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
				}
				this.ctx.statusContainer.clear();
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorTopBorder();
				const shortPath = preview.targetSessionFile.split("/").pop()!;
				this.ctx.chatContainer.addChild(new Spacer(1));
				this.ctx.chatContainer.addChild(
					new Text(
						`${theme.fg("contentAccent", `${theme.status.success} ${t("controller.fork.success", { path: shortPath })}`)}`,
						1,
						1,
					),
				);
				this.ctx.ui.requestRender();
			} else if (outcome === "unresolved") {
				this.ctx.showError(
					`Fork ${preview.targetSessionId} is unresolved. Run /fork again to retry only its incomplete save, artifacts, or notification.`,
				);
			}
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#forkingSession = false;
		}
	}

	async handleMoveCommand(targetPath: string): Promise<void> {
		if (this.#movingSession) {
			this.ctx.showStatus("A session move is already open.");
			return;
		}
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(t("controller.move.streaming"));
			return;
		}
		this.#movingSession = true;
		try {
			const manager = this.ctx.sessionManager;
			const identity = manager.getSessionId();
			const cwd = manager.getCwd();
			const entered =
				targetPath.trim() ||
				(await this.ctx.showHookCustom<string | undefined>(
					(_ui, _theme, _keys, done) =>
						new SettingsTextEditor(
							"Move session",
							"Choose an existing working directory.",
							cwd,
							value => {
								if (!value.trim()) throw new Error("Destination is required.");
								done(value);
							},
							() => done(undefined),
							{ purpose: "Edit destination · Review before moving" },
						),
				));
			if (entered === undefined) return;
			const destination = resolveToCwd(stripOuterDoubleQuotes(entered), cwd);
			let moved = this.#pendingMoves.get(identity) === destination && manager.getCwd() === destination;
			if (destination === cwd && !moved) {
				this.ctx.showStatus("Session already uses this directory; nothing changed.");
				return;
			}
			const expected = manager.previewMoveTo(destination);
			const readReview = async (): Promise<ActionReview> => {
				const stat = await fs.stat(destination);
				if (!stat.isDirectory()) throw new Error("Move destination is not a directory.");
				if (!moved)
					for (const target of [expected.sessionFile, expected.artifactDir]) {
						if (!target) continue;
						try {
							await fs.lstat(target);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
							throw error;
						}
						throw new Error(`Move destination exists; no overwrite is allowed: ${target}`);
					}
				return {
					identity: `session:${identity}`,
					scope: "Current session · Working directory and saved files",
					revision: createHash("sha256")
						.update(JSON.stringify([manager.getEntries(), stat.dev, stat.ino, expected, moved]))
						.digest("hex"),
					changes: [
						{ field: "Working directory", before: cwd, after: destination },
						{
							field: "Session file",
							before: manager.getSessionFile() ?? "In-memory only",
							after: expected.sessionFile ?? "In-memory only",
						},
						{
							field: "Artifacts",
							before: "Current session artifacts, if present",
							after: expected.artifactDir ?? "None persisted",
						},
					],
					consequence: moved
						? "Completes saving and refreshing the already-moved session; does not move it again."
						: "Moves the session and its artifacts, preserves session identity and conversation, and reloads project command discovery. Existing destination files will not be overwritten.",
				};
			};
			let proposed = await readReview();
			const outcome = await runReviewedAction(this.ctx, moved ? "session move recovery" : "session move", {
				review: proposed,
				resolve: async () => {
					if (
						this.ctx.sessionManager !== manager ||
						manager.getSessionId() !== identity ||
						this.ctx.session.isStreaming ||
						manager.getCwd() !== (moved ? destination : cwd)
					)
						return undefined;
					if (!moved) proposed = await readReview();
					return { review: proposed, target: manager };
				},
				execute: async target => {
					if (!moved) {
						await target.retryPersistence();
						if (JSON.stringify(await readReview()) !== JSON.stringify(proposed))
							throw new Error("Move target changed while preparing. Retry for a renewed review.");
						try {
							await target.moveToReviewed(destination, expected);
						} finally {
							if (target.getCwd() === destination) {
								moved = true;
								this.#pendingMoves.set(identity, destination);
							}
						}
					}
					await target.retryPersistence();
					setProjectDir(destination);
					setShellPwd(destination);
					this.ctx.statusLine.setCwd(destination);
					this.ctx.updateEditorTopBorder();
					clearXcshPluginRootsCache();
					resetCapabilities();
					try {
						await this.ctx.refreshSlashCommandState(destination);
					} catch (error) {
						throw new Error(
							`Session files moved; project refresh failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					if (target.getCwd() !== destination) throw new Error("Session directory changed during the move.");
					this.#pendingMoves.delete(identity);
				},
			});
			if (outcome === "succeeded") {
				this.ctx.showStatus(`Session moved to ${destination}.`);
				this.ctx.ui.requestRender();
			} else if (outcome === "unresolved")
				this.ctx.showError(
					moved
						? `Session is now at ${destination}, but saving or project refresh is unresolved. Run /move with the same destination to retry.`
						: "Session move was not completed. Inspect the retained error before retrying.",
				);
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#movingSession = false;
		}
	}
	#movingSession = false;
	#pendingMoves = new Map<string, string>();

	async handleRenameCommand(title: string): Promise<void> {
		if (this.#renaming) {
			this.ctx.showStatus("A session rename is already open.");
			return;
		}
		this.#renaming = true;
		try {
			const manager = this.ctx.sessionManager;
			const sessionId = manager.getSessionId();
			const normalize = (value: string) =>
				value
					.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
					.replace(/ +/g, " ")
					.trim();
			const entered =
				title.trim() ||
				(await this.ctx.showHookCustom<string | undefined>(
					(_ui, _theme, _keys, done) =>
						new SettingsTextEditor(
							"Rename session",
							`Session ${sessionId} · Current name is prefilled.`,
							manager.getSessionName() ?? "",
							value => {
								if (!normalize(value)) throw new Error("Session name cannot be empty.");
								done(value);
							},
							() => done(undefined),
							{ purpose: "Edit name · Review before saving" },
						),
				));
			if (entered === undefined) return;
			const name = normalize(entered);
			if (!name) throw new Error("Session name cannot be empty.");
			if (manager !== this.ctx.sessionManager || manager.getSessionId() !== sessionId)
				throw new Error("Session changed. Run /rename again.");
			if (manager.getSessionName() === name && this.#unresolvedRenames.get(sessionId) !== name) {
				this.ctx.showStatus("Session name is unchanged; nothing saved.");
				return;
			}
			const review = (): ActionReview => ({
				identity: `session:${sessionId}`,
				scope: `Current ${manager.isPersisted() ? "saved" : "in-memory"} session · ${manager.getCwd()}`,
				revision: JSON.stringify([manager.getSessionName(), manager.titleSource]),
				changes: [
					{
						field: "Name",
						before: manager.getSessionName() ?? "Unnamed",
						after: name,
					},
				],
				consequence: `${manager.isPersisted() ? "Saves the display name in session history." : "This session is not persisted; the name lasts only for this session."} Future automatic titles will not replace this user-set name. Conversation content and session identity remain unchanged.`,
			});
			const outcome = await runReviewedAction(this.ctx, "session rename", {
				review: review(),
				resolve: async () =>
					manager === this.ctx.sessionManager && manager.getSessionId() === sessionId
						? { review: review(), target: manager }
						: undefined,
				execute: async target => {
					this.#unresolvedRenames.set(sessionId, name);
					if (target.getSessionName() !== name && !(await target.setSessionName(name, "user")))
						throw new Error("Session name was not accepted.");
					await target.retryPersistence();
					if (target.getSessionName() !== name) throw new Error("Session name changed while saving.");
					this.#unresolvedRenames.delete(sessionId);
				},
			});
			if (outcome === "unresolved")
				this.ctx.showError(
					"Rename persistence is unresolved. The name may have changed; retry saving before leaving this session.",
				);
			if (outcome !== "succeeded") return;
			setSessionTerminalTitle(name, manager.getCwd(), manager.titleSource);
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
			this.ctx.showStatus(t("controller.rename.success", { name }));
		} catch (err) {
			this.ctx.showError(
				t("controller.rename.failed", {
					message: err instanceof Error ? err.message : String(err),
				}),
			);
		} finally {
			this.#renaming = false;
		}
	}
	#renaming = false;
	#unresolvedRenames = new Map<string, string>();

	async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.bashComponent = new BashExecutionComponent(command, this.ctx.ui, excludeFromContext);
		let bashGutter: ReturnType<typeof createToolGutter> | undefined;

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
			this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
		} else {
			bashGutter = createToolGutter(this.ctx.ui, this.ctx.bashComponent);
			this.ctx.chatContainer.addChild(bashGutter);
		}
		this.ctx.ui.requestRender();

		let failed = false;
		try {
			const result = await this.ctx.session.executeBash(
				command,
				chunk => {
					if (this.ctx.bashComponent) {
						this.ctx.bashComponent.appendOutput(chunk);
					}
				},
				{ excludeFromContext },
			);

			// Update CWD if the shell changed directory (e.g. via cd)
			if (result.newCwd && result.newCwd !== this.ctx.sessionManager.getCwd()) {
				setShellPwd(result.newCwd);
				this.ctx.statusLine.setCwd(result.newCwd);
				this.ctx.ui.requestRender();
			}

			if (this.ctx.bashComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.bashComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
			}
			failed = result.cancelled || (typeof result.exitCode === "number" && result.exitCode !== 0);
		} catch (error) {
			failed = true;
			if (this.ctx.bashComponent) {
				this.ctx.bashComponent.setError(error instanceof Error ? error : String(error));
			}
			this.ctx.showError(
				t("controller.bash.failed", {
					message: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		}

		bashGutter?.setDone(failed ? "error" : "success");
		this.ctx.bashComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handlePythonCommand(code: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.pythonComponent = new PythonExecutionComponent(code, this.ctx.ui, excludeFromContext);
		let pythonGutter: ReturnType<typeof createToolGutter> | undefined;

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.pythonComponent);
			this.ctx.pendingPythonComponents.push(this.ctx.pythonComponent);
		} else {
			pythonGutter = createToolGutter(this.ctx.ui, this.ctx.pythonComponent);
			this.ctx.chatContainer.addChild(pythonGutter);
		}
		this.ctx.ui.requestRender();

		let failed = false;
		try {
			const result = await this.ctx.session.executePython(
				code,
				chunk => {
					if (this.ctx.pythonComponent) {
						this.ctx.pythonComponent.appendOutput(chunk);
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.pythonComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.pythonComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
			}
			failed = result.cancelled || (typeof result.exitCode === "number" && result.exitCode !== 0);
		} catch (error) {
			failed = true;
			if (this.ctx.pythonComponent) {
				this.ctx.pythonComponent.setError(error instanceof Error ? error : String(error));
			}
			this.ctx.showError(`Python execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		pythonGutter?.setDone(failed ? "error" : "success");
		this.ctx.pythonComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handleCompactCommand(customInstructions?: string): Promise<void> {
		const manager = this.ctx.sessionManager;
		const session = this.ctx.session;
		const sessionId = manager.getSessionId();
		const instructions = customInstructions?.trim() || undefined;
		const read = (): {
			target: ManualCompactionTarget;
			review: ActionReview;
		} => {
			if (
				this.#pendingManualCompaction?.manager === manager &&
				this.#pendingManualCompaction.session === session &&
				this.#pendingManualCompaction.leafId === manager.getLeafId()
			) {
				return {
					target: { kind: "persist" as const, manager, session },
					review: {
						identity: `session-compaction:${sessionId}`,
						scope: `Current session ${sessionId}`,
						revision: `persist:${manager.getLeafId() ?? "empty"}`,
						changes: [
							{
								field: "Compaction summary",
								before: "Applied in memory; backing save unresolved",
								after: "Persist the existing summary without another model call",
							},
						],
						consequence:
							"Retries only the unresolved session-file save. It does not compact again or spend additional model tokens.",
					} satisfies ActionReview,
				};
			}
			const entries = manager.getEntries();
			const messageCount = entries.filter(entry => entry.type === "message").length;
			const leafId = manager.getLeafId();
			const alreadyCompacted = entries.find(entry => entry.id === leafId)?.type === "compaction";
			const model = session.model ? `${session.model.provider}/${session.model.id}` : "No model selected";
			const activeWork = session.isStreaming ? "Active response will be interrupted after confirmation" : "Idle";
			const revision = createHash("sha256")
				.update(
					JSON.stringify({
						sessionId,
						leafId,
						entries: entries.map(entry => [entry.id, entry.parentId, entry.type]),
						model,
						activeWork,
						instructions,
					}),
				)
				.digest("hex");
			return {
				target: {
					kind: "compact" as const,
					manager,
					session,
					leafId,
					messageCount,
					alreadyCompacted,
					instructions,
				},
				review: {
					identity: `session-compaction:${sessionId}`,
					scope: `Current session ${sessionId}`,
					revision,
					changes: [
						{
							field: "Conversation context",
							before: `${messageCount} messages`,
							after: "Compacted summary",
						},
						{
							field: "Model",
							before: model,
							after: `Use ${model} for the summary`,
						},
						{
							field: "Active work",
							before: activeWork,
							after: "Compaction begins after confirmation",
						},
						{
							field: "Instructions",
							before: "Current compaction defaults",
							after: instructions ? Bun.stripANSI(instructions) : "Use current compaction defaults",
						},
					],
					consequence:
						"Uses the selected model and may spend tokens. Appends a summary to this session, replaces the effective context, and preserves the transcript history. Ctrl+C requests interruption; Escape remains navigation-only.",
				} satisfies ActionReview,
			};
		};
		const initial = read();
		if (initial.target.kind === "compact" && initial.target.messageCount < 2) {
			this.ctx.showWarning("Nothing to compact (fewer than two messages)");
			return;
		}
		if (initial.target.kind === "compact" && initial.target.alreadyCompacted) {
			this.ctx.showWarning("Session is already compacted; nothing changed.");
			return;
		}
		const outcome = await runReviewedAction<ManualCompactionTarget>(this.ctx, "session compaction", {
			review: initial.review,
			resolve: async () =>
				this.ctx.sessionManager === manager && this.ctx.session === session && manager.getSessionId() === sessionId
					? read()
					: undefined,
			execute: async (target, signal) => {
				if (target.kind === "persist") {
					await manager.retryPersistence();
					this.#pendingManualCompaction = undefined;
					return;
				}
				const interrupt = () => session.abortCompaction();
				signal.addEventListener("abort", interrupt, { once: true });
				if (signal.aborted) interrupt();
				try {
					await this.executeCompaction(target.instructions, false, true);
				} catch (error) {
					if (signal.aborted && !session.isCompacting)
						throw new ActionInterruptedError("Compaction stopped before a summary was saved.");
					throw error;
				} finally {
					signal.removeEventListener("abort", interrupt);
				}
				this.#pendingManualCompaction = {
					manager,
					session,
					leafId: manager.getLeafId(),
					instructions: target.instructions,
				};
				await manager.retryPersistence();
				this.#pendingManualCompaction = undefined;
			},
			cancellable: true,
		});
		if (outcome === "succeeded") this.ctx.showStatus("Session context compacted and saved.");
		else if (outcome === "interrupted") this.ctx.showWarning("Compaction interrupted; no summary was saved.");
		else if (outcome === "unresolved")
			this.ctx.showError(
				"Compaction is unresolved. Retry to save an already-applied summary without repeating the model call, or review the current session state.",
			);
		else if (outcome === "busy") this.ctx.showWarning("Another reviewed action is already open.");
	}

	async handleSkillCommand(skillPath: string, args: string): Promise<void> {
		try {
			const content = await Bun.file(skillPath).text();
			const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
			const metaLines = [`Skill: ${skillPath}`];
			if (args) {
				metaLines.push(`User: ${args}`);
			}
			const message = `${body}\n\n---\n\n${metaLines.join("\n")}`;
			await this.ctx.session.prompt(message);
		} catch (err) {
			this.ctx.showError(`Failed to load skill: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async executeCompaction(
		customInstructionsOrOptions?: string | CompactOptions,
		isAuto = false,
		throwOnFailure = false,
	): Promise<void> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		const originalOnEscape = this.ctx.editor.onEscape;
		this.ctx.editor.onEscape = () => {
			this.ctx.session.abortCompaction();
		};

		this.ctx.chatContainer.addChild(new Spacer(1));
		const label = isAuto
			? `Auto-compacting context... (${appInterruptHint()})`
			: `Compacting context... (${appInterruptHint()})`;
		const compactingLoader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("spinnerAccent", spinner),
			text => theme.fg("muted", text),
			label,
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(compactingLoader);
		this.ctx.ui.requestRender();

		let failure: unknown;
		try {
			const instructions = typeof customInstructionsOrOptions === "string" ? customInstructionsOrOptions : undefined;
			const options =
				customInstructionsOrOptions && typeof customInstructionsOrOptions === "object"
					? customInstructionsOrOptions
					: undefined;
			await this.ctx.session.compact(instructions, options);

			this.ctx.rebuildChatFromMessages();

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
		} catch (error) {
			failure = error;
			const message = error instanceof Error ? error.message : String(error);
			if (!throwOnFailure) {
				if (message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError")) {
					this.ctx.showError("Compaction cancelled");
				} else {
					this.ctx.showError(`Compaction failed: ${message}`);
				}
			}
		} finally {
			compactingLoader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.editor.onEscape = originalOnEscape;
		}
		await this.ctx.flushCompactionQueue({ willRetry: false });
		if (throwOnFailure && failure !== undefined) throw failure;
	}

	async handleHandoffCommand(customInstructions?: string): Promise<void> {
		if (this.#handingOff) {
			this.ctx.showStatus("A handoff review or operation is already active.");
			return;
		}
		const manager = this.ctx.sessionManager;
		const session = this.ctx.session;
		const pendingPreview = session.getPendingReviewedHandoffPreview();
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (!pendingPreview && messageCount < 2) {
			this.ctx.showWarning("Nothing to hand off (no messages yet)");
			return;
		}

		this.#handingOff = true;
		try {
			const preview = pendingPreview ?? manager.previewNewSession();
			const sourceId = preview.sourceSessionId;
			const sourceFile = preview.sourceSessionFile;
			const sourceLeaf = manager.getLeafId();
			const instructionText = customInstructions?.trim() || "Default comprehensive handoff";
			const read = () => {
				const recovery = session.hasPendingReviewedHandoff(preview);
				const atSource = manager.getSessionId() === sourceId && manager.getSessionFile() === sourceFile;
				const atTarget =
					manager.getSessionId() === preview.targetSessionId &&
					manager.getSessionFile() === preview.targetSessionFile;
				if (this.ctx.session !== session || this.ctx.sessionManager !== manager || (!atSource && !atTarget))
					return undefined;
				if (!recovery && (!atSource || manager.getLeafId() !== sourceLeaf)) return undefined;
				if (!recovery) manager.validateNewSessionPreview(preview);
				const jobs = session.getAsyncJobSnapshot()?.running.length ?? 0;
				const review: ActionReview = {
					identity: `session-handoff:${sourceId}:${preview.targetSessionId}`,
					scope: `Conversation handoff · ${sourceFile ?? "in-memory session"}`,
					revision: createHash("sha256")
						.update(
							JSON.stringify([
								preview,
								manager.getEntries(),
								session.model?.provider,
								session.model?.id,
								instructionText,
								recovery,
							]),
						)
						.digest("hex"),
					changes: [
						{ field: "Source session", before: sourceId, after: "Preserved for resume" },
						{ field: "Active session", before: sourceId, after: preview.targetSessionId },
						{
							field: "Session file",
							before: sourceFile ?? "In-memory",
							after: preview.targetSessionFile ?? "In-memory",
						},
						{
							field: "Handoff generation",
							before: recovery ? "Document already generated" : "Not started",
							after: `Context generated with ${session.model?.provider ?? "current provider"}/${session.model?.id ?? "current model"}`,
						},
						{ field: "Instructions", before: "None", after: instructionText },
						{ field: "Running background jobs", before: String(jobs), after: "Cancellation requested" },
					],
					consequence: recovery
						? "Retries only the unresolved local save, context injection, and state restoration for the already-generated handoff. It does not generate or bill another handoff."
						: "Generates a handoff with the active model, which can consume tokens and incur cost, then starts the exact new session, injects that context, saves it, and requests cancellation of active background jobs. Ctrl+C requests interruption only while generation supports it.",
				};
				return { target: { recovery }, review };
			};
			const initial = read();
			if (!initial) throw new Error("The handoff source changed before review.");
			let result: Awaited<ReturnType<typeof session.handoff>>;
			let attempted = false;
			const outcome = await runReviewedAction(this.ctx, "session handoff", {
				review: initial.review,
				resolve: async () => read(),
				cancellable: true,
				execute: async (_target, signal) => {
					attempted = true;
					try {
						result = await session.handoff(customInstructions, { signal, newSessionPreview: preview });
						if (!result) throw new Error("Handoff generation completed without a document.");
					} catch (error) {
						if (
							signal.aborted &&
							error instanceof Error &&
							(error.name === "AbortError" || error.message === "Handoff cancelled")
						)
							throw new ActionInterruptedError("Handoff generation stopped before the session transition.");
						throw error;
					}
				},
			});
			if (outcome === "cancelled") return;
			if (outcome === "interrupted") {
				this.ctx.showWarning("Handoff generation was interrupted; the source session remains active.");
				return;
			}
			if (outcome === "unresolved") {
				this.ctx.showError(
					attempted && session.hasPendingReviewedHandoff(preview)
						? "Handoff document is generated, but the session transition remains unresolved. Run /handoff again to resume the same local transition."
						: "Handoff remains unresolved. Review the current source before retrying.",
				);
				return;
			}
			if (!result) throw new Error("Handoff completed without a verified result.");

			// Rebuild chat from the new session (which now contains the handoff document)
			this.ctx.rebuildChatFromMessages();

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
			this.ctx.updateEditorBorderColor();
			await this.ctx.reloadTodos();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(
				new Text(
					`${theme.fg("contentAccent", `${theme.status.success} New session started with handoff context`)}`,
					1,
					1,
				),
			);
			if (result.savedPath) {
				this.ctx.showStatus(`Handoff document saved to: ${result.savedPath}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Handoff cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.ctx.showError("Handoff cancelled");
			} else {
				this.ctx.showError(`Handoff failed: ${message}`);
			}
		} finally {
			this.#handingOff = false;
		}
		this.ctx.ui.requestRender();
	}
}

const BAR_WIDTH = 24;
const COLUMN_WIDTH = BAR_WIDTH + 2;

function renderJobLine(job: AsyncJobSnapshotItem, now: number): string {
	const duration = formatDuration(Math.max(0, now - job.startTime));
	const status = formatJobStatus(job.status);
	return `${theme.fg("dim", job.id)} ${theme.fg("dim", `[${job.type}]`)} ${status} ${theme.fg("dim", `(${duration})`)}`;
}

function formatJobStatus(status: AsyncJobSnapshotItem["status"]): string {
	if (status === "running") return theme.fg("warning", "running");
	if (status === "completed") return theme.fg("success", "completed");
	if (status === "cancelled") return theme.fg("dim", "cancelled");
	return theme.fg("error", "failed");
}

function truncateJobLabel(label: string, maxWidth: number): string {
	if (visibleWidth(label) <= maxWidth) return label;
	if (maxWidth <= 1) return "…";

	let out = "";
	for (const char of label) {
		const next = `${out}${char}`;
		if (visibleWidth(`${next}…`) > maxWidth) break;
		out = next;
	}

	return `${out}…`;
}
function formatProviderName(provider: string): string {
	return provider
		.split(/[-_]/g)
		.map(part => (part ? part[0].toUpperCase() + part.slice(1) : ""))
		.join(" ");
}

function formatNumber(value: number, maxFractionDigits = 1): string {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: maxFractionDigits,
	}).format(value);
}

function formatUsedAccounts(value: number): string {
	return `${value.toFixed(2)} used`;
}

function resolveProviderAuthMode(authStorage: AuthStorage, provider: string): string {
	if (authStorage.hasOAuth(provider)) {
		return "oauth";
	}
	if (authStorage.has(provider)) {
		return "api key";
	}
	if (getEnvApiKey(provider)) {
		return "env api key";
	}
	if (authStorage.hasAuth(provider)) {
		return "runtime/fallback";
	}
	return "unknown";
}

export function renderProviderSection(details: ProviderDetails, uiTheme: Pick<typeof theme, "fg">): string {
	const lines: string[] = [];
	lines.push(`${uiTheme.fg("dim", "Name:")} ${details.provider}`);
	for (const field of details.fields) {
		lines.push(`${uiTheme.fg("dim", `${field.label}:`)} ${field.value}`);
	}
	return `${lines.join("\n")}\n`;
}

function resolveFraction(limit: UsageLimit): number | undefined {
	const amount = limit.amount;
	if (amount.usedFraction !== undefined) return amount.usedFraction;
	if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
		return amount.used / amount.limit;
	}
	if (amount.unit === "percent" && amount.used !== undefined) {
		return amount.used / 100;
	}
	return undefined;
}

function resolveProviderUsageTotal(reports: UsageReport[]): number {
	return reports
		.flatMap(report => report.limits)
		.map(limit => resolveFraction(limit) ?? 0)
		.reduce((sum, value) => sum + value, 0);
}

function formatLimitTitle(limit: UsageLimit): string {
	const tier = limit.scope.tier;
	if (tier && !limit.label.toLowerCase().includes(tier.toLowerCase())) {
		return `${limit.label} (${tier})`;
	}
	return limit.label;
}

function formatWindowSuffix(label: string, windowLabel: string, uiTheme: typeof theme): string {
	const normalizedLabel = label.toLowerCase();
	const normalizedWindow = windowLabel.toLowerCase();
	if (normalizedWindow === "quota window") return "";
	if (normalizedLabel.includes(normalizedWindow)) return "";
	return uiTheme.fg("dim", `(${windowLabel})`);
}

function formatAccountLabel(limit: UsageLimit, report: UsageReport, index: number): string {
	const email = (report.metadata?.email as string | undefined) ?? limit.scope.accountId;
	if (email) return email;
	const accountId = (report.metadata?.accountId as string | undefined) ?? limit.scope.accountId;
	if (accountId) return accountId;
	return `account ${index + 1}`;
}

function formatUnlimitedReportLabel(report: UsageReport, index: number): string {
	const email = report.metadata?.email as string | undefined;
	if (email) return email;
	const accountId = report.metadata?.accountId as string | undefined;
	if (accountId) return accountId;
	return `account ${index + 1}`;
}

function formatResetShort(limit: UsageLimit, nowMs: number): string | undefined {
	if (limit.window?.resetsAt !== undefined) {
		return formatDuration(limit.window.resetsAt - nowMs);
	}
	return undefined;
}

function formatAccountHeader(limit: UsageLimit, report: UsageReport, index: number, nowMs: number): string {
	const label = formatAccountLabel(limit, report, index);
	const reset = formatResetShort(limit, nowMs);
	if (!reset) return label;
	return `${label} (${reset})`;
}

function padColumn(text: string, width: number): string {
	const visible = visibleWidth(text);
	if (visible >= width) return text;
	return `${text}${padding(width - visible)}`;
}

function resolveAggregateStatus(limits: UsageLimit[]): UsageLimit["status"] {
	const hasOk = limits.some(limit => limit.status === "ok");
	const hasWarning = limits.some(limit => limit.status === "warning");
	const hasExhausted = limits.some(limit => limit.status === "exhausted");
	if (!hasOk && !hasWarning && !hasExhausted) return "unknown";
	if (hasOk) {
		return hasWarning || hasExhausted ? "warning" : "ok";
	}
	if (hasWarning) return "warning";
	return "exhausted";
}

function formatAggregateAmount(limits: UsageLimit[]): string {
	const fractions = limits
		.map(limit => resolveFraction(limit))
		.filter((value): value is number => value !== undefined);
	if (fractions.length === limits.length && fractions.length > 0) {
		const sum = fractions.reduce((total, value) => total + value, 0);
		const usedPct = Math.max(sum * 100, 0);
		const remainingPct = Math.max(0, limits.length * 100 - usedPct);
		const avgRemaining = limits.length > 0 ? remainingPct / limits.length : remainingPct;
		return `${formatUsedAccounts(sum)} (${formatNumber(avgRemaining)}% left)`;
	}

	const amounts = limits
		.map(limit => limit.amount)
		.filter(amount => amount.used !== undefined && amount.limit !== undefined && amount.limit > 0);
	if (amounts.length === limits.length && amounts.length > 0) {
		const totalUsed = amounts.reduce((sum, amount) => sum + (amount.used ?? 0), 0);
		const totalLimit = amounts.reduce((sum, amount) => sum + (amount.limit ?? 0), 0);
		const usedPct = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
		const remainingPct = Math.max(0, 100 - usedPct);
		const usedAccounts = totalLimit > 0 ? (usedPct / 100) * limits.length : 0;
		return `${formatUsedAccounts(usedAccounts)} (${formatNumber(remainingPct)}% left)`;
	}

	return `Accounts: ${limits.length}`;
}

function resolveResetRange(limits: UsageLimit[], nowMs: number): string | null {
	const absolute = limits
		.map(limit => limit.window?.resetsAt)
		.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > nowMs);
	if (absolute.length === 0) return null;
	const offsets = absolute.map(value => value - nowMs);
	const minReset = Math.min(...offsets);
	const maxReset = Math.max(...offsets);
	if (maxReset - minReset > 60_000) {
		return `resets in ${formatDuration(minReset)}–${formatDuration(maxReset)}`;
	}
	return `resets in ${formatDuration(minReset)}`;
}

export function resolveStatusIcon(status: UsageLimit["status"], uiTheme: typeof theme): string {
	if (status === "exhausted") return uiTheme.fg("error", uiTheme.status.error);
	if (status === "warning") return uiTheme.fg("warning", uiTheme.status.warning);
	if (status === "ok") return uiTheme.fg("success", uiTheme.status.success);
	return "";
}

function resolveStatusColor(status: UsageLimit["status"]): "success" | "warning" | "error" | "dim" {
	if (status === "exhausted") return "error";
	if (status === "warning") return "warning";
	if (status === "ok") return "success";
	return "dim";
}

function renderUsageBar(limit: UsageLimit, uiTheme: typeof theme): string {
	const fraction = resolveFraction(limit);
	if (fraction === undefined) {
		return uiTheme.fg("dim", `[${"·".repeat(BAR_WIDTH)}]`);
	}
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const filled = Math.round(clamped * BAR_WIDTH);
	const filledBar = "█".repeat(filled);
	const emptyBar = "░".repeat(Math.max(0, BAR_WIDTH - filled));
	const color = resolveStatusColor(limit.status);
	return `${uiTheme.fg("dim", "[")}${uiTheme.fg(color, filledBar)}${uiTheme.fg("dim", emptyBar)}${uiTheme.fg("dim", "]")}`;
}

function renderUsageReports(reports: UsageReport[], uiTheme: typeof theme, nowMs: number, maxWidth = Infinity): string {
	const lines: string[] = [];
	const grouped = new Map<string, UsageReport[]>();
	for (const report of reports) {
		const list = grouped.get(report.provider) ?? [];
		list.push(report);
		grouped.set(report.provider, list);
	}
	const providerEntries = Array.from(grouped.entries())
		.map(([provider, providerReports]) => ({
			provider,
			providerReports,
			totalUsage: resolveProviderUsageTotal(providerReports),
		}))
		.sort((a, b) => {
			if (a.totalUsage !== b.totalUsage) return a.totalUsage - b.totalUsage;
			return a.provider.localeCompare(b.provider);
		});

	for (const { provider, providerReports } of providerEntries) {
		lines.push("");
		const providerName = formatProviderName(provider);

		const limitGroups = new Map<
			string,
			{
				label: string;
				windowLabel: string;
				limits: UsageLimit[];
				reports: UsageReport[];
			}
		>();
		for (const report of providerReports) {
			for (const limit of report.limits) {
				const windowId = limit.window?.id ?? limit.scope.windowId ?? "default";
				const key = `${formatLimitTitle(limit)}|${windowId}`;
				const windowLabel = limit.window?.label ?? windowId;
				const entry = limitGroups.get(key) ?? {
					label: formatLimitTitle(limit),
					windowLabel,
					limits: [],
					reports: [],
				};
				entry.limits.push(limit);
				entry.reports.push(report);
				limitGroups.set(key, entry);
			}
		}

		lines.push(uiTheme.bold(uiTheme.fg("contentAccent", providerName)));

		for (const group of limitGroups.values()) {
			const entries = group.limits.map((limit, index) => ({
				limit,
				report: group.reports[index],
				fraction: resolveFraction(limit),
				index,
			}));
			entries.sort((a, b) => {
				const aFraction = a.fraction ?? -1;
				const bFraction = b.fraction ?? -1;
				if (aFraction !== bFraction) return bFraction - aFraction;
				return a.index - b.index;
			});
			const sortedLimits = entries.map(entry => entry.limit);
			const sortedReports = entries.map(entry => entry.report);

			const status = resolveAggregateStatus(sortedLimits);
			const statusIcon = resolveStatusIcon(status, uiTheme);

			const windowSuffix = formatWindowSuffix(group.label, group.windowLabel, uiTheme);
			lines.push(
				`${statusIcon} ${uiTheme.bold(group.label)} ${windowSuffix} · ${formatAggregateAmount(sortedLimits)}`.trim(),
			);
			const accountHeaders = sortedLimits.map((limit, index) =>
				formatAccountHeader(limit, sortedReports[index], index, nowMs),
			);
			const longestHeader = Math.max(COLUMN_WIDTH, ...accountHeaders.map(header => visibleWidth(header)));
			const columnWidth = Number.isFinite(maxWidth)
				? Math.max(COLUMN_WIDTH, Math.min(longestHeader, maxWidth - 2))
				: longestHeader;
			const columnsPerRow = Number.isFinite(maxWidth)
				? Math.max(1, Math.floor(Math.max(columnWidth, maxWidth - 2) / (columnWidth + 1)))
				: sortedLimits.length;
			for (let start = 0; start < sortedLimits.length; start += columnsPerRow) {
				const rowLimits = sortedLimits.slice(start, start + columnsPerRow);
				const accountLabels = accountHeaders
					.slice(start, start + columnsPerRow)
					.map(header => padColumn(header, columnWidth));
				lines.push(`  ${accountLabels.join(" ")}`.trimEnd());
				const bars = rowLimits.map(limit => padColumn(renderUsageBar(limit, uiTheme), columnWidth));
				lines.push(`  ${bars.join(" ")}`.trimEnd());
			}
			const resetText = sortedLimits.length <= 1 ? resolveResetRange(sortedLimits, nowMs) : null;
			if (resetText) {
				lines.push(`  ${uiTheme.fg("dim", resetText)}`.trimEnd());
			}
			const notes = sortedLimits.flatMap(limit => limit.notes ?? []);
			if (notes.length > 0) {
				lines.push(`  ${uiTheme.fg("dim", notes.join(" • "))}`.trimEnd());
			}
		}

		// Render accounts with no rate limits (e.g. business/enterprise plans).
		const unlimitedReports = providerReports.filter(report => report.limits.length === 0);
		for (const report of unlimitedReports) {
			const label = formatUnlimitedReportLabel(report, 0);
			const tier = report.metadata?.planType as string | undefined;
			const tierSuffix = tier ? ` ${uiTheme.fg("dim", `(${tier})`)}` : "";
			lines.push(
				`${uiTheme.fg("success", uiTheme.status.success)} ${label}${tierSuffix} ${uiTheme.fg("dim", "-- no limits")}`,
			);
		}
		// No per-provider footer; global header shows last check.
	}

	return lines.join("\n");
}

import { appInterruptHint } from "../utils/keybinding-matchers";
