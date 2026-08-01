/** Installed-binary conformance check for the live filesystem sandbox. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell } from "@f5-sales-demo/pi-natives";
import { isEnoent } from "@f5-sales-demo/pi-utils";
import { Settings } from "../config/settings";
import { fenceForNative } from "../exec/bash-executor";
import { buildContainmentFence, type ContainmentFence, containmentStatus } from "../sandbox/containment";
import { evaluateToolCall } from "../sandbox/enforce";
import { BashTool, type ToolSession } from "../tools";

export type SandboxCheckResultStatus = "PASS" | "FAIL" | "SKIP";

export interface SandboxCheckResult {
	name: string;
	status: SandboxCheckResultStatus;
}

export interface SandboxCheckReport {
	backend: string;
	osEnforced: boolean;
	checks: SandboxCheckResult[];
	summary: {
		passed: number;
		failed: number;
		skipped: number;
	};
}

export interface SandboxCheckOptions {
	json?: boolean;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

async function shellExitCode(
	command: string,
	cwd: string,
	fence: ContainmentFence,
	signal: AbortSignal,
): Promise<number> {
	const result = await executeShell(
		{
			command,
			cwd,
			fence: fenceForNative(fence),
			signal,
			timeoutMs: 15_000,
		},
		() => {},
	);
	return result.exitCode ?? -1;
}

function renderReport(report: SandboxCheckReport, json: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}

	const enforcement = report.osEnforced ? "OS enforced" : "scanner only";
	process.stdout.write(`Sandbox backend: ${report.backend} (${enforcement})\n\n`);
	const width = Math.max(...report.checks.map(check => check.name.length));
	for (const check of report.checks) {
		process.stdout.write(`${check.status.padEnd(4)}  ${check.name.padEnd(width)}\n`);
	}
	process.stdout.write(
		`\n${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped\n`,
	);
}

/** Run the conformance matrix and report only after every synthetic fixture has been removed. */
export async function runSandboxCheck(options: SandboxCheckOptions = {}): Promise<SandboxCheckReport> {
	const backend = containmentStatus(true);
	const checks: SandboxCheckResult[] = [];
	const abortController = new AbortController();
	const interrupt = () => abortController.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);

	let fixtureRoot: string | undefined;
	const add = (name: string, status: SandboxCheckResultStatus): void => {
		checks.push({ name, status });
	};
	const check = async (name: string, probe: () => boolean | Promise<boolean>): Promise<void> => {
		if (abortController.signal.aborted) {
			add(name, "FAIL");
			return;
		}
		try {
			add(name, (await probe()) ? "PASS" : "FAIL");
		} catch {
			add(name, "FAIL");
		}
	};

	try {
		const tmpRoot = await fs.realpath(os.tmpdir());
		fixtureRoot = await fs.mkdtemp(path.join(tmpRoot, "xcsh-sandbox-check-"));
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
				evaluateToolCall({
					toolName: "write",
					input: { file_path: path.join(otherHome, "new.txt") },
					cwd: workspace,
					fence,
				}),
				evaluateToolCall({ toolName: "find", input: { pattern: `${accountRoot}/**/*` }, cwd: workspace, fence }),
				evaluateToolCall({ toolName: "grep", input: { path: otherHome }, cwd: workspace, fence }),
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
				evaluateToolCall({
					toolName: "python",
					input: { code: `import os; os.listdir(${JSON.stringify(accountRoot)})` },
					cwd: workspace,
					fence,
				}),
			];
			const ownConfig = evaluateToolCall({
				toolName: "write",
				input: { file_path: path.join(configDir, "config") },
				cwd: workspace,
				fence,
			});
			return blocked.every(result => result.block) && !ownConfig.block;
		});

		await check("workspace read, write, glob, and recursion", async () => {
			const command =
				"cat own.txt > /dev/null && printf created > created.txt && " +
				"printf '%s\\n' ./* > /dev/null && find . -type f > /dev/null";
			return (await shellExitCode(command, workspace, fence, abortController.signal)) === 0;
		});
		await check("named sibling remains reachable", async () => {
			const command = `cd ${quote(sibling)} && test "$(cat named.txt)" = sibling`;
			return (await shellExitCode(command, workspace, fence, abortController.signal)) === 0;
		});

		if (backend.osEnforced) {
			await check("session parent cannot be enumerated", async () => {
				const command = `ls ${quote(workspaces)} > /dev/null`;
				return (await shellExitCode(command, workspace, fence, abortController.signal)) !== 0;
			});
			await check("account container cannot be enumerated", async () => {
				const command = `ls ${quote(accountRoot)} > /dev/null`;
				return (await shellExitCode(command, workspace, fence, abortController.signal)) !== 0;
			});
			await check("synthetic other account cannot be entered", async () => {
				const command = `cd ${quote(otherHome)}`;
				return (await shellExitCode(command, workspace, fence, abortController.signal)) !== 0;
			});
			await check("cross-session stores cannot be read", async () => {
				const sessionRead = `cat ${quote(path.join(otherSession, "state.jsonl"))} > /dev/null`;
				const memoryRead = `cat ${quote(path.join(otherMemory, "MEMORY.md"))} > /dev/null`;
				return (
					(await shellExitCode(sessionRead, workspace, fence, abortController.signal)) !== 0 &&
					(await shellExitCode(memoryRead, workspace, fence, abortController.signal)) !== 0
				);
			});
		} else {
			for (const name of [
				"session parent cannot be enumerated",
				"account container cannot be enumerated",
				"synthetic other account cannot be entered",
				"cross-session stores cannot be read",
			]) {
				add(name, "SKIP");
			}
		}

		await check("operator home configuration is writable", async () => {
			const target = path.join(configDir, "config");
			const command = `printf operator > ${quote(target)} && test "$(cat ${quote(target)})" = operator`;
			return (await shellExitCode(command, workspace, fence, abortController.signal)) === 0;
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
			return text(moved) === nested && text(reset) === workspace && text(explicit) === nested;
		});
	} catch {
		add("conformance matrix completed", "FAIL");
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", interrupt);
		if (fixtureRoot === undefined) {
			add("synthetic fixtures removed", "FAIL");
		} else {
			try {
				await fs.rm(fixtureRoot, { recursive: true, force: true });
				await fs.stat(fixtureRoot);
				add("synthetic fixtures removed", "FAIL");
			} catch (error) {
				add("synthetic fixtures removed", isEnoent(error) ? "PASS" : "FAIL");
			}
		}
	}

	const report: SandboxCheckReport = {
		backend: backend.backend,
		osEnforced: backend.osEnforced,
		checks,
		summary: {
			passed: checks.filter(result => result.status === "PASS").length,
			failed: checks.filter(result => result.status === "FAIL").length,
			skipped: checks.filter(result => result.status === "SKIP").length,
		},
	};
	renderReport(report, options.json ?? false);
	return report;
}
