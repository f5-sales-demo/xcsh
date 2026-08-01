import * as fs from "node:fs";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import type { Component } from "@f5-sales-demo/pi-tui";
import { ImageProtocol, TERMINAL, Text } from "@f5-sales-demo/pi-tui";
import { $env, getProjectDir, isEnoent, prompt, setShellPwd } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { Settings } from "../config/settings";
import { type BashResult, executeBash } from "../exec/bash-executor";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { resolveLocalRoot } from "../internal-urls/local-protocol";
import { truncateToVisualLines } from "../modes/components/visual-truncate";
import type { Theme } from "../modes/theme/theme";
import bashDescription from "../prompts/tools/bash.md" with { type: "text" };
import { type ContainmentFence, containmentStatus, fenceVerdict } from "../sandbox/containment";
import { resolveSessionFence } from "../sandbox/session-fence";
import { SECRET_ENV_PATTERNS, type SecretObfuscator } from "../secrets";
import { DEFAULT_MAX_BYTES, TailBuffer } from "../session/streaming-output";
import { renderStatusLine } from "../tui";
import { CachedOutputBlock } from "../tui/output-block";
import { getImageLineMask } from "../utils/image-passthrough";
import type { ToolSession } from ".";
import { type BashInteractiveResult, runInteractiveBashPty } from "./bash-interactive";
import { checkBashInterception } from "./bash-interceptor";
import { applyHeadTail } from "./bash-normalize";
import { expandInternalUrls, type InternalUrlExpansionOptions } from "./bash-skill-urls";
import { formatStyledTruncationWarning, type OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { formatToolWorkingDirectory, replaceTabs, truncateToWidth } from "./render-utils";
import { ToolAbortError, ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";
import { clampTimeout } from "./tool-timeouts";

// Module-level obfuscator reference for the renderer (set by BashTool constructor).
let _sessionObfuscator: SecretObfuscator | undefined;

/**
 * Where each session's containment boundary is anchored, captured once and never moved by the model.
 *
 * Keyed on the session object because the tool is built by a factory, so an instance field would reset
 * whenever a new `BashTool` is made. Weak so a finished session is collectable.
 */
const FENCE_ANCHORS = new WeakMap<object, { root: string; project: string }>();

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const BASH_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_AUTO_BACKGROUND_THRESHOLD_MS = 60_000;

const bashSchemaBase = Type.Object({
	command: Type.String({ description: "Command to execute" }),
	description: Type.Optional(
		Type.String({
			description:
				"Human-readable description of what this command does (e.g. 'Install dependencies', 'Run test suite')",
		}),
	),
	env: Type.Optional(
		Type.Record(Type.String({ pattern: BASH_ENV_NAME_PATTERN.source }), Type.String(), {
			description:
				"Additional environment variables passed to the command and rendered inline as shell assignments; prefer this for multiline or quote-heavy content",
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 300)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: cwd)" })),
	head: Type.Optional(Type.Number({ description: "Return only first N lines of output" })),
	tail: Type.Optional(Type.Number({ description: "Return only last N lines of output" })),
	pty: Type.Optional(
		Type.Boolean({
			description: "Run in PTY mode when command needs a real terminal (e.g. sudo/ssh/top/less); default: false",
		}),
	),
});

const bashSchemaWithAsync = Type.Object({
	...bashSchemaBase.properties,
	async: Type.Optional(
		Type.Boolean({
			description: "Run in background; returns immediately with a job ID. Result delivered as follow-up.",
		}),
	),
});

type BashToolSchema = typeof bashSchemaBase | typeof bashSchemaWithAsync;

export interface BashToolInput {
	command: string;
	description?: string;
	env?: Record<string, string>;
	timeout?: number;
	cwd?: string;
	head?: number;
	tail?: number;
	async?: boolean;
	pty?: boolean;
}

export interface BashToolDetails {
	meta?: OutputMeta;
	timeoutSeconds?: number;
	async?: {
		state: "running" | "completed" | "failed";
		jobId: string;
		type: "bash";
	};
}

export interface BashToolOptions {}

type ManagedBashJobCompletion =
	| {
			kind: "completed";
			result: AgentToolResult<BashToolDetails>;
	  }
	| {
			kind: "failed";
			error: unknown;
	  };

interface ManagedBashJobHandle {
	jobId: string;
	label: string;
	completion: Promise<ManagedBashJobCompletion>;
	getLatestText: () => string;
	setBackgrounded: (backgrounded: boolean) => void;
}

function normalizeResultOutput(result: BashResult | BashInteractiveResult): string {
	return result.output || "";
}

/**
 * A working directory has to exist and be a directory. Shared by both call sites so the session's cwd
 * and the `cwd` argument report the same way, and so the message names the path rather than describing
 * an internal invariant.
 */
async function assertUsableDirectory(dir: string): Promise<void> {
	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(dir);
	} catch (err) {
		if (isEnoent(err)) throw new ToolError(`Working directory does not exist: ${dir}`);
		throw err;
	}
	if (!stat.isDirectory()) throw new ToolError(`Working directory is not a directory: ${dir}`);
}

/**
 * The fence as the `ReadBoundary` the internal-URL expander wants.
 *
 * A two-method shim rather than a shared interface: the expander only ever asks about reads, and giving
 * it the whole fence would invite it to grow a second opinion about writes. `undefined` in means
 * isolation is off, which the expander already treats as "do not check".
 */
export function readBoundaryFor(fence: ContainmentFence | undefined, cwd: string) {
	if (!fence) return undefined;
	return { cwd, isAllowed: (candidate: string) => fenceVerdict(fence, candidate, "read") === "allow" };
}

function isInteractiveResult(result: BashResult | BashInteractiveResult): result is BashInteractiveResult {
	return "timedOut" in result;
}

function normalizeBashEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!env || Object.keys(env).length === 0) return undefined;
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (!BASH_ENV_NAME_PATTERN.test(key)) {
			throw new ToolError(`Invalid bash env name: ${key}`);
		}
		normalized[key] = value;
	}
	return normalized;
}

function escapeBashEnvValueForDisplay(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t")
		.replaceAll('"', '\\"')
		.replaceAll("$", "\\$")
		.replaceAll("`", "\\`");
}

function formatBashEnvAssignments(
	env: Record<string, string> | undefined,
	obfuscator?: import("../secrets/obfuscator").SecretObfuscator,
): string {
	if (!env || Object.keys(env).length === 0) return "";
	return Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			// Mask if name matches hardcoded patterns OR if the obfuscator recognizes the value as a secret.
			const isSensitiveName = SECRET_ENV_PATTERNS.test(key);
			const isSensitiveValue = obfuscator?.hasSecrets() && obfuscator.obfuscate(value) !== value;
			const display = isSensitiveName || isSensitiveValue ? "***" : escapeBashEnvValueForDisplay(value);
			return `${key}="${display}"`;
		})
		.join(" ");
}

function unescapePartialJsonString(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== "\\") {
			output += char;
			continue;
		}
		const next = value[index + 1];
		if (!next) {
			output += "\\";
			break;
		}
		index += 1;
		switch (next) {
			case '"':
				output += '"';
				break;
			case "\\":
				output += "\\";
				break;
			case "/":
				output += "/";
				break;
			case "b":
				output += "\b";
				break;
			case "f":
				output += "\f";
				break;
			case "n":
				output += "\n";
				break;
			case "r":
				output += "\r";
				break;
			case "t":
				output += "\t";
				break;
			case "u": {
				const hex = value.slice(index + 1, index + 5);
				if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
					output += String.fromCharCode(Number.parseInt(hex, 16));
					index += 4;
				} else {
					output += "\\u";
				}
				break;
			}
			default:
				output += next;
		}
	}
	return output;
}

function extractPartialBashEnv(partialJson: string | undefined): Record<string, string> | undefined {
	if (!partialJson) return undefined;
	const envStart = partialJson.search(/"env"\s*:\s*\{/u);
	if (envStart === -1) return undefined;
	const objectStart = partialJson.indexOf("{", envStart);
	if (objectStart === -1) return undefined;
	const envBody = partialJson.slice(objectStart + 1);
	const env: Record<string, string> = {};
	const matcher = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/gu;
	for (const match of envBody.matchAll(matcher)) {
		env[match[1]!] = unescapePartialJsonString(match[2]!);
	}
	return Object.keys(env).length > 0 ? env : undefined;
}

function getBashEnvForDisplay(args: BashRenderArgs): Record<string, string> | undefined {
	// During streaming, partial-json parsing often does not surface env values until the object closes.
	// Recover them from the raw JSON buffer so the pending bash preview can show `NAME="..." cmd` immediately,
	// instead of rendering only the command and making the env assignment appear at the very end.
	const partialEnv = extractPartialBashEnv(args.__partialJson);
	if (partialEnv && args.env) return { ...partialEnv, ...args.env };
	return args.env ?? partialEnv;
}
/**
 * Bash tool implementation.
 *
 * Executes bash commands with optional timeout and working directory.
 */
export class BashTool implements AgentTool<BashToolSchema, BashToolDetails> {
	readonly name = "bash";
	readonly label = "Bash";
	readonly description: string;
	readonly parameters: BashToolSchema;
	readonly concurrency = "exclusive";
	readonly strict = true;
	readonly #asyncEnabled: boolean;
	readonly #autoBackgroundEnabled: boolean;
	readonly #autoBackgroundThresholdMs: number;

	constructor(private readonly session: ToolSession) {
		_sessionObfuscator = session.obfuscator;
		this.#asyncEnabled = this.session.settings.get("async.enabled");
		this.#autoBackgroundEnabled = this.session.settings.get("bash.autoBackground.enabled");
		this.#autoBackgroundThresholdMs = Math.max(
			0,
			Math.floor(
				this.session.settings.get("bash.autoBackground.thresholdMs") ?? DEFAULT_AUTO_BACKGROUND_THRESHOLD_MS,
			),
		);
		this.parameters = this.#asyncEnabled ? bashSchemaWithAsync : bashSchemaBase;
		this.description = prompt.render(bashDescription, {
			asyncEnabled: this.#asyncEnabled,
			autoBackgroundEnabled: this.#autoBackgroundEnabled,
			autoBackgroundThresholdSeconds: Math.max(0, Math.floor(this.#autoBackgroundThresholdMs / 1000)),
			hasAstGrep: this.session.settings.get("astGrep.enabled"),
			hasAstEdit: this.session.settings.get("astEdit.enabled"),
			hasGrep: this.session.settings.get("grep.enabled"),
			hasFind: this.session.settings.get("find.enabled"),
		});
	}

	#formatResultOutput(result: BashResult | BashInteractiveResult, headLines?: number, tailLines?: number): string {
		let outputText = normalizeResultOutput(result);
		const headTailResult = applyHeadTail(outputText, headLines, tailLines);
		if (headTailResult.applied) {
			outputText = headTailResult.text;
		}
		if (!outputText) {
			outputText = "(no output)";
		}
		return outputText;
	}

	#buildResultText(result: BashResult | BashInteractiveResult, timeoutSec: number, outputText: string): string {
		if (result.cancelled) {
			throw new ToolError(normalizeResultOutput(result) || "Command aborted");
		}
		if (isInteractiveResult(result) && result.timedOut) {
			throw new ToolError(normalizeResultOutput(result) || `Command timed out after ${timeoutSec} seconds`);
		}
		if (result.exitCode === undefined) {
			throw new ToolError(`${outputText}\n\nCommand failed: missing exit status`);
		}
		if (result.exitCode !== 0) {
			throw new ToolError(`${outputText}\n\nCommand exited with code ${result.exitCode}`);
		}
		return outputText;
	}

	#buildCompletedResult(
		result: BashResult | BashInteractiveResult,
		timeoutSec: number,
		headLines?: number,
		tailLines?: number,
	): AgentToolResult<BashToolDetails> {
		const outputText = this.#formatResultOutput(result, headLines, tailLines);
		const details: BashToolDetails = { timeoutSeconds: timeoutSec };
		const resultBuilder = toolResult(details).text(outputText).truncationFromSummary(result, { direction: "tail" });
		this.#buildResultText(result, timeoutSec, outputText);
		return resultBuilder.done();
	}

	#buildBackgroundStartResult(
		jobId: string,
		label: string,
		previewText: string,
		timeoutSec: number,
	): AgentToolResult<BashToolDetails> {
		const details: BashToolDetails = {
			timeoutSeconds: timeoutSec,
			async: { state: "running", jobId, type: "bash" },
		};
		const lines: string[] = [];
		const trimmedPreview = previewText.trimEnd();
		if (trimmedPreview.length > 0) {
			lines.push(trimmedPreview, "");
		}
		lines.push(`Background job ${jobId} started: ${label}`);
		lines.push("Result will be delivered automatically when complete.");
		lines.push(`Use \`poll\`, \`read jobs://${jobId}\`, or \`cancel_job\` if needed.`);
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details,
		};
	}

	#extractTextResult(result: AgentToolResult<BashToolDetails>): string {
		return result.content.find(block => block.type === "text")?.text ?? "";
	}

	#startManagedBashJob(options: {
		command: string;
		commandCwd: string;
		timeoutMs: number;
		timeoutSec: number;
		headLines?: number;
		tailLines?: number;
		resolvedEnv?: Record<string, string>;
		maskSecrets?: (text: string) => string;
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>;
		startBackgrounded: boolean;
	}): ManagedBashJobHandle {
		const manager = this.session.asyncJobManager;
		if (!manager) {
			throw new ToolError("Background job manager unavailable for this session.");
		}

		const label = options.command.length > 120 ? `${options.command.slice(0, 117)}...` : options.command;
		let latestText = "";
		let backgrounded = options.startBackgrounded;
		const completion = Promise.withResolvers<ManagedBashJobCompletion>();

		const jobId = manager.register(
			"bash",
			label,
			async ({ jobId, signal: runSignal, reportProgress }) => {
				const { path: artifactPath, id: artifactId } = (await this.session.allocateOutputArtifact?.("bash")) ?? {};
				const tailBuffer = new TailBuffer(DEFAULT_MAX_BYTES);
				try {
					const result = await executeBash(options.command, {
						cwd: options.commandCwd,
						sessionKey: `${this.session.getSessionId?.() ?? ""}:async:${jobId}`,
						timeout: options.timeoutMs,
						signal: runSignal,
						env: options.resolvedEnv,
						artifactPath,
						artifactId,
						maskSecrets: options.maskSecrets,
						fence: this.#containmentFence(),
						onChunk: chunk => {
							tailBuffer.append(chunk);
							const preview = options.maskSecrets ? options.maskSecrets(tailBuffer.text()) : tailBuffer.text();
							latestText = preview;
							void reportProgress(latestText, { async: { state: "running", jobId, type: "bash" } });
						},
					});
					const finalResult = this.#buildCompletedResult(
						result,
						options.timeoutSec,
						options.headLines,
						options.tailLines,
					);
					const finalText = this.#extractTextResult(finalResult);
					latestText = finalText;
					completion.resolve({ kind: "completed", result: finalResult });
					await reportProgress(finalText, { async: { state: "completed", jobId, type: "bash" } });
					return finalText;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					latestText = message;
					completion.resolve({ kind: "failed", error });
					await reportProgress(message, { async: { state: "failed", jobId, type: "bash" } });
					throw error;
				}
			},
			{
				onProgress: async (text, details) => {
					latestText = text;
					await options.onUpdate?.({
						content: [{ type: "text", text }],
						details: backgrounded ? ((details ?? {}) as BashToolDetails) : {},
					});
				},
			},
		);

		return {
			jobId,
			label,
			completion: completion.promise,
			getLatestText: () => latestText,
			setBackgrounded: (nextBackgrounded: boolean) => {
				backgrounded = nextBackgrounded;
			},
		};
	}

	async #waitForManagedBashJob(
		job: ManagedBashJobHandle,
		thresholdMs: number,
		signal?: AbortSignal,
	): Promise<ManagedBashJobCompletion | { kind: "running" } | { kind: "aborted" }> {
		if (signal?.aborted) {
			return { kind: "aborted" };
		}

		const waiters: Array<Promise<ManagedBashJobCompletion | { kind: "running" } | { kind: "aborted" }>> = [
			job.completion,
			Bun.sleep(thresholdMs).then(() => ({ kind: "running" as const })),
		];

		if (!signal) {
			return await Promise.race(waiters);
		}

		const { promise: abortedPromise, resolve: resolveAborted } = Promise.withResolvers<{ kind: "aborted" }>();
		const onAbort = () => resolveAborted({ kind: "aborted" });
		signal.addEventListener("abort", onAbort, { once: true });
		waiters.push(abortedPromise);
		try {
			return await Promise.race(waiters);
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	}

	#resolveAutoBackgroundWaitMs(timeoutMs: number): number {
		if (this.#autoBackgroundThresholdMs <= 0) return 0;
		const timeoutBufferMs = 1_000;
		return Math.max(0, Math.min(this.#autoBackgroundThresholdMs, timeoutMs - timeoutBufferMs));
	}

	/**
	 * Where this session's boundary is anchored.
	 *
	 * **Not the live cwd.** The fence used to be rebuilt from `session.cwd`, which line ~717 replaces
	 * with whatever PWD the command ended in — so the model could move the boundary with a `cd`. Measured
	 * on a workspace outside the home tree, which is the layout the sibling-checkout deny exists for:
	 * with `/work/custA` as the workspace, `/work/custB/secret.env` was denied; `cd /usr` is permitted
	 * (correctly — `/usr` is not sensitive), and the *next* fence was rooted at `/usr`, where the parent
	 * deny of `/work` cannot be expressed because `dirname("/usr")` is `/` and denying the root is refused
	 * as too broad. `/work/custB` then became readable **and** writable. Two tool calls, no exotic
	 * spelling, and the tenant boundary was gone.
	 *
	 * So the anchor is captured once per session and never follows the shell. It is keyed on the session
	 * object rather than held on this instance because the tool is built by a factory
	 * (`bash: s => new BashTool(s)`) and must not depend on how long an instance happens to live.
	 *
	 * An *operator* moving the project — startup, or the slash command that calls `setProjectDir` — does
	 * re-anchor it. That asymmetry is the point: the operator may move the boundary, the model may not.
	 *
	 * The anchor matters more since #2624, not less: the read/write tools now consult this same
	 * allow-by-default fence, which loses a deny when its root moves. The deny-by-default policy they
	 * used to have would have granted nothing new on a relocation and so masked the problem there.
	 * `sandbox-guard` still resolves from `ctx.cwd` rather than the anchor, because a tool call names its
	 * own paths and has no persistent shell to relocate.
	 */
	#containmentRoot(): string {
		const project = getProjectDir();
		const anchor = FENCE_ANCHORS.get(this.session);
		if (anchor === undefined) {
			FENCE_ANCHORS.set(this.session, { root: this.session.cwd, project });
			return this.session.cwd;
		}
		if (anchor.project !== project) {
			// The operator moved the project. Re-anchor there rather than at `session.cwd`, which a
			// model `cd` may have moved in the meantime.
			FENCE_ANCHORS.set(this.session, { root: project, project });
			return project;
		}
		return anchor.root;
	}

	/**
	 * The fence for this invocation, or undefined when isolation is off.
	 *
	 * Built here rather than in the executor because `executeBash` is shared: user-typed `!cmd` and
	 * RPC `bash` reach it too, and the same brush-core runs credential helpers and the interactive
	 * `xcsh shell`. Only the model's tool call is fenced (#2554).
	 */
	#containmentFence() {
		const artifactsDir = this.session.getArtifactsDir?.();
		// One resolver, shared with `sandbox-guard` and the internal-URL check, so the pre-check and the
		// kernel cannot be looking at different boundaries (#2624).
		return resolveSessionFence(this.#containmentRoot(), this.session.settings, {
			extraRoots: artifactsDir ? [artifactsDir] : [],
		});
	}

	async execute(
		_toolCallId: string,
		{
			command: rawCommand,
			env: rawEnv,
			timeout: rawTimeout = 300,
			cwd,
			head,
			tail,
			async: asyncRequested = false,
			pty = false,
		}: BashToolInput,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
		ctx?: AgentToolContext,
	): Promise<AgentToolResult<BashToolDetails>> {
		let command = rawCommand;
		const env = normalizeBashEnv(rawEnv);

		// Extract leading `cd <path> && ...` into cwd when the model ignores the cwd parameter.
		if (!cwd) {
			const cdMatch = command.match(/^cd\s+((?:[^&\\]|\\.)+?)\s*&&\s*/);
			if (cdMatch) {
				cwd = cdMatch[1].trim().replace(/^["']|["']$/g, "");
				command = command.slice(cdMatch[0].length);
			}
		}
		if (asyncRequested && !this.#asyncEnabled) {
			throw new ToolError("Async bash execution is disabled. Enable async.enabled to use async mode.");
		}

		// Only apply explicit head/tail params from tool input.
		const headLines = head;
		const tailLines = tail;

		// Check interception if enabled and available tools are known
		if (this.session.settings.get("bashInterceptor.enabled")) {
			const rules = this.session.settings.getBashInterceptorRules();
			const interception = checkBashInterception(command, ctx?.toolNames ?? [], rules);
			if (interception.block) {
				throw new ToolError(interception.message ?? "Command blocked");
			}
		}

		// The session's own working directory, checked before anything reasons about a boundary anchored
		// on it. `resolveSessionFence` below builds a `ContainmentFence`, which refuses to build on a
		// workspace it cannot canonicalise — deliberately, since rules on an unresolved path would grant
		// nothing while looking like they enforce. That throw used to surface here instead of the cwd
		// error, so a mistyped directory reported "sandbox containment: cannot canonicalise the session
		// workspace …" rather than naming the directory (#2624). The invariant is right; it just must not
		// be the first thing a caller hears about a path that plainly does not exist.
		//
		// Only `session.cwd` is checked here. The `cwd` *argument* can carry an internal URL that has not
		// been expanded yet, so it keeps its own check below, after expansion.
		await assertUsableDirectory(this.session.cwd);

		// Built ONCE per invocation and shared with the executor below. Two calls meant two builds on the
		// session's first command — the resolver caches per configuration, and these two asked for
		// different configurations — which doubled a cost that lands as user-visible latency. Sharing is
		// also the more correct answer: the internal-URL check and the shell are then reasoning about the
		// same boundary rather than two that merely agree today.
		const fence = this.#containmentFence();

		const localOptions = {
			getArtifactsDir: this.session.getArtifactsDir,
			getSessionId: this.session.getSessionId,
		};
		const internalUrlOptions: InternalUrlExpansionOptions = {
			skills: this.session.skills ?? [],
			internalRouter: this.session.internalRouter,
			localOptions,
			// Refuse a URL resolving outside the session's boundary rather than handing bash a path the
			// session's own `read` tool would deny (#2468). The roots below are the session's own, which
			// the boundary denies wholesale because they sit under the sessions directory.
			readBoundary: readBoundaryFor(fence, this.session.cwd),
			sessionOwnedRoots: () => {
				const roots = [resolveLocalRoot(localOptions)];
				const artifactsDir = this.session.getArtifactsDir?.();
				if (artifactsDir) roots.push(artifactsDir);
				return roots;
			},
		};
		command = await expandInternalUrls(command, { ...internalUrlOptions, ensureLocalParentDirs: true });

		// `env` values are NEVER expanded. The tool description recommends `env` for multiline,
		// quote-heavy, or untrusted values, so that channel has to stay byte-exact — expanding it
		// silently rewrote data the caller had deliberately routed around the shell (#2468).

		// Resolve protocol URLs (skill://, agent://, etc.) in extracted cwd.
		if (cwd?.includes("://")) {
			cwd = await expandInternalUrls(cwd, { ...internalUrlOptions, noEscape: true });
		}

		const commandCwd = cwd ? resolveToCwd(cwd, this.session.cwd) : this.session.cwd;
		await assertUsableDirectory(commandCwd);

		// Clamp to reasonable range: 1s - 3600s (1 hour)
		const timeoutSec = clampTimeout("bash", rawTimeout);
		const timeoutMs = timeoutSec * 1000;

		// Build secret masking callback from the session obfuscator (always-on for env secrets).
		const obfuscator = this.session.obfuscator;
		_sessionObfuscator = obfuscator; // Keep module-level ref fresh for renderer
		const maskSecrets = obfuscator?.hasSecrets() ? (t: string) => obfuscator.obfuscate(t) : undefined;

		if (asyncRequested) {
			if (!this.session.asyncJobManager) {
				throw new ToolError("Async job manager unavailable for this session.");
			}
			const job = this.#startManagedBashJob({
				command,
				commandCwd,
				timeoutMs,
				timeoutSec,
				headLines,
				tailLines,
				resolvedEnv: env,
				maskSecrets,
				onUpdate,
				startBackgrounded: true,
			});
			return this.#buildBackgroundStartResult(job.jobId, job.label, "", timeoutSec);
		}

		if (this.#autoBackgroundEnabled && !pty && this.session.asyncJobManager) {
			const autoBackgroundWaitMs = this.#resolveAutoBackgroundWaitMs(timeoutMs);
			const startBackgrounded = autoBackgroundWaitMs === 0;
			const job = this.#startManagedBashJob({
				command,
				commandCwd,
				timeoutMs,
				timeoutSec,
				headLines,
				tailLines,
				resolvedEnv: env,
				maskSecrets,
				onUpdate,
				startBackgrounded,
			});
			if (startBackgrounded) {
				return this.#buildBackgroundStartResult(job.jobId, job.label, "", timeoutSec);
			}
			const waitResult = await this.#waitForManagedBashJob(job, autoBackgroundWaitMs, signal);
			if (waitResult.kind === "completed") {
				this.session.asyncJobManager.acknowledgeDeliveries([job.jobId]);
				return waitResult.result;
			}
			if (waitResult.kind === "failed") {
				this.session.asyncJobManager.acknowledgeDeliveries([job.jobId]);
				throw waitResult.error;
			}
			if (waitResult.kind === "aborted") {
				this.session.asyncJobManager.cancel(job.jobId);
				this.session.asyncJobManager.acknowledgeDeliveries([job.jobId]);
				throw new ToolAbortError(job.getLatestText() || "Command aborted");
			}
			job.setBackgrounded(true);
			return this.#buildBackgroundStartResult(job.jobId, job.label, job.getLatestText(), timeoutSec);
		}

		// Track output for streaming updates (tail only)
		const tailBuffer = new TailBuffer(DEFAULT_MAX_BYTES);

		// Allocate artifact for truncated output storage
		const { path: artifactPath, id: artifactId } = (await this.session.allocateOutputArtifact?.("bash")) ?? {};

		// The PTY path can only be confined where the OS backend reaches it, and on Linux it does not:
		// Landlock is applied in a `pre_exec` hook, and `portable-pty`'s `CommandBuilder` exposes none
		// (its `as_command` is private, and its `Clone + Debug + PartialEq` derives preclude a closure
		// field ever being added). Since `pty` is a parameter the *model* supplies, leaving it reachable
		// would make containment opt-out by the very caller it constrains — the hole that was just closed
		// on macOS. So a fenced session falls back to the non-PTY path, which is confined.
		//
		// The cost is real and Linux-only: `top`, `less` and `ssh` run without a terminal in a fenced
		// session. Confining the PTY child properly is the follow-up; reporting a boundary that a flag
		// steps around would be worse than losing interactivity.
		// Only worth giving up when there is an OS backend for the non-PTY path to use and none for this
		// one. Where no backend exists — Linux without Landlock, Windows — both paths are scanner-only,
		// so disabling PTY would remove interactive terminals and improve containment by nothing.
		const osBackend = containmentStatus(fence !== undefined);
		const ptyConfinable = !osBackend.osEnforced || osBackend.backend === "seatbelt";
		const usePty = pty && ptyConfinable && $env.PI_NO_PTY !== "1" && ctx?.hasUI === true && ctx.ui !== undefined;
		const result: BashResult | BashInteractiveResult = usePty
			? await runInteractiveBashPty(ctx.ui!, {
					command,
					cwd: commandCwd,
					timeoutMs,
					signal,
					env,
					artifactPath,
					artifactId,
					maskSecrets,
					// The same fence that decided `ptyConfinable`, so the gate and the enforcement can
					// never be looking at different answers.
					fence,
				})
			: await executeBash(command, {
					cwd: commandCwd,
					sessionKey: this.session.getSessionId?.() ?? undefined,
					timeout: timeoutMs,
					signal,
					env,
					artifactPath,
					artifactId,
					maskSecrets,
					fence,
					onChunk: chunk => {
						tailBuffer.append(chunk);
						if (onUpdate) {
							const preview = maskSecrets ? maskSecrets(tailBuffer.text()) : tailBuffer.text();
							onUpdate({
								content: [{ type: "text", text: preview }],
								details: {},
							});
						}
					},
				});
		// Update working directory if the persistent shell changed it
		if ("newCwd" in result && result.newCwd && result.newCwd !== this.session.cwd) {
			this.session.cwd = result.newCwd;
			setShellPwd(result.newCwd);
			this.session.eventBus?.emit("cwd:changed", result.newCwd);
		}

		if (result.cancelled) {
			if (signal?.aborted) {
				throw new ToolAbortError(normalizeResultOutput(result) || "Command aborted");
			}
			throw new ToolError(normalizeResultOutput(result) || "Command aborted");
		}
		if (isInteractiveResult(result) && result.timedOut) {
			throw new ToolError(normalizeResultOutput(result) || `Command timed out after ${timeoutSec} seconds`);
		}
		return this.#buildCompletedResult(result, timeoutSec, headLines, tailLines);
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface BashRenderArgs {
	command?: string;
	description?: string;
	env?: Record<string, string>;
	timeout?: number;
	cwd?: string;
	__partialJson?: string;
	[key: string]: unknown;
}

interface BashRenderContext {
	/** Raw output text */
	output?: string;
	/** Whether output came from artifact storage */
	isFullOutput?: boolean;
	/** Whether output is expanded */
	expanded?: boolean;
	/** Number of preview lines when collapsed */
	previewLines?: number;
	/** Timeout in seconds */
	timeout?: number;
}

function formatBashCommand(args: BashRenderArgs): string {
	const command = replaceTabs(args.command || "…");
	const prompt = "$";
	const cwd = getProjectDir();
	const displayWorkdir = formatToolWorkingDirectory(args.cwd, cwd);
	const renderedCommand = [formatBashEnvAssignments(getBashEnvForDisplay(args), _sessionObfuscator), command]
		.filter(Boolean)
		.join(" ");
	return displayWorkdir ? `${prompt} cd ${displayWorkdir} && ${renderedCommand}` : `${prompt} ${renderedCommand}`;
}

function getBashVerboseSetting(): boolean {
	try {
		return Settings.instance.get("bash.verbose");
	} catch {
		return false;
	}
}

export const bashToolRenderer = {
	renderCall(args: BashRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		let summaryText: string | undefined;
		if (args.description) {
			summaryText = args.description;
		} else if (args.command) {
			summaryText = formatBashCommand(args).replace(/\s*\\\r?\n\s*/g, " ");
		}
		const text = renderStatusLine({ icon: "pending", title: "Bash", description: summaryText }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: BashToolDetails;
			isError?: boolean;
		},
		options: RenderResultOptions & { renderContext?: BashRenderContext },
		uiTheme: Theme,
		args?: BashRenderArgs,
	): Component {
		const cmdText = args ? formatBashCommand(args) : undefined;
		const isError = result.isError === true;
		const header = renderStatusLine({ title: "Bash" }, uiTheme);
		const details = result.details;
		const outputBlock = new CachedOutputBlock();

		return {
			render: (width: number): string[] => {
				// REACTIVE: read mutable options at render time
				const { renderContext } = options;
				const expanded = renderContext?.expanded ?? options.expanded;

				// Collapsed mode check first — before heavy computation.
				// This ensures the collapsed line is always returned when bash.verbose=false,
				// preventing any transient verbose output flash.
				const verbose = getBashVerboseSetting();
				if (!verbose && !expanded) {
					const hasAsyncDetails = details?.async != null;
					const outputText = renderContext?.output ?? result.content?.find(c => c.type === "text")?.text ?? "";
					const hasSixel = TERMINAL.imageProtocol === ImageProtocol.Sixel && outputText.includes("\x1bP");
					if (!isError && !hasAsyncDetails && !hasSixel) {
						const rawCmd = args?.command?.replace(/\s*\\\r?\n\s*/g, " ");
						const summaryText = args?.description ?? rawCmd ?? undefined;

						if (options.isPartial) {
							const lineCount = outputText.split("\n").filter(l => l.trim().length > 0).length;
							const line = renderStatusLine(
								{
									title: "Bash",
									description: summaryText,
									meta: lineCount > 0 ? [`${lineCount} lines`] : undefined,
								},
								uiTheme,
							);
							return [truncateToWidth(line, width)];
						}

						const line = renderStatusLine(
							{
								title: "Bash",
								description: summaryText,
							},
							uiTheme,
						);
						return [truncateToWidth(line, width)];
					}
				}

				const previewLines = renderContext?.previewLines ?? BASH_DEFAULT_PREVIEW_LINES;

				// Get output from context (preferred) or fall back to result content
				const output = renderContext?.output ?? result.content?.find(c => c.type === "text")?.text ?? "";
				const displayOutput = output.trimEnd();
				const showingFullOutput = expanded && renderContext?.isFullOutput === true;

				const rawOutputLines = displayOutput.split("\n");
				const sixelLineMask =
					TERMINAL.imageProtocol === ImageProtocol.Sixel ? getImageLineMask(rawOutputLines) : undefined;
				const hasSixelOutput = sixelLineMask?.some(Boolean) ?? false;

				// Build truncation warning
				const timeoutSeconds = details?.timeoutSeconds ?? renderContext?.timeout;
				const timeoutLine =
					typeof timeoutSeconds === "number"
						? uiTheme.fg(
								"dim",
								`${uiTheme.format.bracketLeft}Timeout: ${timeoutSeconds}s${uiTheme.format.bracketRight}`,
							)
						: undefined;
				let warningLine: string | undefined;
				if (details?.meta?.truncation && !showingFullOutput) {
					warningLine = formatStyledTruncationWarning(details.meta, uiTheme) ?? undefined;
				}

				const outputLines: string[] = [];
				const hasOutput = displayOutput.trim().length > 0;
				if (hasOutput) {
					if (hasSixelOutput) {
						outputLines.push(
							...rawOutputLines.map((line, index) =>
								sixelLineMask?.[index] ? line : uiTheme.fg("toolOutput", replaceTabs(line)),
							),
						);
					} else if (expanded) {
						outputLines.push(...rawOutputLines.map(line => uiTheme.fg("toolOutput", replaceTabs(line))));
					} else {
						const styledOutput = rawOutputLines
							.map(line => uiTheme.fg("toolOutput", replaceTabs(line)))
							.join("\n");
						const textContent = styledOutput;
						const result = truncateToVisualLines(textContent, previewLines, width);
						if (result.skippedCount > 0) {
							outputLines.push(
								uiTheme.fg(
									"dim",
									`… (${result.skippedCount} earlier lines, showing ${result.visualLines.length} of ${result.skippedCount + result.visualLines.length}) (ctrl+o to expand)`,
								),
							);
						}
						outputLines.push(...result.visualLines);
					}
				}
				if (timeoutLine) outputLines.push(timeoutLine);
				if (warningLine) outputLines.push(warningLine);

				return outputBlock.render(
					{
						header,
						state: options.isPartial ? "pending" : isError ? "error" : "success",
						sections: [
							{ lines: cmdText ? [uiTheme.fg("dim", cmdText)] : [] },
							{ label: uiTheme.fg("toolTitle", "Output"), lines: outputLines },
						],
						width,
					},
					uiTheme,
				);
			},
			invalidate: () => {
				outputBlock.invalidate();
			},
		};
	},
	mergeCallAndResult: true,
	inline: true,
};
