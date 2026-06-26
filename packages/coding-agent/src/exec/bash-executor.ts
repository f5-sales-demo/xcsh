/**
 * Bash command execution with streaming support and cancellation.
 *
 * Uses brush-core via native bindings for shell execution.
 */
import * as fs from "node:fs/promises";
import { executeShell, Shell } from "@f5-sales-demo/pi-natives";
import { Settings } from "../config/settings";
import { OutputSink } from "../session/streaming-output";
import { getOrCreateSnapshot } from "../utils/shell-snapshot";
import { NON_INTERACTIVE_ENV } from "./non-interactive-env";

export interface BashExecutorOptions {
	cwd?: string;
	timeout?: number;
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
	/** Session key suffix to isolate shell sessions per agent */
	sessionKey?: string;
	/** Additional environment variables to inject */
	env?: Record<string, string>;
	/** Artifact path/id for full output storage */
	artifactPath?: string;
	artifactId?: string;
	/** Mask sensitive values (e.g. env var secrets) in output. */
	maskSecrets?: (text: string) => string;
}

export interface BashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	artifactId?: string;
	/** Actual working directory after the command ran (persistent shell only). */
	newCwd?: string;
}

const HARD_TIMEOUT_GRACE_MS = 5_000;

const shellSessions = new Map<string, Shell>();
const brokenShellSessions = new Set<string>();

/** Clear cached shell sessions so bun can exit cleanly after tests. */
export function _resetShellSessionsForTest(): void {
	shellSessions.clear();
	brokenShellSessions.clear();
	// Force GC so native Shell handles close immediately via Rust Drop
	if (typeof Bun !== "undefined") Bun.gc(true);
}

async function resolveShellCwd(cwd: string | undefined): Promise<string | undefined> {
	if (!cwd) return undefined;

	try {
		// Brush preserves the working directory string verbatim, so resolve symlinks
		// up front to keep `pwd` aligned with tools like `git worktree list`.
		return await fs.realpath(cwd);
	} catch {
		return cwd;
	}
}

export async function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	const settings = await Settings.init();
	const { shell, env: shellEnv, prefix } = settings.getShellConfig();
	const snapshotPath = shell.includes("bash") ? await getOrCreateSnapshot(shell, shellEnv) : null;
	const commandCwd = await resolveShellCwd(options?.cwd);
	const rawBashEnv = (settings.get("bash.environment") ?? {}) as Record<string, unknown>;
	const bashEnvironment: Record<string, string> = {};
	for (const [k, v] of Object.entries(rawBashEnv)) {
		if (typeof v === "string") bashEnvironment[k] = v;
		else if (v != null) bashEnvironment[k] = String(v);
	}
	const hasBashEnv = Object.keys(bashEnvironment).length > 0;
	const commandEnv = options?.env
		? { ...NON_INTERACTIVE_ENV, ...bashEnvironment, ...options.env }
		: hasBashEnv
			? { ...NON_INTERACTIVE_ENV, ...bashEnvironment }
			: NON_INTERACTIVE_ENV;

	// Apply command prefix if configured
	const prefixedCommand = prefix ? `${prefix} ${command}` : command;

	// CWD capture sentinels — used to detect directory changes from cd commands.
	// Only appended for persistent shell sessions (one-shot shells don't persist CWD).
	const CWD_SENTINEL_START = "__XCSH_CWD__:";
	const CWD_SENTINEL_END = ":__XCSH_CWD_END__";
	// Exit-code capture sentinel — the persistent shell's own exit code reflects
	// the trailing printf (always 0), so the user command's actual exit status
	// must be captured in-band. `$?` is referenced directly as a printf argument
	// (see finalCommand below) because a variable-assignment capture like
	// `_x=$?` resets `$?` to 0 in brush-core before the RHS is evaluated. Without
	// this sentinel, subprocess failures like `false`, `ls /nonexistent`, or
	// `(exit 3)` silently report success.
	const EXIT_SENTINEL_START = "__XCSH_EXIT__:";
	const EXIT_SENTINEL_END = ":__XCSH_EXIT_END__";

	// Create output sink for truncation and artifact handling
	const sink = new OutputSink({
		onChunk: options?.onChunk,
		artifactPath: options?.artifactPath,
		artifactId: options?.artifactId,
		// Throttle the streaming preview callback to avoid saturating the
		// event loop when commands produce massive output (e.g. seq 1 50M).
		chunkThrottleMs: options?.onChunk ? 50 : 0,
		maskSecrets: options?.maskSecrets,
	});

	// sink.push() is synchronous — buffer management, counters, and onChunk
	// all run inline. File writes (artifact path) are handled asynchronously
	// inside the sink. No promise chain needed.
	const enqueueChunk = (chunk: string) => {
		sink.push(chunk);
	};

	if (options?.signal?.aborted) {
		return {
			exitCode: undefined,
			cancelled: true,
			...(await sink.dump("Command cancelled")),
		};
	}

	const sessionKey = buildSessionKey(shell, prefix, snapshotPath, shellEnv, options?.sessionKey);
	const persistentSessionBroken = brokenShellSessions.has(sessionKey);
	if (persistentSessionBroken) {
		shellSessions.delete(sessionKey);
	}

	let shellSession = persistentSessionBroken ? undefined : shellSessions.get(sessionKey);
	if (!shellSession && !persistentSessionBroken) {
		shellSession = new Shell({ sessionEnv: shellEnv, snapshotPath: snapshotPath ?? undefined });
		shellSessions.set(sessionKey, shellSession);
	}

	// Append CWD + exit-code sentinels only for persistent shell sessions.
	// `$?` must be referenced DIRECTLY in the printf arguments — using a
	// variable assignment like `_x=$?` first resets `$?` to 0 in brush-core
	// before the RHS is evaluated, defeating the capture. The persistent
	// shell's winner.exitCode always reflects the printf's return (0), so
	// the EXIT sentinel is the authoritative source for the user command's
	// actual exit status.
	const finalCommand = shellSession
		? `${prefixedCommand}\nprintf '${CWD_SENTINEL_START}%s${CWD_SENTINEL_END}\\n${EXIT_SENTINEL_START}%s${EXIT_SENTINEL_END}\\n' "$PWD" "$?"`
		: prefixedCommand;
	const userSignal = options?.signal;
	const runAbortController = new AbortController();
	const abortCurrentExecution = () => {
		if (!runAbortController.signal.aborted) {
			runAbortController.abort();
		}
		if (shellSession) {
			// Native abort is async; fire-and-forget because the caller races the command separately.
			void shellSession.abort();
		}
	};
	const abortHandler = () => {
		abortCurrentExecution();
	};
	if (userSignal) {
		userSignal.addEventListener("abort", abortHandler, { once: true });
	}

	let hardTimeoutTimer: NodeJS.Timeout | undefined;
	const hardTimeoutDeferred = Promise.withResolvers<"hard-timeout">();
	const baseTimeoutMs = Math.max(1_000, options?.timeout ?? 300_000);
	const hardTimeoutMs = baseTimeoutMs + HARD_TIMEOUT_GRACE_MS;
	hardTimeoutTimer = setTimeout(() => {
		abortCurrentExecution();
		hardTimeoutDeferred.resolve("hard-timeout");
	}, hardTimeoutMs);

	let resetSession = false;

	try {
		const runPromise = shellSession
			? shellSession.run(
					{
						command: finalCommand,
						cwd: commandCwd,
						env: commandEnv,
						timeoutMs: options?.timeout,
						signal: runAbortController.signal,
					},
					(err, chunk) => {
						if (!err) {
							enqueueChunk(chunk);
						}
					},
				)
			: executeShell(
					{
						command: finalCommand,
						cwd: commandCwd,
						env: commandEnv,
						sessionEnv: shellEnv,
						snapshotPath: snapshotPath ?? undefined,
						timeoutMs: options?.timeout,
						signal: runAbortController.signal,
					},
					(err, chunk) => {
						if (!err) {
							enqueueChunk(chunk);
						}
					},
				);

		const winner = await Promise.race([
			runPromise.then(result => ({ kind: "result" as const, result })),
			hardTimeoutDeferred.promise.then(() => ({ kind: "hard-timeout" as const })),
		]);

		if (winner.kind === "hard-timeout") {
			if (shellSession) {
				resetSession = true;
				// Fall back to one-shot execution for the rest of the process once
				// a persistent session has stopped responding to cancellation.
				brokenShellSessions.add(sessionKey);
			}
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump(`Command exceeded hard timeout after ${Math.round(hardTimeoutMs / 1000)} seconds`)),
			};
		}

		// Handle timeout
		if (winner.result.timedOut) {
			const annotation = options?.timeout
				? `Command timed out after ${Math.round(options.timeout / 1000)} seconds`
				: "Command timed out";
			resetSession = true;
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump(annotation)),
			};
		}

		// Handle cancellation
		if (winner.result.cancelled) {
			resetSession = true;
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump("Command cancelled")),
			};
		}

		// Parse CWD + EXIT sentinels from output and strip them from the displayed
		// result. Exit sentinel override is the authoritative exit code for
		// persistent shell sessions — `winner.result.exitCode` would otherwise
		// be the trailing printf's exit code (always 0).
		const dumpResult = await sink.dump();
		let newCwd: string | undefined;
		let overrideExitCode: number | undefined;
		if (shellSession) {
			const cwdIdx = dumpResult.output.lastIndexOf(CWD_SENTINEL_START);
			if (cwdIdx !== -1) {
				const cwdEndIdx = dumpResult.output.indexOf(CWD_SENTINEL_END, cwdIdx);
				if (cwdEndIdx !== -1) {
					const captured = dumpResult.output.slice(cwdIdx + CWD_SENTINEL_START.length, cwdEndIdx).trim();
					if (captured) newCwd = captured;
					// Parse the adjacent exit sentinel (on the next printf line) if present.
					const exitIdx = dumpResult.output.indexOf(EXIT_SENTINEL_START, cwdEndIdx);
					let stripEndIdx = cwdEndIdx + CWD_SENTINEL_END.length;
					let linesRemoved = 1;
					if (exitIdx !== -1) {
						const exitEndIdx = dumpResult.output.indexOf(EXIT_SENTINEL_END, exitIdx);
						if (exitEndIdx !== -1) {
							const exitCaptured = dumpResult.output
								.slice(exitIdx + EXIT_SENTINEL_START.length, exitEndIdx)
								.trim();
							const parsed = Number.parseInt(exitCaptured, 10);
							if (Number.isFinite(parsed)) overrideExitCode = parsed;
							stripEndIdx = exitEndIdx + EXIT_SENTINEL_END.length;
							linesRemoved = 2;
						}
					}
					// Strip both sentinel lines from displayed output.
					const afterLine = dumpResult.output.indexOf("\n", stripEndIdx);
					const stripEnd = afterLine === -1 ? dumpResult.output.length : afterLine + 1;
					const strippedBytes = stripEnd - cwdIdx;
					dumpResult.output = dumpResult.output.slice(0, cwdIdx) + dumpResult.output.slice(stripEnd);
					dumpResult.totalBytes = Math.max(0, dumpResult.totalBytes - strippedBytes);
					dumpResult.totalLines = Math.max(0, dumpResult.totalLines - linesRemoved);
					dumpResult.outputBytes = dumpResult.output.length;
					dumpResult.outputLines = Math.max(0, dumpResult.outputLines - linesRemoved);
				}
			}
		}

		// Normal completion
		return {
			exitCode: overrideExitCode ?? winner.result.exitCode,
			cancelled: false,
			newCwd,
			...dumpResult,
		};
	} catch (err) {
		resetSession = true;
		throw err;
	} finally {
		if (hardTimeoutTimer) {
			clearTimeout(hardTimeoutTimer);
		}
		if (userSignal) {
			userSignal.removeEventListener("abort", abortHandler);
		}
		if (resetSession) {
			shellSessions.delete(sessionKey);
		}
	}
}

function buildSessionKey(
	shell: string,
	prefix: string | undefined,
	snapshotPath: string | null,
	env: Record<string, string>,
	agentSessionKey?: string,
): string {
	const entries = Object.entries(env);
	entries.sort(([a], [b]) => a.localeCompare(b));
	const envSerialized = entries.map(([key, value]) => `${key}=${value}`).join("\n");
	return [agentSessionKey ?? "", shell, prefix ?? "", snapshotPath ?? "", envSerialized].join("\n");
}
