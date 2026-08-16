import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";

interface UatTarget {
	label: string;
	command: string;
	executable?: string;
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const ROOT_DIR = path.resolve(import.meta.dir, "../../..");
const PTY_TIMEOUT_MS = 60_000;
const CODEX_TIMEOUT_MS = 180_000;

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseTargets(argv: string[]): UatTarget[] {
	const targets: UatTarget[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--source") {
			targets.push({
				label: "Bun development xcsh",
				command: [
					"bun",
					"packages/coding-agent/src/cli.ts",
					"--no-session",
					"--no-mcp",
					"--model",
					"openai/gpt-5-mini",
				]
					.map(shellQuote)
					.join(" "),
			});
			continue;
		}
		if (argument === "--installed") {
			const executable = argv[index + 1];
			if (!executable) throw new Error("--installed requires the path to an xcsh executable");
			index += 1;
			targets.push({
				label: `Installed xcsh (${executable})`,
				command: [executable, "--no-session", "--no-mcp", "--model", "openai/gpt-5-mini"].map(shellQuote).join(" "),
				executable,
			});
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (targets.length === 0) {
		return parseTargets(["--source"]);
	}
	return targets;
}

function visibleTranscript(value: string): string {
	return Bun.stripANSI(value)
		.replaceAll("\r", "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

async function waitForText(
	label: string,
	getTranscript: () => string,
	text: string,
	hasExited: () => boolean,
): Promise<void> {
	const deadline = Date.now() + PTY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const transcript = visibleTranscript(getTranscript());
		if (transcript.includes(text)) return;
		if (hasExited()) {
			throw new Error(`${label} exited before rendering ${JSON.stringify(text)}\n${transcript.slice(-4000)}`);
		}
		await Bun.sleep(50);
	}
	throw new Error(
		`${label} timed out waiting for ${JSON.stringify(text)}\n${visibleTranscript(getTranscript()).slice(-4000)}`,
	);
}

function assertOAuthBoundary(label: string, transcript: string): void {
	const visible = visibleTranscript(transcript);
	const required = [
		"OpenAI Responses API (usage-based API access)",
		"OpenAI Responses API uses usage-based Platform API access.",
		"Set OPENAI_API_KEY, then select an OpenAI model with /model.",
		"For ChatGPT subscription access, use the official codex CLI (`codex login`).",
	];
	for (const expected of required) {
		if (!visible.includes(expected)) {
			throw new Error(`${label} did not render required guidance: ${expected}`);
		}
	}

	const forbidden: Array<[string, RegExp]> = [
		["removed provider ID", /openai-codex/i],
		["ChatGPT plan advertising", /ChatGPT\s+(?:Plus|Pro)\b/i],
		["unsupported OpenAI OAuth host", /auth\.openai\.com/i],
		["copied OpenAI OAuth client settings", /app_EMoamEEZ73f0CkXaXp7hrann/i],
		["OpenAI OAuth originator field", /\boriginator\b/i],
	];
	for (const [description, pattern] of forbidden) {
		if (pattern.test(visible)) throw new Error(`${label} exposed ${description}`);
	}
}

async function runPtyBoundary(target: UatTarget): Promise<void> {
	const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-openai-boundary-"));
	const session = new PtySession();
	let transcript = "";
	let callbackError: Error | undefined;
	let exited = false;
	const runPromise = session
		.start(
			{
				command: target.command,
				cwd: ROOT_DIR,
				env: {
					HOME: stateDir,
					PI_CODING_AGENT_DIR: path.join(stateDir, "agent"),
					XDG_CACHE_HOME: path.join(stateDir, "cache"),
					XDG_CONFIG_HOME: path.join(stateDir, "config"),
					XDG_DATA_HOME: path.join(stateDir, "data"),
					XDG_STATE_HOME: path.join(stateDir, "state"),
					OPENAI_API_KEY: "sk-xcsh-boundary-uat-not-a-real-key",
					TERM: "xterm-256color",
				},
				cols: 120,
				rows: 40,
				timeoutMs: PTY_TIMEOUT_MS,
			},
			(error, chunk) => {
				if (error) callbackError = error;
				if (chunk) transcript += chunk;
			},
		)
		.finally(() => {
			exited = true;
		});

	try {
		await waitForText(
			target.label,
			() => transcript,
			"xcsh v",
			() => exited,
		);
		// The welcome frame can render before the editor focus and input handlers are attached.
		await Bun.sleep(1000);
		session.write("/login\r");
		await waitForText(
			target.label,
			() => transcript,
			"Type to filter providers",
			() => exited,
		);
		session.write("responses api");
		await waitForText(
			target.label,
			() => transcript,
			"OpenAI Responses API (usage-based API access)",
			() => exited,
		);
		session.write("\r");
		await waitForText(
			target.label,
			() => transcript,
			"For ChatGPT subscription access, use the official codex CLI (`codex login`).",
			() => exited,
		);
		if (callbackError) throw callbackError;
		assertOAuthBoundary(target.label, transcript);
		console.log(`PASS: ${target.label} kept OpenAI subscription authentication at the official Codex boundary.`);
	} finally {
		if (!exited) session.kill();
		await runPromise.catch(() => undefined);
		await fs.rm(stateDir, { recursive: true, force: true });
	}
}

async function runCommand(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	stdinText?: string,
): Promise<CommandResult> {
	const process = Bun.spawn([command, ...args], {
		cwd,
		env: Bun.env,
		stdin: stdinText === undefined ? "ignore" : "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	if (stdinText !== undefined) {
		const stdin = process.stdin;
		if (!stdin) throw new Error(`Failed to open stdin for ${command}`);
		stdin.write(stdinText);
		stdin.end();
	}
	const stdoutPromise = new Response(process.stdout).text();
	const stderrPromise = new Response(process.stderr).text();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		process.kill();
	}, timeoutMs);
	const exitCode = await process.exited;
	clearTimeout(timeout);
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	if (timedOut) throw new Error(`${command} ${args[0] ?? ""} timed out after ${timeoutMs}ms`);
	return { exitCode, stdout, stderr };
}

async function verifyOfficialCodexSubscription(): Promise<void> {
	const status = await runCommand("codex", ["login", "status"], ROOT_DIR, 30_000);
	const statusOutput = `${status.stdout}\n${status.stderr}`.trim();
	if (status.exitCode !== 0 || !/Logged in using ChatGPT/i.test(statusOutput)) {
		throw new Error(`Official Codex CLI is not authenticated with ChatGPT: ${statusOutput}`);
	}
	console.log("PASS: codex login status reports ChatGPT authentication.");

	const sentinel = `XCSH_CODEX_UAT_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-codex-sentinel-"));
	try {
		const result = await runCommand(
			"codex",
			[
				"exec",
				"--model",
				"gpt-5.6",
				"--sandbox",
				"read-only",
				"--ephemeral",
				"--ignore-rules",
				"--skip-git-repo-check",
				"--json",
			],
			runDir,
			CODEX_TIMEOUT_MS,
			`Do not use tools. Reply with exactly ${sentinel} and nothing else.\n`,
		);
		if (result.exitCode !== 0) {
			throw new Error(
				`codex exec failed with exit ${result.exitCode}: ${result.stderr.trim()}\n${result.stdout.trim()}`,
			);
		}
		const agentMessages: string[] = [];
		for (const line of result.stdout.split("\n").filter(Boolean)) {
			const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
			if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
				agentMessages.push(event.item.text);
			}
		}
		if (agentMessages.at(-1)?.trim() !== sentinel) {
			throw new Error(
				`codex exec did not return the exact sentinel; received ${JSON.stringify(agentMessages.at(-1))}`,
			);
		}
		console.log(`PASS: ephemeral read-only codex exec --model gpt-5.6 returned ${sentinel}.`);
	} finally {
		await fs.rm(runDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const targets = parseTargets(process.argv.slice(2));
	for (const target of targets) {
		if (target.executable) await fs.access(target.executable, fs.constants.X_OK);
		await runPtyBoundary(target);
	}
	await verifyOfficialCodexSubscription();
	console.log("PASS: OpenAI subscription acceptance completed without reading or injecting Codex credentials.");
}

await main();
