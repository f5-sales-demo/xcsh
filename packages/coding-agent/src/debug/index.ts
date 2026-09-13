/**
 * Debug command handler with interactive menu.
 *
 * Provides tools for debugging, bug report generation, and system diagnostics.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkProfile } from "@f5-sales-demo/pi-natives";
import { Container, getKeybindings, Loader, type OverlayHandle } from "@f5-sales-demo/pi-tui";
import { getReportsDir, getSessionsDir, Snowflake } from "@f5-sales-demo/pi-utils";
import { formatKeyHints } from "../config/keybindings";
import type { ContextProfile } from "../context/profile";
import { HookSelectorComponent } from "../modes/components/hook-selector";
import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import {
	matchesSelectorKey,
	ReportDetailsComponent,
	selectorFrame,
	selectorFrameContentWidth,
	selectorRow,
} from "../modes/components/selector-frame";
import { getSymbolTheme, theme } from "../modes/theme/theme";
import type { InteractiveModeContext } from "../modes/types";
import { reviewClipboardAction } from "../modes/utils/clipboard-action";
import { matchesAppInterrupt } from "../modes/utils/keybinding-matchers";
import { reviewLocalPathAction } from "../modes/utils/open-action";
import { formatBytes } from "../tools/render-utils";
import { fileHyperlink } from "../tui/hyperlink";
import { type OpenPathResult, openPathWithResult } from "../utils/open";
import { DebugLogViewerComponent } from "./log-viewer";
import { generateHeapSnapshotData, type ProfilerSession, startCpuProfile } from "./profiler";
import {
	clearArtifactCacheTargets,
	createDebugLogSource,
	createReportBundle,
	getArtifactCacheTargets,
	type ReportBundleOptions,
	type ReportBundleResult,
} from "./report-bundle";
import { collectSystemInfo, formatSystemInfo } from "./system-info";

/** Debug menu options */
const DEBUG_MENU_ITEMS = [
	{ value: "open-artifacts", label: "Open: artifact folder", description: "Open session artifacts in file manager" },
	{ value: "performance", label: "Report: performance issue", description: "Profile CPU, reproduce, then bundle" },
	{ value: "work", label: "Profile: work scheduling", description: "Open flamegraph of last 30s" },
	{ value: "dump", label: "Report: dump session", description: "Create report bundle immediately" },
	{ value: "memory", label: "Report: memory issue", description: "Heap snapshot + bundle" },
	{ value: "logs", label: "View: recent logs", description: "Show last 50 log entries" },
	{ value: "system", label: "View: system info", description: "Show environment details" },
	{ value: "context-profile", label: "View: Context Profile", description: "Show privacy-safe context measurements" },
	{
		value: "transcript",
		label: "Export: TUI transcript",
		description: "Write visible TUI conversation to a temp txt",
	},
	{ value: "clear-cache", label: "Clear: artifact cache", description: "Remove old session artifacts" },
] as const;

const formatFileHyperlink = (path: string): string => {
	return fileHyperlink(path, path);
};

export class ProfilerControlComponent extends Container {
	#closed = false;
	constructor(
		private readonly done: (outcome: "review" | "interrupted") => void,
		private readonly rows: () => number,
	) {
		super();
	}
	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		const bindings = getKeybindings();
		const interrupt = bindings.getDefinition("app.interrupt")
			? formatKeyHints(bindings.getKeys("app.interrupt"))
			: "Ctrl+C";
		return selectorFrame(
			width,
			this.rows(),
			"CPU profiling active",
			"Reproduce the performance issue while this foreground profiler collects samples",
			[],
			[selectorRow(["Stop profiling and review report"], [inner - 2], true)],
			["Escape does not stop profiling or discard collected samples."],
			[`${interrupt}: stop without saving`],
			{ selectedBodyIndex: 0 },
		);
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesAppInterrupt(data)) {
			this.#closed = true;
			this.done("interrupted");
		} else if (matchesSelectorKey(data, "confirm")) {
			this.#closed = true;
			this.done("review");
		}
	}
}

/**
 * Debug selector component.
 */
export class DebugSelectorComponent extends HookSelectorComponent {
	private readonly ctx: InteractiveModeContext;
	private readonly openLocalPath: (target: string) => Promise<OpenPathResult>;

	constructor(
		ctx: InteractiveModeContext,
		onDone: () => void,
		dependencies: { openLocalPath?: (target: string) => Promise<OpenPathResult> } = {},
	) {
		const choices = DEBUG_MENU_ITEMS.map(item => `${item.label} — ${item.description}`);
		let dispatch = (_choice: string) => {};
		super("Debug tools and privacy-safe diagnostics", choices, choice => dispatch(choice), onDone, {
			tui: ctx.ui,
			maxVisible: 10,
		});
		this.ctx = ctx;
		this.openLocalPath = dependencies.openLocalPath ?? openPathWithResult;
		dispatch = choice => {
			onDone();
			const index = choices.indexOf(choice);
			if (index >= 0) void this.#handleSelection(DEBUG_MENU_ITEMS[index].value);
		};
	}

	async #handleSelection(value: string): Promise<void> {
		switch (value) {
			case "open-artifacts":
				await this.#handleOpenArtifacts();
				break;
			case "performance":
				await this.#handlePerformanceReport();
				break;
			case "work":
				await this.#handleWorkReport();
				break;
			case "dump":
				await this.#handleDumpReport();
				break;
			case "memory":
				await this.#handleMemoryReport();
				break;
			case "logs":
				await this.#handleViewLogs();
				break;
			case "system":
				await this.#handleViewSystemInfo();
				break;
			case "context-profile":
				await this.#handleContextProfile();
				break;
			case "transcript":
				await this.#handleTranscriptExport();
				break;
			case "clear-cache":
				await this.#handleClearCache();
				break;
		}
	}

	async #handlePerformanceReport(): Promise<void> {
		// Start profiling
		let session: ProfilerSession;
		try {
			session = await startCpuProfile();
		} catch (err) {
			this.ctx.showError(`Failed to start profiler: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		let stopped = false;
		try {
			const control = await this.ctx.showHookCustom<"review" | "interrupted">(
				(ui, _theme, _keys, done) => new ProfilerControlComponent(done, () => ui.terminal.rows),
				{ overlay: true, fullscreen: true },
			);
			const cpuProfile = await session.stop();
			stopped = true;
			if (control === "interrupted") {
				this.ctx.showStatus("CPU profiling stopped; collected samples were discarded and no report was written.");
				return;
			}
			const workProfile = getWorkProfile(30);
			const result = await this.#saveReportBundle(
				"performance",
				"the current session, recent logs, sanitized environment and settings, CPU profile, and work profile",
				{
					sessionFile: this.ctx.sessionManager.getSessionFile(),
					settings: this.#getResolvedSettings(),
					cpuProfile,
					workProfile,
				},
			);
			if (result)
				this.ctx.showStatus(
					`${theme.status.success} Performance report saved\n${formatFileHyperlink(result.path)}\nFiles: ${result.files.length}`,
				);
		} catch (err) {
			if (!stopped) await session.stop().catch(() => {});
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleWorkReport(): Promise<void> {
		try {
			const workProfile = getWorkProfile(30);

			if (!workProfile.svg) {
				this.ctx.showWarning(`No work profile data (${workProfile.sampleCount} samples)`);
				return;
			}

			const outputPath = await this.#writeDiagnosticFile(
				"work-profile",
				"svg",
				workProfile.svg,
				`Work-scheduling flamegraph with ${workProfile.sampleCount} samples`,
			);
			if (!outputPath) return;
			const opened = await this.openLocalPath(outputPath);
			if (opened.ok)
				this.ctx.showStatus(`Saved and opened flamegraph (${workProfile.sampleCount} samples): ${outputPath}`);
			else
				this.ctx.showWarning(
					`Flamegraph saved but automatic open failed: ${opened.error}\nOpen manually: ${outputPath}`,
				);
		} catch (err) {
			this.ctx.showError(`Failed to open profile: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleDumpReport(): Promise<void> {
		try {
			const result = await this.#saveReportBundle(
				"bundle",
				"the current session, recent logs, sanitized environment and resolved settings",
				{
					sessionFile: this.ctx.sessionManager.getSessionFile(),
					settings: this.#getResolvedSettings(),
				},
			);
			if (result)
				this.ctx.showStatus(
					`${theme.status.success} Report bundle saved\n${formatFileHyperlink(result.path)}\nFiles: ${result.files.length}`,
				);
		} catch (err) {
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleMemoryReport(): Promise<void> {
		const loader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("spinnerAccent", spinner),
			text => theme.fg("muted", text),
			"Generating heap snapshot...",
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(loader);
		this.ctx.ui.requestRender();

		try {
			const heapSnapshot = generateHeapSnapshotData();
			loader.stop();
			this.ctx.statusContainer.clear();
			const result = await this.#saveReportBundle(
				"memory",
				"the current session, recent logs, sanitized environment and settings, and a heap snapshot",
				{
					sessionFile: this.ctx.sessionManager.getSessionFile(),
					settings: this.#getResolvedSettings(),
					heapSnapshot,
				},
			);
			if (result)
				this.ctx.showStatus(
					`${theme.status.success} Memory report saved\n${formatFileHyperlink(result.path)}\nFiles: ${result.files.length}`,
				);
		} catch (err) {
			loader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleViewLogs(): Promise<void> {
		try {
			const session = this.ctx.session;
			const manager = this.ctx.sessionManager;
			const sessionId = manager.getSessionId();
			const logSource = await createDebugLogSource();
			const logs = await logSource.getInitialText();
			if (!logs && !logSource.hasOlderLogs()) {
				this.ctx.showWarning("No log entries found for today.");
				return;
			}

			let overlay: OverlayHandle | undefined;
			const viewer = new DebugLogViewerComponent({
				logs,
				terminalRows: () => this.ctx.ui.terminal.rows,
				onExit: () => {
					overlay?.hide();
					this.ctx.showDebugSelector();
				},
				onStatus: message => this.ctx.showStatus(message, { dim: true }),
				onError: message => this.ctx.showError(message),
				onUpdate: () => this.ctx.ui.requestRender(),
				onCopy: async (payload, count) => {
					await reviewClipboardAction(this.ctx, {
						title: "debug log copy",
						identity: `debug-logs:${sessionId}:${createHash("sha256").update(payload).digest("hex")}`,
						label: `${count} selected debug log ${count === 1 ? "entry" : "entries"}`,
						success: `Copied ${count} debug log ${count === 1 ? "entry" : "entries"}.`,
						reopen: "Reopen Debug tools → View recent logs and reselect the entries.",
						current: () =>
							this.ctx.session === session &&
							this.ctx.sessionManager === manager &&
							manager.getSessionId() === sessionId,
						resolveText: () => payload,
					});
					return false;
				},
				logSource,
			});

			overlay = this.ctx.ui.showOverlay(viewer, {
				fullscreen: true,
				anchor: "top-left",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
			});
			this.ctx.ui.setFocus(viewer);
		} catch (err) {
			this.ctx.showError(`Failed to read logs: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleViewSystemInfo(): Promise<void> {
		try {
			const info = await collectSystemInfo();
			const formatted = formatSystemInfo(info);
			await this.#showReport("System information", "Privacy-safe local environment details", formatted);
		} catch (err) {
			this.ctx.showError(`Failed to collect system info: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async #handleContextProfile(): Promise<void> {
		await this.#showReport(
			"Context profile",
			"Privacy-safe prompt, tool, and provider-call measurements",
			formatContextProfile(this.ctx.session.getContextProfile()),
		);
	}

	async #showReport(title: string, purpose: string, content: string): Promise<void> {
		await this.ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					title,
					purpose,
					content,
					() => done(),
					() => ui.terminal.rows,
				),
			{ overlay: true, fullscreen: true },
		);
	}

	async #saveReportBundle(
		label: string,
		contents: string,
		options: Omit<ReportBundleOptions, "outputPath">,
	): Promise<ReportBundleResult | undefined> {
		const manager = this.ctx.sessionManager;
		const session = this.ctx.session;
		const sessionId = manager.getSessionId();
		const outputPath = path.join(getReportsDir(), `xcsh-${label}-${Snowflake.next()}.tar.gz`);
		const current = () =>
			this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
		const payloadHash = createHash("sha256")
			.update(JSON.stringify(options.settings ?? {}))
			.update(options.cpuProfile?.data ?? "")
			.update(options.heapSnapshot?.data ?? "")
			.update(options.workProfile?.folded ?? "")
			.digest("hex");
		const inspect = async () => {
			try {
				const stat = await fs.lstat(outputPath);
				if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Report destination is not a regular file.");
				const bytes = await fs.readFile(outputPath);
				return { size: stat.size, hash: createHash("sha256").update(bytes).digest("hex") };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw error;
			}
		};
		const prepare = async () => {
			if (!current()) throw new Error("The active session changed. Open the debug action again.");
			const before = await inspect();
			const review: ActionReview = {
				identity: `debug-report:${label}:${sessionId}`,
				scope: `Local diagnostic report · ${outputPath}`,
				revision: JSON.stringify({ before, payloadHash, sessionId }),
				changes: [
					{
						field: outputPath,
						before: before ? `${before.size} bytes · SHA256 ${before.hash.slice(0, 12)}` : "Absent",
						after: `Compressed diagnostic archive · payload SHA256 ${payloadHash.slice(0, 12)}`,
					},
				],
				consequence: `Writes a local archive containing ${contents}. It may contain sensitive conversation, logs, configuration, environment metadata, or profiling data; anyone with file access can read it. No upload or remote publication occurs.`,
			};
			return { review, target: before };
		};
		const proposal = await prepare();
		let result: ReportBundleResult | undefined;
		const outcome = await runReviewedAction(this.ctx, `${label} debug report`, {
			review: proposal.review,
			resolve: prepare,
			execute: async before => {
				if (JSON.stringify(await inspect()) !== JSON.stringify(before))
					throw new Error("Report destination changed after review.");
				result = await createReportBundle({ ...options, outputPath });
			},
		});
		if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
		return outcome === "succeeded" ? result : undefined;
	}

	async #writeDiagnosticFile(
		label: string,
		extension: string,
		content: string | Uint8Array,
		description: string,
	): Promise<string | undefined> {
		const manager = this.ctx.sessionManager;
		const session = this.ctx.session;
		const sessionId = manager.getSessionId();
		const outputPath = path.join(getReportsDir(), `xcsh-${label}-${Snowflake.next()}.${extension}`);
		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
		const hash = createHash("sha256").update(bytes).digest("hex");
		const current = () =>
			this.ctx.session === session && this.ctx.sessionManager === manager && manager.getSessionId() === sessionId;
		const inspect = async () => {
			try {
				const stat = await fs.lstat(outputPath);
				if (!stat.isFile() || stat.isSymbolicLink())
					throw new Error("Diagnostic destination is not a regular file.");
				const existing = await fs.readFile(outputPath);
				return { size: stat.size, hash: createHash("sha256").update(existing).digest("hex") };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw error;
			}
		};
		const prepare = async () => {
			if (!current()) throw new Error("The active session changed. Open the debug action again.");
			const before = await inspect();
			return {
				review: {
					identity: `debug-file:${label}:${sessionId}`,
					scope: `Local diagnostic file · ${outputPath}`,
					revision: JSON.stringify({ before, hash }),
					changes: [
						{
							field: outputPath,
							before: before ? `${before.size} bytes · SHA256 ${before.hash.slice(0, 12)}` : "Absent",
							after: `${bytes.length} bytes · SHA256 ${hash.slice(0, 12)} · permissions 0600`,
						},
					],
					consequence: `Writes ${description} to a local file and opens it after the write succeeds. No remote publication occurs.`,
				} satisfies ActionReview,
				target: before,
			};
		};
		const proposal = await prepare();
		const outcome = await runReviewedAction(this.ctx, `${label} export`, {
			review: proposal.review,
			resolve: prepare,
			execute: async before => {
				if (JSON.stringify(await inspect()) !== JSON.stringify(before))
					throw new Error("Diagnostic destination changed after review.");
				await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
				await fs.writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
			},
		});
		if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
		return outcome === "succeeded" ? outputPath : undefined;
	}

	async #handleTranscriptExport(): Promise<void> {
		await this.ctx.handleDebugTranscriptCommand();
	}
	async #handleOpenArtifacts(): Promise<void> {
		const manager = this.ctx.sessionManager;
		const session = this.ctx.session;
		const sessionId = manager.getSessionId();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) {
			this.ctx.showWarning("No active session file.");
			return;
		}

		const artifactsDir = sessionFile.slice(0, -6);

		const current = () =>
			this.ctx.session === session &&
			this.ctx.sessionManager === manager &&
			manager.getSessionId() === sessionId &&
			manager.getSessionFile() === sessionFile;
		const outcome = await reviewLocalPathAction(this.ctx, {
			title: "artifact folder",
			identity: `debug-artifacts:${sessionId}`,
			scope: `Local session artifacts · session ${sessionId}`,
			current,
			resolvePath: async () => {
				if (!current()) return undefined;
				try {
					const stat = await fs.lstat(artifactsDir);
					if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
					const resolved = await fs.realpath(artifactsDir);
					// `/var` resolves to `/private/var` on macOS even when the requested
					// artifact directory itself is not a symlink. Compare canonical parent
					// identity so that alias does not reject a valid local target, while
					// retaining the requested path in the review and launcher contract.
					const canonicalExpected = path.join(
						await fs.realpath(path.dirname(artifactsDir)),
						path.basename(artifactsDir),
					);
					if (resolved !== canonicalExpected) return undefined;
					return {
						path: artifactsDir,
						revision: `${stat.dev}:${stat.ino}:${stat.mtimeMs}`,
						description: `Directory · device ${stat.dev} · inode ${stat.ino}`,
					};
				} catch {
					return undefined;
				}
			},
			open: target => this.openLocalPath(target),
		});
		if (outcome === "succeeded") this.ctx.showStatus(`Opened: ${artifactsDir}`);
		else if (outcome === "missing") this.ctx.showWarning("Artifact folder does not exist yet.");
		else if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
	}

	async #handleClearCache(): Promise<void> {
		const sessionsDir = getSessionsDir();
		try {
			const completed = new Set<string>();
			const prepare = async () => {
				const targets = (await getArtifactCacheTargets(sessionsDir, 30)).filter(
					target => !completed.has(target.path),
				);
				if (targets.length === 0) throw new Error("Artifact cache has no directories older than 30 days.");
				const review: ActionReview = {
					identity: `artifact-cache:${path.resolve(sessionsDir)}`,
					scope: `Local session artifact cache · ${path.resolve(sessionsDir)}`,
					revision: JSON.stringify(targets),
					changes: targets.map(target => ({
						field: target.path,
						before: `${target.fileCount} files · ${formatBytes(target.size)} · modified ${new Date(target.mtimeMs).toISOString()}`,
						after: "Removed",
					})),
					consequence: `Permanently deletes ${targets.length} exact artifact director${targets.length === 1 ? "y" : "ies"} older than 30 days. Session transcript files are not selected. Targets are revalidated before deletion; only unresolved failures are offered on retry.`,
				};
				return { review, target: targets };
			};
			let proposal: Awaited<ReturnType<typeof prepare>>;
			try {
				proposal = await prepare();
			} catch (error) {
				this.ctx.showStatus(error instanceof Error ? error.message : String(error));
				return;
			}
			let removed = 0;
			const outcome = await runReviewedAction(this.ctx, "artifact cache removal", {
				review: proposal.review,
				resolve: prepare,
				execute: async targets => {
					const result = await clearArtifactCacheTargets(sessionsDir, targets);
					for (const target of result.removed) completed.add(target);
					removed += result.removed.length;
					if (result.failed.length)
						throw new Error(
							`${result.failed.length} artifact director${result.failed.length === 1 ? "y" : "ies"} unresolved: ${result.failed.map(failure => `${failure.path}: ${failure.error}`).join("; ")}`,
						);
				},
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "succeeded")
				this.ctx.showStatus(`${theme.status.success} Cleared ${removed} artifact directories`);
		} catch (err) {
			this.ctx.showError(`Failed to clear cache: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	#getResolvedSettings(): Record<string, unknown> {
		// Extract key settings for the report
		return {
			model: this.ctx.session.model?.id,
			thinkingLevel: this.ctx.session.thinkingLevel,
			planModeEnabled: this.ctx.planModeEnabled,
			toolOutputExpanded: this.ctx.toolOutputExpanded,
			hideThinkingBlock: this.ctx.hideThinkingBlock,
		};
	}
}

export function formatContextProfile(profile: ContextProfile): string {
	const lines = [
		"Context Profile",
		`Loading: ${profile.loadingMode}`,
		`System prompt: ${profile.systemPromptBytes.toLocaleString()} bytes (~${profile.estimatedSystemPromptTokens.toLocaleString()} tokens)`,
		`Initial tools: ${profile.initialToolBytes.toLocaleString()} bytes; deferred: ${profile.deferredToolBytes.toLocaleString()} bytes`,
	];
	for (const call of profile.providerCalls) {
		const prompt = call.providerPromptTokens?.toLocaleString() ?? "pending";
		const cacheRead = call.providerCacheReadTokens?.toLocaleString() ?? "pending";
		const output = call.providerOutputTokens?.toLocaleString() ?? "pending";
		const percentage = call.windowPercentage === undefined ? "pending" : `${call.windowPercentage.toFixed(3)}%`;
		lines.push(
			`Call ${call.call}: ${call.provider}/${call.model} — prompt ${prompt}, cache read ${cacheRead}, output ${output}, window ${percentage}`,
			`  Payload: ${call.payloadBytes.toLocaleString()} bytes (${call.toolCount} tools, ${call.messageCount} messages)`,
		);
	}
	if (profile.providerCalls.length === 0) lines.push("Provider calls: none yet");
	return lines.join("\n");
}

/**
 * Show the debug selector.
 */
export function showDebugSelector(ctx: InteractiveModeContext, done: () => void): DebugSelectorComponent {
	const selector = new DebugSelectorComponent(ctx, done);
	return selector;
}
