import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";

interface UatTarget {
	label: string;
	argv: string[];
	executable?: string;
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export const OPENAI_CODEX_TERRA_MODEL = "openai-codex/gpt-5.6-terra";

const ROOT_DIR = path.resolve(import.meta.dir, "../../..");
const STARTUP_TIMEOUT_MS = 60_000;
const OAUTH_TIMEOUT_MS = 300_000;
const SENTINEL_TIMEOUT_MS = 180_000;

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
				argv: ["bun", "packages/coding-agent/src/cli.ts"],
			});
			continue;
		}
		if (argument === "--installed") {
			const executable = argv[index + 1];
			if (!executable) throw new Error("--installed requires the path to an xcsh executable");
			index += 1;
			targets.push({
				label: `Installed xcsh (${executable})`,
				argv: [executable],
				executable,
			});
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	return targets.length > 0 ? targets : parseTargets(["--source"]);
}

function visibleTranscript(value: string): string {
	return Bun.stripANSI(value)
		.replaceAll("\r", "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** Redact diagnostics before any UAT failure can print OAuth or credential material. */
export function redactSensitiveOutput(value: string): string {
	return value
		.replace(
			/(https:\/\/auth\.openai\.com\/oauth\/authorize)\?[\s\S]*?(?=(?:\r?\n)+\s*(?:Click here to login|A browser window should open))/gi,
			"$1?[REDACTED]",
		)
		.replace(/(https?:\/\/[^\s?]+)\?[^\s)]+/gi, "$1?[REDACTED]")
		.replace(
			/\b(authorization|proxy-authorization|x-api-key|api-key)\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi,
			"$1: [REDACTED]",
		)
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(
			/\b(access_token|refresh_token|id_token|authorization_code|code|token|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1$2[REDACTED]",
		)
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function diagnostic(value: string): string {
	return redactSensitiveOutput(visibleTranscript(value)).slice(-5000);
}

async function waitFor(
	label: string,
	getTranscript: () => string,
	predicate: (visible: string) => boolean,
	description: string,
	hasExited: () => boolean,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const visible = visibleTranscript(getTranscript());
		if (predicate(visible)) return;
		if (hasExited()) {
			throw new Error(`${label} exited before ${description}\n${diagnostic(visible)}`);
		}
		await Bun.sleep(50);
	}
	throw new Error(`${label} timed out waiting for ${description}\n${diagnostic(getTranscript())}`);
}

function countOccurrences(value: string, search: string): number {
	let count = 0;
	let offset = 0;
	while (true) {
		const next = value.indexOf(search, offset);
		if (next < 0) return count;
		count += 1;
		offset = next + search.length;
	}
}

function freshEnvironment(stateDir: string): Record<string, string> {
	const env: Record<string, string> = {
		HOME: stateDir,
		PI_CODING_AGENT_DIR: path.join(stateDir, "agent"),
		XDG_CACHE_HOME: path.join(stateDir, "cache"),
		XDG_CONFIG_HOME: path.join(stateDir, "config"),
		XDG_DATA_HOME: path.join(stateDir, "data"),
		XDG_STATE_HOME: path.join(stateDir, "state"),
		TERM: "xterm-256color",
		PATH: Bun.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
	};
	for (const name of [
		"BUN_INSTALL",
		"COLORTERM",
		"DBUS_SESSION_BUS_ADDRESS",
		"DISPLAY",
		"LANG",
		"LC_ALL",
		"SHELL",
		"WAYLAND_DISPLAY",
		"XAUTHORITY",
		"XDG_RUNTIME_DIR",
	]) {
		const value = Bun.env[name];
		if (value) env[name] = value;
	}
	return env;
}

function commonArgs(): string[] {
	return ["--no-session", "--no-mcp", "--no-tools", "--no-extensions", "--no-skills", "--no-rules"];
}

async function runFreshOAuthRoundTrip(target: UatTarget): Promise<void> {
	const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-openai-fresh-oauth-"));
	const session = new PtySession();
	let transcript = "";
	let callbackError: Error | undefined;
	let exited = false;
	const command = [...target.argv, ...commonArgs()].map(shellQuote).join(" ");
	const runPromise = session
		.start(
			{
				command,
				cwd: ROOT_DIR,
				env: freshEnvironment(stateDir),
				cols: 140,
				rows: 42,
				timeoutMs: OAUTH_TIMEOUT_MS + SENTINEL_TIMEOUT_MS,
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
		await waitFor(
			target.label,
			() => transcript,
			visible => visible.includes("Select provider to login:"),
			"the provider-first selector",
			() => exited,
			STARTUP_TIMEOUT_MS,
		);
		const startup = visibleTranscript(transcript);
		for (const provider of [
			"ChatGPT Plus/Pro (Codex Subscription)",
			"OpenAI Responses API (usage-based API access)",
		]) {
			if (!startup.includes(provider)) throw new Error(`${target.label} did not list ${provider}`);
		}
		if (startup.includes("Model Provider URL")) {
			throw new Error(`${target.label} entered LiteLLM URL configuration during fresh startup`);
		}

		session.write("openai-codex");
		await waitFor(
			target.label,
			() => transcript,
			visible => visible.includes("ChatGPT Plus/Pro (Codex Subscription)") && visible.includes("1 match"),
			"the filtered ChatGPT provider",
			() => exited,
			STARTUP_TIMEOUT_MS,
		);
		session.write("\r");
		await waitFor(
			target.label,
			() => transcript,
			visible => visible.includes("https://auth.openai.com/oauth/authorize?"),
			"the ChatGPT browser authorization request",
			() => exited,
			STARTUP_TIMEOUT_MS,
		);
		await waitFor(
			target.label,
			() => transcript,
			visible =>
				visible.includes("Successfully logged in to openai-codex") &&
				visible.includes(`Default model: ${OPENAI_CODEX_TERRA_MODEL}`),
			"ChatGPT OAuth completion and Terra selection",
			() => exited,
			OAUTH_TIMEOUT_MS,
		);

		const sentinel = `XCSH_TERRA_UAT_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
		await Bun.sleep(250);
		session.write(`Reply with exactly ${sentinel} and nothing else.\r`);
		await waitFor(
			target.label,
			() => transcript,
			visible => countOccurrences(visible, sentinel) >= 2,
			"the exact GPT-5.6 Terra sentinel response",
			() => exited,
			SENTINEL_TIMEOUT_MS,
		);
		if (callbackError) throw callbackError;
		console.log(
			`PASS: ${target.label} completed fresh xcsh ChatGPT OAuth and the ${OPENAI_CODEX_TERRA_MODEL} sentinel.`,
		);
	} finally {
		if (!exited) session.kill();
		await runPromise.catch(() => undefined);
		await fs.rm(stateDir, { recursive: true, force: true });
	}
}

async function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
	env: Record<string, string | undefined>,
): Promise<CommandResult> {
	const process = Bun.spawn([command, ...args], {
		cwd: ROOT_DIR,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
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
	if (timedOut) throw new Error(`${command} timed out after ${timeoutMs}ms`);
	return { exitCode, stdout, stderr };
}

async function verifyPreservedCredential(target: UatTarget): Promise<void> {
	const sentinel = `XCSH_PRESERVED_TERRA_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
	const [command, ...prefixArgs] = target.argv;
	if (!command) throw new Error(`${target.label} has no executable`);
	const env = { ...Bun.env };
	delete env.OPENAI_CODEX_OAUTH_TOKEN;
	const result = await runCommand(
		command,
		[
			...prefixArgs,
			...commonArgs(),
			"--model",
			OPENAI_CODEX_TERRA_MODEL,
			"--thinking",
			"medium",
			"--print",
			`Reply with exactly ${sentinel} and nothing else.`,
		],
		SENTINEL_TIMEOUT_MS,
		env,
	);
	const output = `${result.stdout}\n${result.stderr}`;
	if (result.exitCode !== 0 || !visibleTranscript(output).includes(sentinel)) {
		throw new Error(
			`${target.label} preserved-credential sentinel failed with exit ${result.exitCode}\n${diagnostic(output)}`,
		);
	}
	console.log(
		`PASS: ${target.label} migrated/refreshed the preserved credential and reached ${OPENAI_CODEX_TERRA_MODEL}.`,
	);
}

async function main(): Promise<void> {
	const targets = parseTargets(process.argv.slice(2));
	for (const target of targets) {
		if (target.executable) await fs.access(target.executable, fs.constants.X_OK);
		await runFreshOAuthRoundTrip(target);
		await verifyPreservedCredential(target);
	}
	console.log("PASS: xcsh-native OpenAI subscription acceptance completed without reading or copying credentials.");
}

if (import.meta.main) {
	await main();
}
