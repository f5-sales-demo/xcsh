/** Installed-binary conformance check for the live filesystem sandbox. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell, fencePermits } from "@f5-sales-demo/pi-natives";
import { isEnoent } from "@f5-sales-demo/pi-utils";
import { Settings } from "../config/settings";
import { fenceForNative } from "../exec/bash-executor";
import { buildContainmentFence, type ContainmentFence, containmentStatus, fenceVerdict } from "../sandbox/containment";
import { evaluateToolCall } from "../sandbox/enforce";
import {
	SANDBOX_CHECK_NAMED_SIBLING_ENV,
	SANDBOX_OPERATOR_HOME_ENV,
	SANDBOX_SESSION_ROOT_ENV,
	sandboxCheckSiblingRoot,
} from "../sandbox/session-fence";
import type { ToolSession } from "../tools";
import { BashTool } from "../tools/bash";

export type SandboxCheckResultStatus = "PASS" | "FAIL" | "SKIP" | "ERROR";

export interface SandboxCheckResult {
	name: string;
	status: SandboxCheckResultStatus;
	/** Present on failures, errors, and skips; paths are generalized before they leave the process. */
	detail?: string;
}

export interface SandboxCheckReport {
	backend: string;
	osEnforced: boolean;
	checks: SandboxCheckResult[];
	summary: {
		passed: number;
		failed: number;
		errors: number;
		skipped: number;
	};
}

export interface SandboxCheckOptions {
	json?: boolean;
	verbose?: boolean;
}

interface ProbeOutcome {
	passed: boolean;
	detail?: string;
}

interface ShellProbeResult {
	exitCode: number;
	output: string;
}

type Redaction = readonly [path: string, label: string];

function quote(value: string): string {
	return JSON.stringify(value);
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

function sanitizeDetail(value: string, redactions: readonly Redaction[]): string {
	let sanitized = value;
	for (const [actual, label] of [...redactions].sort(([a], [b]) => b.length - a.length)) {
		if (actual.length > 0) sanitized = sanitized.replaceAll(actual, label);
	}
	sanitized = sanitized.replace(/\s+/gu, " ").trim();
	return sanitized.length > 500 ? `${sanitized.slice(0, 497)}...` : sanitized;
}

function errnoFromOutput(output: string): string {
	if (/operation not permitted/iu.test(output)) return "EPERM";
	if (/permission denied/iu.test(output)) return "EACCES";
	if (/no such file or directory/iu.test(output)) return "ENOENT";
	if (/not a directory/iu.test(output)) return "ENOTDIR";
	return "unknown";
}

function exceptionOutcome(
	assertion: string,
	displayPath: string,
	error: unknown,
	redactions: readonly Redaction[],
): ProbeOutcome {
	const message = error instanceof Error ? error.message : String(error);
	return {
		passed: false,
		detail: sanitizeDetail(
			`${assertion}; path=${displayPath}; errno=${errorCode(error) ?? "unknown"}; error=${message}`,
			redactions,
		),
	};
}

function shellOutcome(
	result: ShellProbeResult,
	expectSuccess: boolean,
	assertion: string,
	displayPath: string,
	redactions: readonly Redaction[],
): ProbeOutcome {
	const passed = expectSuccess ? result.exitCode === 0 : result.exitCode !== 0;
	if (passed) return { passed: true };
	const output = sanitizeDetail(result.output, redactions);
	const errno = result.exitCode === 0 ? "none" : errnoFromOutput(output);
	return {
		passed: false,
		detail: sanitizeDetail(
			`${assertion}; path=${displayPath}; exit=${result.exitCode}; errno=${errno}${output ? `; output=${output}` : ""}`,
			redactions,
		),
	};
}

async function shellProbe(
	command: string,
	cwd: string,
	fence: ContainmentFence | undefined,
	signal: AbortSignal,
): Promise<ShellProbeResult> {
	let output = "";
	const result = await executeShell(
		{
			command,
			cwd,
			fence: fence === undefined ? undefined : fenceForNative(fence),
			signal,
			timeoutMs: 15_000,
		},
		(error, chunk) => {
			if (error) output += `${error.message}\n`;
			else output += chunk;
		},
	);
	return { exitCode: result.exitCode ?? -1, output };
}

function renderReport(report: SandboxCheckReport, json: boolean, verbose: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}

	const enforcement = report.osEnforced ? "OS enforced" : "scanner only";
	process.stdout.write(`Sandbox backend: ${report.backend} (${enforcement})\n\n`);
	const nameWidth = Math.max(0, ...report.checks.map(check => check.name.length));
	const statusWidth = Math.max(0, ...report.checks.map(check => check.status.length));
	for (const check of report.checks) {
		process.stdout.write(`${check.status.padEnd(statusWidth)}  ${check.name.padEnd(nameWidth)}\n`);
		if (verbose && check.detail) process.stdout.write(`      ${check.detail}\n`);
	}
	process.stdout.write(
		`\n${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.errors} errors, ${report.summary.skipped} skipped\n`,
	);
	if (report.checks.some(check => check.name === "conformance matrix setup" && check.status === "ERROR")) {
		process.stdout.write("Conformance matrix did not run.\n");
	}
	if (!verbose && (report.summary.failed > 0 || report.summary.errors > 0)) {
		process.stdout.write("Run `xcsh sandbox check --verbose` for failure details.\n");
	}
}

/** Run the conformance matrix and report only after every synthetic fixture has been removed. */
export async function runSandboxCheck(options: SandboxCheckOptions = {}): Promise<SandboxCheckReport> {
	const backend = containmentStatus(true);
	const checks: SandboxCheckResult[] = [];
	const fixturePaths: string[] = [];
	const knownCleanupLeaves: string[] = [];
	const nonEnumerableCleanupDirs = new Set<string>();
	const redactions: Redaction[] = [];
	const abortController = new AbortController();
	const interrupt = () => abortController.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);

	let fixtureRoot: string | undefined;
	const add = (name: string, status: SandboxCheckResultStatus, detail?: string): void => {
		checks.push({ name, status, ...(detail ? { detail } : {}) });
	};
	const check = async (
		name: string,
		probe: () => boolean | ProbeOutcome | Promise<boolean | ProbeOutcome>,
	): Promise<void> => {
		if (abortController.signal.aborted) {
			add(name, "ERROR", "probe aborted before execution; path=<probe>; errno=ABORTED");
			return;
		}
		try {
			const result = await probe();
			const outcome = typeof result === "boolean" ? { passed: result } : result;
			add(
				name,
				outcome.passed ? "PASS" : "FAIL",
				outcome.passed ? undefined : (outcome.detail ?? "assertion failed; path=<probe>; errno=unknown"),
			);
		} catch (error) {
			const outcome = exceptionOutcome("probe threw", "<probe>", error, redactions);
			add(name, "ERROR", outcome.detail);
		}
	};

	try {
		const inheritedWorkspace = process.env[SANDBOX_SESSION_ROOT_ENV];
		const inheritedHome = process.env[SANDBOX_OPERATOR_HOME_ENV];
		const inheritedSibling = process.env[SANDBOX_CHECK_NAMED_SIBLING_ENV];
		const inheritedProfile = inheritedWorkspace !== undefined;
		const workspaceInput = inheritedWorkspace ?? process.cwd();
		const homeInput = inheritedHome ?? os.homedir();
		redactions.push([workspaceInput, "<workspace>"], [homeInput, "<operator-home>"]);
		// BashTool owns and canonicalises inherited values before applying Seatbelt/Landlock. Re-running
		// realpath here can require metadata access that the live profile deliberately withholds from the
		// session parent — which is the operator home for a `~/<workspace>` layout (#2807).
		const liveWorkspace = inheritedWorkspace ?? (await fs.realpath(workspaceInput));
		const liveHome = inheritedHome ?? (await fs.realpath(homeInput));
		redactions.push([liveWorkspace, "<workspace>"], [liveHome, "<operator-home>"]);
		if (inheritedSibling !== undefined) redactions.push([inheritedSibling, "<session-parent>/<synthetic-sibling>"]);

		const fixtureBase = inheritedProfile ? liveWorkspace : await fs.realpath(os.tmpdir());
		fixtureRoot = await fs.mkdtemp(path.join(fixtureBase, ".xcsh-sandbox-check-policy-"));
		fixturePaths.push(fixtureRoot);
		redactions.push([fixtureRoot, "<synthetic-root>"]);

		const accountRoot = path.join(fixtureRoot, "Users");
		const operatorHome = path.join(accountRoot, "operator");
		const otherHome = path.join(accountRoot, "other-account");
		const workspaces = path.join(operatorHome, "workspaces");
		const workspace = path.join(workspaces, "example-a");
		const sibling = path.join(workspaces, "example-b");
		const nested = path.join(workspace, "nested");
		const sessionStore = path.join(operatorHome, ".xcsh", "agent", "sessions");
		const otherSession = path.join(sessionStore, "synthetic-session");
		const memoryStore = path.join(operatorHome, ".xcsh", "agent", "memories");
		const otherMemory = path.join(memoryStore, "synthetic-memory");
		const configDir = path.join(operatorHome, ".config", "xcsh-check");

		for (const dir of [workspace, sibling, nested, otherHome, otherSession, otherMemory, configDir]) {
			await fs.mkdir(dir, { recursive: true });
		}
		await Bun.write(path.join(workspace, "own.txt"), "own\n");
		await Bun.write(path.join(sibling, "named.txt"), "sibling\n");
		await Bun.write(path.join(otherHome, "synthetic.txt"), "synthetic\n");
		await Bun.write(path.join(otherSession, "state.jsonl"), "synthetic\n");
		await Bun.write(path.join(otherMemory, "MEMORY.md"), "synthetic\n");

		const fence = buildContainmentFence({
			workspace,
			home: operatorHome,
			fsRoot: fixtureRoot,
			leakRoots: [sessionStore, memoryStore],
		});

		await check("structured tools share the boundary", () => {
			const blocked = [
				evaluateToolCall({ toolName: "read", input: { file_path: workspaces }, cwd: workspace, fence }),
				evaluateToolCall({ toolName: "find", input: { pattern: `${accountRoot}/**/*` }, cwd: workspace, fence }),
				evaluateToolCall({
					toolName: "read",
					input: { file_path: path.join(otherSession, "state.jsonl") },
					cwd: workspace,
					fence,
				}),
				evaluateToolCall({
					toolName: "read",
					input: { file_path: path.join(otherMemory, "MEMORY.md") },
					cwd: workspace,
					fence,
				}),
			];
			const allowed = [
				evaluateToolCall({
					toolName: "write",
					input: { file_path: path.join(otherHome, "new.txt") },
					cwd: workspace,
					fence,
				}),
				evaluateToolCall({ toolName: "grep", input: { path: otherHome }, cwd: workspace, fence }),
				evaluateToolCall({
					toolName: "python",
					input: { code: `import os; os.listdir(${JSON.stringify(accountRoot)})` },
					cwd: workspace,
					fence,
				}),
				evaluateToolCall({
					toolName: "write",
					input: { file_path: path.join(configDir, "config") },
					cwd: workspace,
					fence,
				}),
			];
			const passed = blocked.every(result => result.block) && allowed.every(result => !result.block);
			return passed
				? { passed: true }
				: {
						passed: false,
						detail: "structured-tool policy disagreed with the shell boundary; path=<synthetic-root>; errno=none",
					};
		});

		// Use a recursive synthetic deny here. The production account root is discovery-only, so testing
		// against that fence alone would pass even if arbitrary source scanning were accidentally restored.
		const sourceTextFence: ContainmentFence = {
			...fence,
			deny: [...fence.deny, accountRoot],
		};
		const pathLikePattern = `${accountRoot}${path.sep}|alpha`;
		await check("Bash grep pattern remains data (#2931)", () => {
			const bashResult = evaluateToolCall({
				toolName: "bash",
				input: { command: `grep -nE ${JSON.stringify(pathLikePattern)} own.txt` },
				cwd: workspace,
				fence: sourceTextFence,
			});
			const grepResult = evaluateToolCall({
				toolName: "grep",
				input: { pattern: pathLikePattern, path: workspace },
				cwd: workspace,
				fence: sourceTextFence,
			});
			return !bashResult.block && !grepResult.block
				? { passed: true }
				: {
						passed: false,
						detail:
							"Bash and structured grep disagreed on path-like pattern data; path=<synthetic-root>; errno=none",
					};
		});
		await check("Bash Python heredoc remains data (#2931)", () => {
			const command = [
				"python3 - <<'PY'",
				`patterns = {"home path": ${JSON.stringify(`${accountRoot}${path.sep}`)}}`,
				'print("  scanned for:", list(patterns.values()))',
				"PY",
			].join("\n");
			const result = evaluateToolCall({
				toolName: "bash",
				input: { command },
				cwd: workspace,
				fence: sourceTextFence,
			});
			return !result.block
				? { passed: true }
				: {
						passed: false,
						detail:
							"Bash pre-check interpreted Python heredoc source as a path; path=<synthetic-root>; errno=none",
					};
		});

		await check("workspace read, write, glob, and recursion", async () => {
			const displayPath = "<workspace>/<synthetic-fixture>";
			let liveFixture: string;
			try {
				liveFixture = await fs.mkdtemp(path.join(liveWorkspace, ".xcsh-sandbox-check-workspace-"));
				fixturePaths.push(liveFixture);
				redactions.push([liveFixture, displayPath]);
				await fs.mkdir(path.join(liveFixture, "nested"));
				await Bun.write(path.join(liveFixture, "own.txt"), "own\n");
			} catch (error) {
				return exceptionOutcome("create live workspace fixture", displayPath, error, redactions);
			}
			const command =
				"cat own.txt > /dev/null && printf created > created.txt && " +
				"printf '%s\\n' ./* > /dev/null && find . -type f > /dev/null";
			const result = await shellProbe(command, liveFixture, undefined, abortController.signal);
			return shellOutcome(
				result,
				true,
				"live profile must allow workspace read, write, glob, and recursion",
				displayPath,
				redactions,
			);
		});

		await check("named sibling remains reachable", async () => {
			const displayPath = "<session-parent>/<synthetic-sibling>";
			let liveSibling = inheritedSibling;
			if (liveSibling === undefined) {
				try {
					liveSibling = await fs.mkdtemp(
						path.join(sandboxCheckSiblingRoot(liveWorkspace, liveHome), ".xcsh-sandbox-check-sibling-"),
					);
					fixturePaths.push(liveSibling);
					nonEnumerableCleanupDirs.add(liveSibling);
					redactions.push([liveSibling, displayPath]);
					const namedFile = path.join(liveSibling, "named.txt");
					await Bun.write(namedFile, "sibling\n");
					knownCleanupLeaves.push(namedFile);
				} catch (error) {
					return exceptionOutcome("create named sibling fixture", displayPath, error, redactions);
				}
			}
			const result = await shellProbe(
				'test "$(cat named.txt)" = sibling',
				liveSibling,
				undefined,
				abortController.signal,
			);
			return shellOutcome(result, true, "live profile must allow a named sibling read", displayPath, redactions);
		});

		if (backend.osEnforced) {
			await check("session parent cannot be enumerated", async () => {
				const result = await shellProbe(
					`ls ${quote(workspaces)} > /dev/null`,
					workspace,
					fence,
					abortController.signal,
				);
				return shellOutcome(
					result,
					false,
					"synthetic session parent enumeration must be refused",
					"<synthetic-session-parent>",
					redactions,
				);
			});
			await check("explicit grant restores parent enumeration", async () => {
				const grantedFence = buildContainmentFence({
					workspace,
					home: operatorHome,
					fsRoot: fixtureRoot,
					leakRoots: [sessionStore, memoryStore],
					readOnlyRoots: [workspaces],
					writeOnlyRoots: [workspaces],
				});
				const grantedNativeFence = fenceForNative(grantedFence);
				if (
					fenceVerdict(grantedFence, workspaces, "enumerate") !== "allow" ||
					grantedNativeFence === undefined ||
					!fencePermits(grantedNativeFence, workspaces, false, true)
				) {
					return {
						passed: false,
						detail:
							"explicit grant was not accepted by both policy engines; path=<synthetic-session-parent>; errno=none",
					};
				}

				// An inherited OS profile cannot be widened by a child. In that topology the live
				// profile already grants this synthetic path through the workspace, so exercise the
				// real operation there after both policy engines accepted the explicit grant. A
				// standalone check applies the granted fence itself and covers the OS compiler too.
				const result = await shellProbe(
					`ls ${quote(workspaces)} > /dev/null`,
					workspace,
					inheritedProfile ? undefined : grantedFence,
					abortController.signal,
				);
				return shellOutcome(
					result,
					true,
					"explicit grant must restore synthetic session parent enumeration",
					"<synthetic-session-parent>",
					redactions,
				);
			});
			await check("account container cannot be enumerated", async () => {
				const result = await shellProbe(
					`ls ${quote(accountRoot)} > /dev/null`,
					workspace,
					fence,
					abortController.signal,
				);
				return shellOutcome(
					result,
					false,
					"synthetic account container enumeration must be refused",
					"<synthetic-account-container>",
					redactions,
				);
			});
			await check("named other account remains reachable", async () => {
				const result = await shellProbe(`cd ${quote(otherHome)}`, workspace, fence, abortController.signal);
				return shellOutcome(
					result,
					true,
					"named synthetic account traversal must remain available",
					"<synthetic-other-account>",
					redactions,
				);
			});
			await check("cross-session stores cannot be read", async () => {
				const sessionRead = await shellProbe(
					`cat ${quote(path.join(otherSession, "state.jsonl"))} > /dev/null`,
					workspace,
					fence,
					abortController.signal,
				);
				const sessionOutcome = shellOutcome(
					sessionRead,
					false,
					"synthetic other session read must be refused",
					"<synthetic-session-store>/<synthetic-session>",
					redactions,
				);
				if (!sessionOutcome.passed) return sessionOutcome;

				const memoryRead = await shellProbe(
					`cat ${quote(path.join(otherMemory, "MEMORY.md"))} > /dev/null`,
					workspace,
					fence,
					abortController.signal,
				);
				return shellOutcome(
					memoryRead,
					false,
					"synthetic other memory read must be refused",
					"<synthetic-memory-store>/<synthetic-memory>",
					redactions,
				);
			});
		} else {
			for (const name of [
				"session parent cannot be enumerated",
				"explicit grant restores parent enumeration",
				"account container cannot be enumerated",
				"named other account remains reachable",
				"cross-session stores cannot be read",
			]) {
				add(name, "SKIP", "OS enforcement backend unavailable; path=<probe>; errno=unsupported");
			}
		}

		await check("operator home configuration is writable", async () => {
			const displayPath = "<operator-home>/<synthetic-fixture>";
			let liveConfig: string;
			try {
				// Landlock cannot grant creation on a split directory without also granting every
				// denied descendant. The live fence therefore grants operator-owned CLI config roots
				// explicitly; use one of those when another Landlock profile is already inherited.
				// Standalone and Seatbelt checks retain the direct-home probe.
				const configBase =
					inheritedProfile && backend.backend === "landlock" ? path.join(liveHome, ".config", "gh") : liveHome;
				liveConfig = await fs.mkdtemp(path.join(configBase, ".xcsh-sandbox-check-home-"));
				fixturePaths.push(liveConfig);
				redactions.push([liveConfig, displayPath]);
			} catch (error) {
				return exceptionOutcome("create operator-home fixture", displayPath, error, redactions);
			}
			const result = await shellProbe(
				'printf operator > config && test "$(cat config)" = operator',
				liveConfig,
				undefined,
				abortController.signal,
			);
			return shellOutcome(
				result,
				true,
				"live profile must allow operator-home configuration writes",
				displayPath,
				redactions,
			);
		});

		await check("cwd resets across tool calls", async () => {
			const settings = await Settings.init({
				cwd: workspace,
				agentDir: path.join(fixtureRoot!, "agent-state"),
				inMemory: true,
				overrides: {
					"async.enabled": false,
					"bash.autoBackground.enabled": false,
					"bashInterceptor.enabled": false,
					"sandbox.enabled": true,
				},
			});
			const session: ToolSession = {
				cwd: workspace,
				hasUI: false,
				hasEditTool: true,
				settings,
				getSessionFile: () => null,
				getSessionSpawns: () => null,
				getSessionId: () => "sandbox-check-session",
			};
			const tool = new BashTool(session);
			const moved = await tool.execute("sandbox-check-move", { command: `cd ${quote(nested)}; pwd` });
			const reset = await tool.execute("sandbox-check-reset", { command: "pwd" });
			const explicit = await tool.execute("sandbox-check-explicit", { command: "pwd", cwd: nested });
			const text = (result: typeof moved): string =>
				result.content
					.filter((part): part is { type: "text"; text: string } => part.type === "text")
					.map(part => part.text)
					.join("")
					.trim();
			const passed = text(moved) === nested && text(reset) === workspace && text(explicit) === nested;
			return passed
				? { passed: true }
				: {
						passed: false,
						detail:
							"tool-call cwd did not reset to <synthetic-workspace> or honor explicit cwd; path=<synthetic-root>; errno=none",
					};
		});
	} catch (error) {
		const outcome = exceptionOutcome("conformance matrix setup failed", "<probe>", error, redactions);
		add("conformance matrix setup", "ERROR", outcome.detail);
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", interrupt);
		const cleanupFailures: string[] = [];
		for (const leafPath of [...knownCleanupLeaves].reverse()) {
			try {
				await fs.rm(leafPath, { force: true });
			} catch (error) {
				if (!isEnoent(error)) cleanupFailures.push(error instanceof Error ? error.message : String(error));
			}
		}
		for (const fixturePath of [...fixturePaths].reverse()) {
			try {
				// Landlock denies enumeration of the session parent. A sibling created after the
				// profile snapshot consequently cannot be walked during recursive cleanup, even
				// though its known leaf and the directory itself can be removed by name.
				if (nonEnumerableCleanupDirs.has(fixturePath)) await fs.rmdir(fixturePath);
				else await fs.rm(fixturePath, { recursive: true, force: true });
				await fs.stat(fixturePath);
				cleanupFailures.push(`fixture remains at ${fixturePath}`);
			} catch (error) {
				if (!isEnoent(error)) cleanupFailures.push(error instanceof Error ? error.message : String(error));
			}
		}

		if (cleanupFailures.length > 0) {
			add(
				"synthetic fixtures removed",
				"ERROR",
				sanitizeDetail(
					`fixture cleanup incomplete; path=<synthetic-fixtures>; errno=unknown; error=${cleanupFailures.join("; ")}`,
					redactions,
				),
			);
		} else if (fixturePaths.length === 0) {
			add("synthetic fixtures removed", "SKIP", "setup created no fixtures; path=<synthetic-fixtures>; errno=none");
		} else {
			add("synthetic fixtures removed", "PASS");
		}
	}

	const report: SandboxCheckReport = {
		backend: backend.backend,
		osEnforced: backend.osEnforced,
		checks,
		summary: {
			passed: checks.filter(result => result.status === "PASS").length,
			failed: checks.filter(result => result.status === "FAIL").length,
			errors: checks.filter(result => result.status === "ERROR").length,
			skipped: checks.filter(result => result.status === "SKIP").length,
		},
	};
	renderReport(report, options.json ?? false, options.verbose ?? false);
	return report;
}
