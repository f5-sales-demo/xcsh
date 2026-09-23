import personAwarenessTemplate from "./prompts/system/person-awareness.md" with { type: "text" };
/**
 * System prompt construction and project context loading
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool } from "@f5-sales-demo/pi-agent-core";
import {
	$env,
	getGpuCachePath,
	getProjectDir,
	hasFsCode,
	isEnoent,
	logger,
	prompt,
	withTimeout,
} from "@f5-sales-demo/pi-utils";
import { contextFileCapability } from "./capability/context-file";
import { systemPromptCapability } from "./capability/system-prompt";
import type { SkillsSettings } from "./config/settings";
import type { ContextComponentProfile } from "./context/profile";
import { renderDeprecationGuardrails } from "./deprecations";
import { type ContextFile, loadCapability, type SystemPrompt as SystemPromptFile } from "./discovery";
import { getXcshPluginCacheGeneration, loadXcshPluginSummaries, type XcshPluginSummary } from "./discovery/helpers";
import { defaultStartFolderDeps, resolveStartFolder, type StartFolder } from "./discovery/start-folder";
import { isApplicableToContext, loadSkills, type Skill, type SkillWarning } from "./extensibility/skills";
import customSystemPromptTemplate from "./prompts/system/custom-system-prompt.md" with { type: "text" };
import progressiveSystemPromptTemplate from "./prompts/system/progressive-system-prompt.md" with { type: "text" };
import startFolderTemplate from "./prompts/system/start-folder.md" with { type: "text" };
import systemPromptTemplate from "./prompts/system/system-prompt.md" with { type: "text" };
import workspaceBoundaryTemplate from "./prompts/system/workspace-boundary.md" with { type: "text" };

/** Sentinel in system-prompt.md replaced with the rendered deprecation guardrails. */
const DEPRECATION_GUARDRAILS_MARKER = "%%DEPRECATION_GUARDRAILS%%";
const WORKSPACE_BOUNDARY_MARKER = "%%WORKSPACE_BOUNDARY%%";
const START_FOLDER_MARKER = "%%START_FOLDER%%";
/** Baseline registry used only when prompt construction runs without a concrete tool map. */
const DEFAULT_SYSTEM_PROMPT_TOOL_NAMES = ["read", "bash", "python", "edit", "write"] as const;

let _buildMeta: { version: string; repoSlug: string } | null = null;

function getBuildMeta(): { version: string; repoSlug: string } {
	if (_buildMeta) return _buildMeta;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("./internal-urls/build-info.generated");
		_buildMeta = {
			version: mod.BUILD_INFO?.version ?? "unknown",
			repoSlug: mod.BUILD_INFO?.repoSlug ?? "unknown",
		};
	} catch {
		_buildMeta = { version: "unknown", repoSlug: "unknown" };
	}
	return _buildMeta;
}
interface AlwaysApplyRule {
	name: string;
	content: string;
	path: string;
}

function normalizePromptBlock(content: string): string {
	return prompt.format(content, { renderPhase: "post-render" }).trim();
}

function splitComparablePromptBlocks(content: string | null | undefined): string[] {
	const normalized = firstNonEmpty(content);
	if (!normalized) return [];

	return normalizePromptBlock(normalized)
		.split(/\n{2,}/)
		.map(block => block.trim())
		.filter(block => block.length > 0);
}

function promptSourceContainsRule(source: string | null | undefined, ruleContent: string): boolean {
	const sourceBlocks = splitComparablePromptBlocks(source);
	const ruleBlocks = splitComparablePromptBlocks(ruleContent);
	if (sourceBlocks.length === 0 || ruleBlocks.length === 0 || ruleBlocks.length > sourceBlocks.length) return false;

	for (let start = 0; start <= sourceBlocks.length - ruleBlocks.length; start += 1) {
		if (ruleBlocks.every((block, offset) => sourceBlocks[start + offset] === block)) return true;
	}

	return false;
}

function dedupeAlwaysApplyRules(
	alwaysApplyRules: AlwaysApplyRule[] | undefined,
	promptSources: Array<string | null | undefined>,
): AlwaysApplyRule[] {
	if (!alwaysApplyRules || alwaysApplyRules.length === 0) return [];

	return alwaysApplyRules.filter(
		rule => !promptSources.some(source => promptSourceContainsRule(source, rule.content)),
	);
}

function dedupePromptSource(source: string | null | undefined, otherSources: Array<string | null | undefined>): string {
	const resolvedSource = firstNonEmpty(source);
	if (!resolvedSource) return "";

	return otherSources.some(otherSource => promptSourceContainsRule(otherSource, resolvedSource)) ? "" : resolvedSource;
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

function parseWmicTable(output: string, header: string): string | null {
	const lines = output
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const filtered = lines.filter(line => line.toLowerCase() !== header.toLowerCase());
	return filtered[0] ?? null;
}

const AGENTS_MD_MIN_DEPTH = 1;
const AGENTS_MD_MAX_DEPTH = 4;
const AGENTS_MD_LIMIT = 200;
const SYSTEM_PROMPT_PREP_TIMEOUT_MS = 5000;
/** Bound on the two git probes behind the start-folder block. */
const START_FOLDER_TIMEOUT_MS = 1500;

/**
 * The start folder's kind, or the restrictive answer.
 *
 * `resolveStartFolder` already swallows probe failures, so this adds only the deadline: a
 * git call on a slow or enormous repository must not hold up the prompt. Expiry resolves to
 * `plain`, which withholds GitHub scope — the safe direction, since the cost of being wrong
 * that way is a missing suggestion rather than a secret pushed to a hosted repository.
 */
async function resolveStartFolderBounded(cwd: string, signal?: AbortSignal): Promise<StartFolder> {
	// `withTimeout` only rejects its own wrapper, so without this the git subprocesses keep
	// running after the fallback — and the prompt is rebuilt many times per session, so they
	// would accumulate. Aborting on expiry lets the git layer tear its child down.
	const controller = new AbortController();
	const abortFromCaller = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", abortFromCaller, { once: true });
	try {
		signal?.throwIfAborted();
		return await withTimeout(
			resolveStartFolder(cwd, defaultStartFolderDeps, controller.signal),
			START_FOLDER_TIMEOUT_MS,
			"start-folder probe timed out",
		);
	} catch {
		controller.abort();
		if (signal?.aborted) throw signal.reason;
		return { kind: "plain" };
	} finally {
		signal?.removeEventListener("abort", abortFromCaller);
	}
}
// The walk's `limit` caps DISCOVERED files, not directories VISITED — so a dir
// with ~no XCSH.md (e.g. serving from $HOME) would otherwise traverse the entire
// tree to AGENTS_MD_MAX_DEPTH and stall prep. These bound the traversal itself:
// a directory-visit budget AND a wall-clock deadline, both well inside the 5s
// prep timeout, so discovery stays fast regardless of how few matches exist.
const AGENTS_MD_MAX_DIRS = 4000;
const AGENTS_MD_WALK_BUDGET_MS = 1500;
const AGENTS_MD_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

/** A cited context-file search result (the nested XCSH.md files under the cwd). */
export interface AgentsMdSearch {
	scopePath: string;
	limit: number;
	pattern: string;
	files: string[];
}

/** Reads one directory. Injectable so tests can simulate a readdir that never settles. */
type ReaddirFn = (dir: string) => Promise<fs.Dirent[]>;

/** Mutable traversal budget + the reader, shared across the recursive walk. */
interface WalkContext {
	readonly maxDirs: number;
	readonly deadline: number;
	readonly readdir: ReaddirFn;
	readonly signal?: AbortSignal;
	dirsVisited: number;
}

/**
 * Read one directory, giving up when the walk's deadline passes.
 *
 * The budget checks between directories are NOT enough on their own: a `readdir`
 * that never settles — a TCC-protected or cloud-synced directory such as
 * ~/Documents on a managed Mac — would park the walk forever at zero CPU, hanging
 * `createAgentSession` and with it the Office pane's `set_host_tools` (#2399). The
 * deadline has to be enforced HERE, around the syscall itself.
 *
 * Returns null when the directory could not be read in time (or at all); the
 * caller treats that as "nothing here" and moves on.
 *
 * The abandoned read keeps a thread-pool slot until the OS releases it. That is
 * bounded by the number of pathological directories and is strictly better than
 * never returning.
 */
async function readdirWithinBudget(dir: string, ctx: WalkContext): Promise<fs.Dirent[] | null> {
	ctx.signal?.throwIfAborted();
	const remaining = ctx.deadline - Date.now();
	if (remaining <= 0) return null;
	// `withTimeout` rejects on expiry and clears its own timer; here expiry is an
	// ordinary outcome, so both it and a real read failure collapse to null — the
	// caller treats either as "nothing here".
	const read = withTimeout(ctx.readdir(dir), remaining, `readdir exceeded the walk budget: ${dir}`);
	if (!ctx.signal) return await read.catch(() => null);
	let abortHandler: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		abortHandler = () => reject(ctx.signal?.reason);
		ctx.signal?.addEventListener("abort", abortHandler, { once: true });
	});
	try {
		return await Promise.race([read, aborted]).catch(error => {
			if (ctx.signal?.aborted) throw error;
			return null;
		});
	} finally {
		if (abortHandler) ctx.signal.removeEventListener("abort", abortHandler);
	}
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function shouldSkipAgentsDir(name: string): boolean {
	if (AGENTS_MD_EXCLUDED_DIRS.has(name)) return true;
	return name.startsWith(".");
}

async function collectAgentsMdFiles(
	root: string,
	dir: string,
	depth: number,
	limit: number,
	maxDepth: number,
	discovered: Set<string>,
	budget: WalkContext,
): Promise<void> {
	// Stop on any bound: depth, enough matches, the directory-visit budget, or the
	// wall-clock deadline. The last two keep a match-poor tree (e.g. $HOME) bounded.
	if (
		depth > maxDepth ||
		discovered.size >= limit ||
		budget.dirsVisited >= budget.maxDirs ||
		Date.now() >= budget.deadline
	) {
		return;
	}
	// Reserve this directory's slot SYNCHRONOUSLY (before the readdir await) so a
	// concurrent Promise.all fan-out can't blow past the budget: every scheduled
	// sibling sees the updated count before it yields, making the cap effectively hard.
	budget.dirsVisited++;

	// Deadline-guarded: a directory that never answers must not park the whole walk.
	const entries = await readdirWithinBudget(dir, budget);
	if (!entries) return;

	if (depth >= AGENTS_MD_MIN_DEPTH) {
		const hasAgentsMd = entries.some(entry => entry.isFile() && entry.name === "XCSH.md");
		if (hasAgentsMd) {
			const relPath = normalizePath(path.relative(root, path.join(dir, "XCSH.md")));
			if (relPath.length > 0) {
				discovered.add(relPath);
			}
			if (discovered.size >= limit) {
				return;
			}
		}
	}

	if (depth === maxDepth) {
		return;
	}

	const childDirs = entries
		.filter(entry => entry.isDirectory() && !shouldSkipAgentsDir(entry.name))
		.map(entry => entry.name)
		.sort();

	await Promise.all(
		childDirs.map(async child => {
			if (discovered.size >= limit || budget.dirsVisited >= budget.maxDirs || Date.now() >= budget.deadline) return;
			await collectAgentsMdFiles(root, path.join(dir, child), depth + 1, limit, maxDepth, discovered, budget);
		}),
	);
}

/** Options for {@link discoverAgentsMdFiles} (all bounded by defaults). */
export interface DiscoverAgentsMdOptions {
	limit?: number;
	maxDepth?: number;
	maxDirs?: number;
	budgetMs?: number;
	/** Directory reader; defaults to `fs.promises.readdir`. A test seam for
	 *  simulating a filesystem that never answers. */
	readdir?: ReaddirFn;
	/** Cancellation for prompt preparation. */
	signal?: AbortSignal;
}

/**
 * Walk `root` (bounded by depth, match-limit, directory budget, and a wall-clock
 * deadline) collecting nested `XCSH.md` paths. Returns the sorted matches plus the
 * number of directories visited (for observability/tests). Never throws.
 *
 * The deadline is PREEMPTIVE: it bounds each `readdir` as well as the walk as a
 * whole, so a directory that never answers cannot stall startup (#2399).
 */
export async function discoverAgentsMdFiles(
	root: string,
	opts: DiscoverAgentsMdOptions = {},
): Promise<{ files: string[]; dirsVisited: number }> {
	const limit = opts.limit ?? AGENTS_MD_LIMIT;
	const maxDepth = opts.maxDepth ?? AGENTS_MD_MAX_DEPTH;
	const ctx: WalkContext = {
		maxDirs: opts.maxDirs ?? AGENTS_MD_MAX_DIRS,
		deadline: Date.now() + (opts.budgetMs ?? AGENTS_MD_WALK_BUDGET_MS),
		readdir: opts.readdir ?? ((dir: string) => fs.promises.readdir(dir, { withFileTypes: true })),
		signal: opts.signal,
		dirsVisited: 0,
	};
	try {
		const discovered = new Set<string>();
		await collectAgentsMdFiles(root, root, 0, limit, maxDepth, discovered, ctx);
		return { files: Array.from(discovered).sort().slice(0, limit), dirsVisited: ctx.dirsVisited };
	} catch (error) {
		if (opts.signal?.aborted) throw error;
		return { files: [], dirsVisited: ctx.dirsVisited };
	}
}

export async function buildAgentsMdSearch(cwd: string, signal?: AbortSignal): Promise<AgentsMdSearch> {
	const { files } = await discoverAgentsMdFiles(cwd, { signal });
	return {
		scopePath: ".",
		limit: AGENTS_MD_LIMIT,
		pattern: `XCSH.md depth ${AGENTS_MD_MIN_DEPTH}-${AGENTS_MD_MAX_DEPTH}`,
		files,
	};
}

async function runGpuProbe(command: string[], signal?: AbortSignal): Promise<string | null> {
	signal?.throwIfAborted();
	try {
		const child = Bun.spawn(command, {
			signal,
			killSignal: "SIGKILL",
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		signal?.throwIfAborted();
		return exitCode === 0 ? output : null;
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		return null;
	}
}

async function getGpuModel(signal?: AbortSignal): Promise<string | null> {
	switch (process.platform) {
		case "win32": {
			const output = await runGpuProbe(["wmic", "path", "win32_VideoController", "get", "name"], signal);
			return output ? parseWmicTable(output, "Name") : null;
		}
		case "linux": {
			const output = await runGpuProbe(["lspci"], signal);
			if (!output) return null;
			const gpus: Array<{ name: string; priority: number }> = [];
			for (const line of output.split("\n")) {
				if (!/(VGA|3D|Display)/i.test(line)) continue;
				const parts = line.split(":");
				const name = parts.length > 1 ? parts.slice(1).join(":").trim() : line.trim();
				const nameLower = name.toLowerCase();
				// Skip BMC/server management adapters
				if (/aspeed|matrox g200|mgag200/i.test(name)) continue;
				// Prioritize discrete GPUs
				let priority = 0;
				if (
					nameLower.includes("nvidia") ||
					nameLower.includes("geforce") ||
					nameLower.includes("quadro") ||
					nameLower.includes("rtx")
				) {
					priority = 3;
				} else if (nameLower.includes("amd") || nameLower.includes("radeon") || nameLower.includes("rx ")) {
					priority = 3;
				} else if (nameLower.includes("intel")) {
					priority = 1;
				} else {
					priority = 2;
				}
				gpus.push({ name, priority });
			}
			if (gpus.length === 0) return null;
			gpus.sort((a, b) => b.priority - a.priority);
			return gpus[0].name;
		}
		default:
			return null;
	}
}

function getTerminalName(): string | undefined {
	const termProgram = Bun.env.TERM_PROGRAM;
	const termProgramVersion = Bun.env.TERM_PROGRAM_VERSION;
	if (termProgram) {
		return termProgramVersion ? `${termProgram} ${termProgramVersion}` : termProgram;
	}

	if (Bun.env.WT_SESSION) return "Windows Terminal";

	const term = firstNonEmpty(Bun.env.TERM, Bun.env.COLORTERM, Bun.env.TERMINAL_EMULATOR);
	return term ?? undefined;
}

/** Cached system info structure */
interface GpuCache {
	gpu: string;
}

function getSystemInfoCachePath(): string {
	return getGpuCachePath();
}

async function loadGpuCache(signal?: AbortSignal): Promise<GpuCache | null> {
	try {
		const cachePath = getSystemInfoCachePath();
		const content = await fs.promises.readFile(cachePath, { encoding: "utf8", signal });
		return JSON.parse(content) as GpuCache;
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		return null;
	}
}

async function saveGpuCache(info: GpuCache, signal?: AbortSignal): Promise<void> {
	try {
		const cachePath = getSystemInfoCachePath();
		await fs.promises.writeFile(cachePath, JSON.stringify(info, null, "\t"), { signal });
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		// Silently ignore cache write failures
	}
}

async function getCachedGpu(signal?: AbortSignal): Promise<string | undefined> {
	const cached = await logger.time("getCachedGpu:loadGpuCache", loadGpuCache, signal);
	if (cached) return cached.gpu;
	const gpu = await logger.time("getCachedGpu:getGpuModel", getGpuModel, signal);
	if (gpu) {
		await logger.time("getCachedGpu:saveGpuCache", saveGpuCache, { gpu }, signal);
	}
	return gpu ?? undefined;
}
async function getEnvironmentInfo(signal?: AbortSignal): Promise<Array<{ label: string; value: string }>> {
	const gpu = await getCachedGpu(signal);
	const cpus = os.cpus();
	const build = getBuildMeta();
	const entries: Array<{ label: string; value: string | undefined }> = [
		{ label: "xcsh", value: `v${build.version} (${build.repoSlug})` },
		{ label: "OS", value: `${os.platform()} ${os.release()}` },
		{ label: "Distro", value: os.type() },
		{ label: "Kernel", value: os.version() },
		{ label: "Arch", value: os.arch() },
		{ label: "CPU", value: `${cpus[0]?.model}` },
		{ label: "GPU", value: gpu },
		{ label: "Terminal", value: getTerminalName() },
	];
	return entries.filter((e): e is { label: string; value: string } => !!e.value);
}

/** Resolve input as file path or literal string */
export async function resolvePromptInput(
	input: string | undefined,
	description: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (!input) {
		return undefined;
	} else if (input.includes("\n")) {
		return input;
	}

	try {
		signal?.throwIfAborted();
		const stat = await fs.promises.stat(input);
		if (!stat.isFile()) throw new Error(`${description} source is not a regular file`);
		return await fs.promises.readFile(input, { encoding: "utf8", signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		if (!hasFsCode(error, "ENAMETOOLONG") && !isEnoent(error)) {
			throw error;
		}
		return input;
	}
}

export interface LoadContextFilesOptions {
	/** Working directory to start walking up from. Default: getProjectDir() */
	cwd?: string;
	/**
	 * Explicit disabled extension IDs to apply instead of the global settings default.
	 * Pass `[]` to force discovery independent of any process-wide settings state.
	 */
	disabledExtensions?: string[];
	/** Cancellation for bounded prompt preparation. */
	signal?: AbortSignal;
}

function dedupeExactContextFiles(
	contextFiles: Array<{ path: string; content: string; depth?: number }>,
): Array<{ path: string; content: string; depth?: number }> {
	const lastIndexByContent = new Map<string, number>();
	for (const [index, file] of contextFiles.entries()) {
		// Keep the closest matching context entry when content is byte-for-byte identical.
		lastIndexByContent.set(file.content, index);
	}

	return contextFiles.filter((file, index) => lastIndexByContent.get(file.content) === index);
}

/**
 * Load all project context files using the capability API.
 * Returns {path, content, depth} entries for all discovered context files.
 * Files are sorted by depth (descending) so files closer to cwd appear last/more prominent.
 */
export async function loadProjectContextFiles(
	options: LoadContextFilesOptions = {},
): Promise<Array<{ path: string; content: string; depth?: number }>> {
	const resolvedCwd = options.cwd ?? getProjectDir();

	const result = await loadCapability(contextFileCapability.id, {
		cwd: resolvedCwd,
		disabledExtensions: options.disabledExtensions,
		signal: options.signal,
	});

	// Convert ContextFile items and preserve depth info
	const files = result.items.map(item => {
		const contextFile = item as ContextFile;
		return {
			path: contextFile.path,
			content: contextFile.content,
			depth: contextFile.depth,
		};
	});

	// Sort by depth (descending): higher depth (farther from cwd) comes first,
	// so files closer to cwd appear later and are more prominent
	files.sort((a, b) => {
		const depthA = a.depth ?? -1;
		const depthB = b.depth ?? -1;
		return depthB - depthA;
	});

	return dedupeExactContextFiles(files);
}

/**
 * Load the effective system prompt customization from SYSTEM.md.
 * Project-level SYSTEM.md overrides user-level SYSTEM.md.
 */
export async function loadSystemPromptFiles(options: LoadContextFilesOptions = {}): Promise<string | null> {
	const resolvedCwd = options.cwd ?? getProjectDir();

	const result = await loadCapability<SystemPromptFile>(systemPromptCapability.id, {
		cwd: resolvedCwd,
		signal: options.signal,
	});

	if (result.items.length === 0) return null;

	const projectLevel = result.items.find(item => item.level === "project");
	if (projectLevel) {
		return projectLevel.content;
	}

	const userLevel = result.items.find(item => item.level === "user");
	return userLevel?.content ?? null;
}

export interface SystemPromptToolMetadata {
	label: string;
	description: string;
}

export function buildSystemPromptToolMetadata(
	tools: Map<string, AgentTool>,
	overrides: Partial<Record<string, Partial<SystemPromptToolMetadata>>> = {},
): Map<string, SystemPromptToolMetadata> {
	return new Map(
		Array.from(tools.entries(), ([name, tool]) => {
			const toolRecord = tool as AgentTool & { label?: string; description?: string };
			const override = overrides[name];
			return [
				name,
				{
					label: override?.label ?? (typeof toolRecord.label === "string" ? toolRecord.label : ""),
					description:
						override?.description ?? (typeof toolRecord.description === "string" ? toolRecord.description : ""),
				},
			] as const;
		}),
	);
}

export interface BuildSystemPromptOptions {
	/** Context-loading policy. Direct prompt-builder callers default to eager compatibility. */
	loadingMode?: "eager" | "progressive";
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. */
	tools?: Map<string, SystemPromptToolMetadata>;
	/** Tool names to include in prompt. */
	toolNames?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Repeat full tool descriptions in system prompt. Default: false */
	repeatToolDescriptions?: boolean;
	/** Skills settings for discovery. */
	skillsSettings?: SkillsSettings;
	/** Working directory. Default: getProjectDir() */
	cwd?: string;
	/** Pre-loaded context files (skips discovery if provided). */
	contextFiles?: Array<{ path: string; content: string; depth?: number }>;
	/** Pre-computed nested-XCSH.md search (skips the CWD walk if provided). Hoisted
	 *  once per session so tool-refresh rebuilds never re-walk the tree. */
	agentsMdSearch?: AgentsMdSearch;
	/** Pre-resolved start-folder kind (skips the git probes). Supplied by tests and by
	 *  callers that already know, e.g. an SDK embedder. */
	startFolder?: StartFolder;
	/**
	 * Explicit disabled extension IDs applied to context-file discovery instead of the
	 * global settings default. Pass `[]` to discover independent of process-wide settings.
	 */
	disabledExtensions?: string[];
	/** Skills provided directly to system prompt construction. */
	skills?: Skill[];
	/** Pre-loaded rulebook rules (descriptions, excluding TTSR and always-apply). */
	rules?: Array<{ name: string; description?: string; path: string; globs?: string[] }>;
	/** Intent field name injected into every tool schema. If set, explains the field in the prompt. */
	intentField?: string;
	/** Whether MCP tool discovery is active for this prompt build. */
	mcpDiscoveryMode?: boolean;
	/** Discoverable MCP server summaries to advertise when discovery mode is active. */
	mcpDiscoveryServerSummaries?: string[];
	/** Encourage the agent to delegate via tasks unless changes are trivial. */
	eagerTasks?: boolean;
	/** Rules with alwaysApply=true — their full content is injected into the prompt. */
	alwaysApplyRules?: AlwaysApplyRule[];
	/** Whether secret obfuscation is active. When true, explains the redaction format in the prompt. */
	secretsEnabled?: boolean;
	/** Active F5 XC context for the `{{#if context}}` template block. Omit when no context is active. */
	context?: {
		tenant: string;
		namespace: string;
		credentialSource: string;
		authStatus: string;
	};
	/** Locale for LLM response language. When set and non-English, a `<language>` block is injected into the system prompt. */
	locale?: { code: string; name: string };
	knowledgeTopics?: string;
	contextSkillDirs?: string[];
	contextIncludeSkills?: string[];
	contextExcludeSkills?: string[];
	/** Transform the fully rendered default prompt before mandatory blocks are enforced again. */
	transformPrompt?: (defaultPrompt: string) => string;
	/** Numeric-only attribution sink; labels are generated categories, never source paths or content. */
	onProfileComponents?: (components: ContextComponentProfile[]) => void;
}

export type SystemPromptPreparationOutcome = "completed" | "provided" | "cached" | "failed" | "timed_out" | "aborted";

export type SystemPromptPreparationStageName =
	| "custom_prompt"
	| "append_prompt"
	| "system_prompt"
	| "context_files"
	| "agents_index"
	| "skills"
	| "plugin_summaries"
	| "environment"
	| "start_folder";

export interface SystemPromptPreparationStage {
	readonly name: SystemPromptPreparationStageName;
	readonly outcome: SystemPromptPreparationOutcome;
	readonly durationMs: number;
}

export interface SystemPromptPreparationDiagnostic {
	readonly timeoutMs: number;
	readonly elapsedMs: number;
	readonly stages: readonly SystemPromptPreparationStage[];
}

export interface PreparedSystemPromptInputs {
	readonly cwd: string;
	readonly resolvedCustomPrompt?: string;
	readonly resolvedAppendPrompt?: string;
	readonly systemPromptCustomization: string | null;
	readonly contextFiles: ReadonlyArray<{ path: string; content: string; depth?: number }>;
	readonly agentsMdSearch: Readonly<Omit<AgentsMdSearch, "files"> & { files: readonly string[] }>;
	readonly skills: readonly Skill[];
	readonly skillWarnings: readonly SkillWarning[];
	readonly pluginSummaries: readonly XcshPluginSummary[];
	readonly pluginCacheGeneration: number;
	readonly environment: ReadonlyArray<{ label: string; value: string }>;
	readonly startFolder: StartFolder;
	readonly stages: readonly SystemPromptPreparationStage[];
}

export interface PrepareSystemPromptInputsOptions
	extends Pick<
		BuildSystemPromptOptions,
		| "customPrompt"
		| "appendSystemPrompt"
		| "skillsSettings"
		| "cwd"
		| "contextFiles"
		| "agentsMdSearch"
		| "startFolder"
		| "disabledExtensions"
		| "skills"
		| "contextSkillDirs"
		| "contextIncludeSkills"
		| "contextExcludeSkills"
	> {
	timeoutMs?: number;
	signal?: AbortSignal;
	onDiagnostic?: (diagnostic: SystemPromptPreparationDiagnostic) => void;
}

export interface SystemPromptPreparationDependencies {
	resolvePromptInput: (
		input: string | undefined,
		description: string,
		signal: AbortSignal,
	) => Promise<string | undefined>;
	loadSystemPromptFiles: (signal: AbortSignal) => Promise<string | null>;
	loadProjectContextFiles: (signal: AbortSignal) => Promise<Array<{ path: string; content: string; depth?: number }>>;
	buildAgentsMdSearch: (signal: AbortSignal) => Promise<AgentsMdSearch>;
	loadSkills: (signal: AbortSignal) => Promise<{ skills: Skill[]; warnings: SkillWarning[] }>;
	loadPluginSummaries: (
		signal: AbortSignal,
	) => Promise<{ summaries: XcshPluginSummary[]; cacheStatus: "completed" | "cached"; generation?: number }>;
	getEnvironmentInfo: (signal: AbortSignal) => Promise<Array<{ label: string; value: string }>>;
	resolveStartFolder: (signal: AbortSignal) => Promise<StartFolder>;
}

function durationSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 100) / 100;
}

/** Collect immutable prompt inputs once while retaining independently completed stages. */
export async function prepareSystemPromptInputs(
	options: PrepareSystemPromptInputsOptions = {},
	dependencyOverrides: Partial<SystemPromptPreparationDependencies> = {},
): Promise<PreparedSystemPromptInputs> {
	const resolvedCwd = path.resolve(options.cwd ?? getProjectDir());
	const timeoutMs = options.timeoutMs ?? SYSTEM_PROMPT_PREP_TIMEOUT_MS;
	const mergedSkillsSettings = {
		...options.skillsSettings,
		customDirectories: [...(options.skillsSettings?.customDirectories ?? []), ...(options.contextSkillDirs ?? [])],
		includeSkills: [...(options.skillsSettings?.includeSkills ?? []), ...(options.contextIncludeSkills ?? [])],
		ignoredSkills: [...(options.skillsSettings?.ignoredSkills ?? []), ...(options.contextExcludeSkills ?? [])],
	};
	const dependencies: SystemPromptPreparationDependencies = {
		resolvePromptInput,
		loadSystemPromptFiles: signal => loadSystemPromptFiles({ cwd: resolvedCwd, signal }),
		loadProjectContextFiles: signal =>
			loadProjectContextFiles({ cwd: resolvedCwd, disabledExtensions: options.disabledExtensions, signal }),
		buildAgentsMdSearch: signal => buildAgentsMdSearch(resolvedCwd, signal),
		loadSkills: signal =>
			mergedSkillsSettings.enabled === false
				? Promise.resolve({ skills: [], warnings: [] })
				: loadSkills({ ...mergedSkillsSettings, cwd: resolvedCwd, signal }),
		loadPluginSummaries: signal => loadXcshPluginSummaries(os.homedir(), resolvedCwd, signal),
		getEnvironmentInfo,
		resolveStartFolder: signal => resolveStartFolderBounded(resolvedCwd, signal),
		...dependencyOverrides,
	};

	const controller = new AbortController();
	const values: {
		resolvedCustomPrompt?: string;
		resolvedAppendPrompt?: string;
		systemPromptCustomization: string | null;
		contextFiles: Array<{ path: string; content: string; depth?: number }>;
		agentsMdSearch: AgentsMdSearch;
		skills: Skill[];
		skillWarnings: SkillWarning[];
		pluginSummaries: XcshPluginSummary[];
		pluginCacheGeneration: number;
		environment: Array<{ label: string; value: string }>;
		startFolder: StartFolder;
	} = {
		systemPromptCustomization: null,
		contextFiles: dedupeExactContextFiles(options.contextFiles ?? []),
		agentsMdSearch: options.agentsMdSearch ?? {
			scopePath: ".",
			limit: AGENTS_MD_LIMIT,
			pattern: `XCSH.md depth ${AGENTS_MD_MIN_DEPTH}-${AGENTS_MD_MAX_DEPTH}`,
			files: [],
		},
		skills: options.skills ?? [],
		skillWarnings: [],
		pluginSummaries: [],
		pluginCacheGeneration: getXcshPluginCacheGeneration(),
		environment: [],
		startFolder: options.startFolder ?? { kind: "plain" },
	};
	const stageOrder: SystemPromptPreparationStageName[] = [
		"custom_prompt",
		"append_prompt",
		"system_prompt",
		"context_files",
		"agents_index",
		"skills",
		"plugin_summaries",
		"environment",
		"start_folder",
	];
	const stageStates = new Map<
		SystemPromptPreparationStageName,
		{ startedAt: number; outcome?: SystemPromptPreparationOutcome; durationMs?: number }
	>();
	for (const name of stageOrder) stageStates.set(name, { startedAt: performance.now() });
	const finishStage = (
		name: SystemPromptPreparationStageName,
		outcome: SystemPromptPreparationOutcome,
		startedAt: number,
	): boolean => {
		const current = stageStates.get(name);
		if (!current || current.outcome) return false;
		current.outcome = outcome;
		current.durationMs = durationSince(startedAt);
		return true;
	};
	const run = <T>(
		name: SystemPromptPreparationStageName,
		loader: () => Promise<T>,
		apply: (value: T) => void,
		provided = false,
		outcome: (value: T) => SystemPromptPreparationOutcome = () => (provided ? "provided" : "completed"),
	): Promise<void> => {
		const startedAt = performance.now();
		stageStates.set(name, { startedAt });
		return loader().then(
			value => {
				if (!finishStage(name, outcome(value), startedAt)) return;
				apply(value);
			},
			() => {
				finishStage(name, controller.signal.aborted ? "aborted" : "failed", startedAt);
			},
		);
	};

	const work = [
		run(
			"custom_prompt",
			() => dependencies.resolvePromptInput(options.customPrompt, "system prompt", controller.signal),
			value => {
				values.resolvedCustomPrompt = value;
			},
		),
		run(
			"append_prompt",
			() => dependencies.resolvePromptInput(options.appendSystemPrompt, "append system prompt", controller.signal),
			value => {
				values.resolvedAppendPrompt = value;
			},
		),
		run(
			"system_prompt",
			() => dependencies.loadSystemPromptFiles(controller.signal),
			value => {
				values.systemPromptCustomization = value;
			},
		),
		run(
			"context_files",
			() =>
				options.contextFiles !== undefined
					? Promise.resolve(options.contextFiles)
					: dependencies.loadProjectContextFiles(controller.signal),
			value => {
				values.contextFiles = dedupeExactContextFiles(value);
			},
			options.contextFiles !== undefined,
		),
		run(
			"agents_index",
			() =>
				options.agentsMdSearch !== undefined
					? Promise.resolve(options.agentsMdSearch)
					: dependencies.buildAgentsMdSearch(controller.signal),
			value => {
				values.agentsMdSearch = value;
			},
			options.agentsMdSearch !== undefined,
		),
		run(
			"skills",
			() =>
				options.skills !== undefined
					? Promise.resolve({ skills: options.skills, warnings: [] })
					: dependencies.loadSkills(controller.signal),
			value => {
				values.skills = value.skills;
				values.skillWarnings = value.warnings;
			},
			options.skills !== undefined,
		),
		run(
			"plugin_summaries",
			() => dependencies.loadPluginSummaries(controller.signal),
			value => {
				values.pluginSummaries = value.summaries;
				values.pluginCacheGeneration = value.generation ?? 0;
			},
			false,
			value => value.cacheStatus,
		),
		run(
			"environment",
			() => dependencies.getEnvironmentInfo(controller.signal),
			value => {
				values.environment = value;
			},
		),
		run(
			"start_folder",
			() =>
				options.startFolder !== undefined
					? Promise.resolve(options.startFolder)
					: dependencies.resolveStartFolder(controller.signal),
			value => {
				values.startFolder = value;
			},
			options.startFolder !== undefined,
		),
	];

	const startedAt = performance.now();
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let externalAbortHandler: (() => void) | undefined;
	const cutoff = new Promise<"timed_out" | "aborted">(resolve => {
		timeoutHandle = setTimeout(() => resolve("timed_out"), timeoutMs);
		if (options.signal) {
			externalAbortHandler = () => resolve("aborted");
			if (options.signal.aborted) externalAbortHandler();
			else options.signal.addEventListener("abort", externalAbortHandler, { once: true });
		}
	});
	const settled = await Promise.race([Promise.all(work).then(() => "completed" as const), cutoff]);
	if (settled !== "completed") {
		for (const stage of stageStates.values()) {
			if (!stage.outcome) {
				stage.outcome = settled;
				stage.durationMs = durationSince(stage.startedAt);
			}
		}
		controller.abort(options.signal?.reason ?? new Error("System prompt preparation deadline reached"));
	}
	if (timeoutHandle) clearTimeout(timeoutHandle);
	if (options.signal && externalAbortHandler) options.signal.removeEventListener("abort", externalAbortHandler);

	const stages = Object.freeze(
		stageOrder.map(name => {
			const state = stageStates.get(name)!;
			return Object.freeze({ name, outcome: state.outcome ?? "failed", durationMs: state.durationMs ?? 0 });
		}),
	);
	const diagnostic: SystemPromptPreparationDiagnostic = Object.freeze({
		timeoutMs,
		elapsedMs: durationSince(startedAt),
		stages,
	});
	options.onDiagnostic?.(diagnostic);
	const unfinished = stages.filter(stage => stage.outcome === "timed_out" || stage.outcome === "aborted");
	const failed = stages.filter(stage => stage.outcome === "failed");
	if (unfinished.length > 0 || failed.length > 0) {
		const incompleteStages = [...unfinished, ...failed].map(stage => stage.name).join(", ");
		logger.warn(
			`System prompt preparation incomplete for stages ${incompleteStages}; completed context was retained`,
			{ ...diagnostic },
		);
	} else {
		logger.debug("System prompt preparation completed", { ...diagnostic });
	}

	return Object.freeze({
		cwd: resolvedCwd,
		resolvedCustomPrompt: values.resolvedCustomPrompt,
		resolvedAppendPrompt: values.resolvedAppendPrompt,
		systemPromptCustomization: values.systemPromptCustomization,
		contextFiles: Object.freeze([...values.contextFiles]),
		agentsMdSearch: Object.freeze({
			...values.agentsMdSearch,
			files: Object.freeze([...values.agentsMdSearch.files]),
		}),
		skills: Object.freeze([...values.skills]),
		skillWarnings: Object.freeze([...values.skillWarnings]),
		pluginSummaries: Object.freeze([...values.pluginSummaries]),
		pluginCacheGeneration: values.pluginCacheGeneration,
		environment: Object.freeze([...values.environment]),
		startFolder: Object.freeze({ ...values.startFolder }),
		stages,
	});
}

export function assertPreparedSystemPromptCwd(snapshot: PreparedSystemPromptInputs, cwd: string): void {
	if (path.resolve(snapshot.cwd) !== path.resolve(cwd)) {
		throw new Error("Prepared system prompt inputs belong to a different working directory");
	}
}

export interface RenderSystemPromptOptions extends BuildSystemPromptOptions {
	/** Already resolved dynamic source. Presence overrides the prepared value, including with undefined. */
	resolvedCustomPrompt?: string;
	/** Already resolved dynamic append text. Presence overrides the prepared value, including with undefined. */
	resolvedAppendPrompt?: string;
}

/** Render a system prompt exclusively from a prepared snapshot and caller-provided dynamic values. */
export function renderSystemPrompt(
	prepared: PreparedSystemPromptInputs,
	options: RenderSystemPromptOptions = {},
): string {
	if ($env.NULL_PROMPT === "true") return "";
	assertPreparedSystemPromptCwd(prepared, options.cwd ?? prepared.cwd);
	const {
		loadingMode = "eager",
		tools,
		repeatToolDescriptions = false,
		toolNames: providedToolNames,
		rules,
		alwaysApplyRules,
		intentField,
		mcpDiscoveryMode = false,
		mcpDiscoveryServerSummaries = [],
		eagerTasks = false,
		secretsEnabled = false,
		context,
		transformPrompt,
	} = options;
	const resolvedCwd = prepared.cwd;
	const resolvedCustomPrompt = Object.hasOwn(options, "resolvedCustomPrompt")
		? options.resolvedCustomPrompt
		: prepared.resolvedCustomPrompt;
	const resolvedAppendPrompt = Object.hasOwn(options, "resolvedAppendPrompt")
		? options.resolvedAppendPrompt
		: prepared.resolvedAppendPrompt;
	const systemPromptCustomization = prepared.systemPromptCustomization;
	const contextFiles = prepared.contextFiles;
	const agentsMdSearch = prepared.agentsMdSearch;
	const skills = prepared.skills;
	const plugins = prepared.pluginSummaries;
	const hasPlugins = plugins.length > 0;

	const date = new Date().toISOString().slice(0, 10);
	const dateTime = date;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	// Build tool metadata for system prompt rendering
	// Priority: explicit list > tools map > defaults
	// Default includes both bash and python; actual availability determined by settings in createTools
	let toolNames = providedToolNames;
	if (!toolNames) {
		if (tools) {
			// Tools map provided
			toolNames = Array.from(tools.keys());
		} else {
			toolNames = [...DEFAULT_SYSTEM_PROMPT_TOOL_NAMES];
		}
	}

	// Build tool descriptions for system prompt rendering
	const toolInfo = toolNames.map(name => ({
		name,
		label: tools?.get(name)?.label ?? "",
		description: tools?.get(name)?.description ?? "",
	}));

	// Filter skills to only include those with read tool
	const hasRead = tools?.has("read");
	const filteredSkills = hasRead ? skills : [];

	// contexts values match the tenant label derived from the API URL hostname (first DNS label).
	// Example: https://example-corp.console.ves.volterra.io → tenant "example-corp" → contexts: ["example-corp"]
	const contextName = context?.tenant;
	const contextFilteredSkills = filteredSkills.filter(skill => {
		const isPluginSkill = skill._source?.provider === "xcsh-plugins" || skill.source.startsWith("xcsh-plugins:");
		return isApplicableToContext(skill, contextName) && (loadingMode === "eager" || !isPluginSkill);
	});
	options.onProfileComponents?.([
		...contextFiles.map((file, index) => ({
			category: "context_file" as const,
			label: `context_file_${index + 1}`,
			bytes: Buffer.byteLength(file.content, "utf8"),
			estimatedTokens: Math.ceil(Buffer.byteLength(file.content, "utf8") / 4),
		})),
		...contextFilteredSkills.map((skill, index) => ({
			category: "skill" as const,
			label: `skill_${index + 1}`,
			bytes: Buffer.byteLength(skill.description ?? "", "utf8"),
			estimatedTokens: Math.ceil(Buffer.byteLength(skill.description ?? "", "utf8") / 4),
		})),
		...plugins.map((plugin, index) => ({
			category: "plugin_catalog" as const,
			label: `plugin_${index + 1}`,
			bytes: Buffer.byteLength(`${plugin.name}\n${plugin.description}`, "utf8"),
			estimatedTokens: Math.ceil(Buffer.byteLength(`${plugin.name}\n${plugin.description}`, "utf8") / 4),
		})),
		...(rules ?? []).map((rule, index) => ({
			category: "rule" as const,
			label: `rule_${index + 1}`,
			bytes: Buffer.byteLength(rule.description ?? "", "utf8"),
			estimatedTokens: Math.ceil(Buffer.byteLength(rule.description ?? "", "utf8") / 4),
		})),
	]);

	const effectiveSystemPromptCustomization = dedupePromptSource(systemPromptCustomization, [
		resolvedCustomPrompt,
		resolvedAppendPrompt,
	]);
	const promptSources = [effectiveSystemPromptCustomization, resolvedCustomPrompt, resolvedAppendPrompt];
	const injectedAlwaysApplyRules = dedupeAlwaysApplyRules(alwaysApplyRules, promptSources);

	const environment = prepared.environment;
	const startFolder = prepared.startFolder;
	const data = {
		systemPromptCustomization: effectiveSystemPromptCustomization,
		customPrompt: resolvedCustomPrompt,
		appendPrompt: resolvedAppendPrompt ?? "",
		tools: toolNames,
		toolInfo,
		repeatToolDescriptions,
		environment,
		contextFiles,
		agentsMdSearch,
		skills: contextFilteredSkills,
		rules: rules ?? [],
		plugins,
		hasPlugins,
		alwaysApplyRules: injectedAlwaysApplyRules,
		date,
		dateTime,
		cwd: promptCwd,
		intentTracing: !!intentField,
		intentField: intentField ?? "",
		mcpDiscoveryMode,
		hasMCPDiscoveryServers: mcpDiscoveryServerSummaries.length > 0,
		mcpDiscoveryServerSummaries,
		eagerTasks,
		secretsEnabled,
		context,
		locale: options.locale,
		knowledgeTopics: options.knowledgeTopics,
		startFolder: {
			isGitHub: startFolder.kind === "github",
			isGit: startFolder.kind === "git",
			isPlain: startFolder.kind === "plain",
			isIgnored: startFolder.ignored === true,
			slug: startFolder.slug ?? "",
		},
	};
	const defaultTemplate = loadingMode === "progressive" ? progressiveSystemPromptTemplate : systemPromptTemplate;
	let rendered = prompt.render(resolvedCustomPrompt ? customSystemPromptTemplate : defaultTemplate, data);

	// These blocks remain mandatory after every customization path. A transform receives the
	// complete default prompt, then its result goes through the same replace-or-append pass as
	// a string override so it cannot silently discard the session boundary or guardrails.
	const workspaceBoundary = workspaceBoundaryTemplate.trimEnd();
	const startFolderBlock = prompt.render(startFolderTemplate, data).trimEnd();
	const deprecationGuardrails = renderDeprecationGuardrails();
	const personAwareness = personAwarenessTemplate.trimEnd();
	const applyMandatoryBlocks = (candidate: string): string => {
		let result = candidate;
		result = result.includes(WORKSPACE_BOUNDARY_MARKER)
			? result.replace(WORKSPACE_BOUNDARY_MARKER, workspaceBoundary)
			: `${result}\n\n${workspaceBoundary}`;
		result = result.includes(START_FOLDER_MARKER)
			? result.replace(START_FOLDER_MARKER, startFolderBlock)
			: `${result}\n\n${startFolderBlock}`;
		result = result.includes(DEPRECATION_GUARDRAILS_MARKER)
			? result.replace(DEPRECATION_GUARDRAILS_MARKER, deprecationGuardrails)
			: `${result}\n\n## Deprecation guardrails\n\n${deprecationGuardrails}`;
		if (!result.includes(personAwareness)) result += `\n\n${personAwareness}`;
		return result;
	};

	rendered = applyMandatoryBlocks(rendered);
	if (transformPrompt) {
		rendered = applyMandatoryBlocks(transformPrompt(rendered));
	}

	// When autoqa is active the report_tool_issue tool is in the tool set — nudge the agent.
	if (toolNames.includes("report_tool_issue")) {
		rendered +=
			"\n\n<critical>\nThe `report_tool_issue` tool is available for automated QA. If ANY tool you call returns output that is unexpected, incorrect, malformed, or otherwise inconsistent with what you anticipated given the tool's described behavior and your parameters, call `report_tool_issue` with the tool name and a concise description of the discrepancy. Do not hesitate to report — false positives are acceptable.\n</critical>";
	}

	return rendered;
}

/** Prepare immutable inputs once, then render the system prompt once. */
export async function buildSystemPrompt(options: BuildSystemPromptOptions = {}): Promise<string> {
	if ($env.NULL_PROMPT === "true") return "";
	const prepared = await prepareSystemPromptInputs(options);
	return renderSystemPrompt(prepared, options);
}
