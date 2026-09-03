import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface UatTarget {
	label: string;
	argv: string[];
	executable?: string;
}

export const ANTHROPIC_HAIKU_MODEL = "anthropic/claude-haiku-4-5";
export const ANTHROPIC_DEFAULT_MODEL = "anthropic/claude-sonnet-5";
export const ANTHROPIC_OPUS_MODEL = "anthropic/claude-opus-5";

const ROOT_DIR = path.resolve(import.meta.dir, "../../..");
const REQUIRED_MARKERS = ["HAIKU_READY", "437", "OPUS_TOOL_READY"] as const;

function parseTargets(argv: string[]): UatTarget[] {
	const targets: UatTarget[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--source") {
			targets.push({ label: "Bun development xcsh", argv: ["bun", "dev", "--"] });
			continue;
		}
		if (argument === "--installed") {
			const executable = argv[index + 1];
			if (!executable) throw new Error("--installed requires the path to an xcsh executable");
			index += 1;
			targets.push({ label: `Installed xcsh (${executable})`, argv: [executable], executable });
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	return targets.length > 0 ? targets : parseTargets(["--source"]);
}

/** Redact OAuth URLs, authorization artifacts, and headers from failure output. */
export function redactAnthropicUatOutput(value: string): string {
	return Bun.stripANSI(value)
		.replace(/(https:\/\/claude\.com\/cai\/oauth\/authorize)\?\S+/gi, "$1?[REDACTED]")
		.replace(/(https:\/\/platform\.claude\.com\/oauth\/code\/callback)\?\S+/gi, "$1?[REDACTED]")
		.replace(/\b(authorization|x-api-key)\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, "$1: [REDACTED]")
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(
			/\b(access_token|refresh_token|authorization_code|code_verifier|code|token|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1$2[REDACTED]",
		);
}

function isolatedEnvironment(profileDir: string, automaticBrowser: boolean): Record<string, string> {
	const env: Record<string, string> = {
		HOME: profileDir,
		PI_CODING_AGENT_DIR: path.join(profileDir, "agent"),
		XDG_CACHE_HOME: path.join(profileDir, "cache"),
		XDG_CONFIG_HOME: path.join(profileDir, "config"),
		XDG_DATA_HOME: path.join(profileDir, "data"),
		XDG_STATE_HOME: path.join(profileDir, "state"),
		PATH: Bun.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
		TERM: Bun.env.TERM ?? "xterm-256color",
	};
	for (const name of ["BUN_INSTALL", "COLORTERM", "LANG", "LC_ALL", "SHELL"]) {
		const value = Bun.env[name];
		if (value) env[name] = value;
	}
	if (automaticBrowser) {
		for (const name of ["DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"]) {
			const value = Bun.env[name];
			if (value) env[name] = value;
		}
	}
	return env;
}

async function runInteractive(
	target: UatTarget,
	profileDir: string,
	automaticBrowser: boolean,
	phase: "login" | "restart",
): Promise<string> {
	const args = ["--no-session", "--no-mcp", "--no-extensions", "--no-skills", "--no-rules"];
	const child = Bun.spawn([...target.argv, ...args], {
		cwd: ROOT_DIR,
		env: isolatedEnvironment(profileDir, automaticBrowser),
		stdin: "inherit",
		stdout: "pipe",
		stderr: "pipe",
	});
	let transcript = "";
	const relay = async (stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream) => {
		for await (const chunk of stream) {
			const text = new TextDecoder().decode(chunk);
			transcript += text;
			output.write(chunk);
		}
	};
	await Promise.all([relay(child.stdout, process.stdout), relay(child.stderr, process.stderr), child.exited]);
	if (child.exitCode !== 0) {
		throw new Error(
			`${target.label} ${phase} phase exited with ${child.exitCode}\n${redactAnthropicUatOutput(transcript).slice(-4000)}`,
		);
	}
	return Bun.stripANSI(transcript);
}

function verifyLoginTranscript(transcript: string): void {
	for (const expected of [
		"Successfully logged in to anthropic",
		`Default model: ${ANTHROPIC_DEFAULT_MODEL}; thinking medium`,
		"Anthropic / Claude",
		"SMOL",
		"DEFAULT",
		"SLOW",
		"PLAN",
	]) {
		if (!transcript.includes(expected)) throw new Error(`Missing login UAT evidence: ${expected}`);
	}
	for (const marker of REQUIRED_MARKERS) {
		if (transcript.split(marker).length < 3) throw new Error(`No streamed response observed for ${marker}`);
	}
}

function verifyRestartTranscript(transcript: string): void {
	if (!transcript.includes(ANTHROPIC_DEFAULT_MODEL)) {
		throw new Error(`Restart did not show persisted default ${ANTHROPIC_DEFAULT_MODEL}`);
	}
	if (transcript.split("ANTHROPIC_RESTART_READY").length < 3) {
		throw new Error("Restart streaming sentinel was not observed");
	}
}

async function runTarget(target: UatTarget): Promise<void> {
	const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-anthropic-subscription-uat-"));
	const automaticBrowser = target.executable === undefined;
	try {
		console.log(`\n${target.label}: isolated profile ${profileDir}`);
		console.log(
			automaticBrowser
				? "Complete the automatic loopback login in the opened browser. Pause for human MFA when requested."
				: "Open the displayed hosted URL and paste the complete code#state into /login.",
		);
		console.log("Verify /model role badges and thinking choices, then run these exact acceptance prompts:");
		console.log(`  smol/low: Reply with exactly HAIKU_READY and nothing else.`);
		console.log(`  default/medium: Calculate (37 × 12) − 7. Reply with digits only.`);
		console.log(
			`  slow/high: Use the shell tool to run printf OPUS_TOOL_READY, then reply with exactly OPUS_TOOL_READY and nothing else.`,
		);
		console.log("Exit xcsh after all three responses.");
		const loginTranscript = await runInteractive(target, profileDir, automaticBrowser, "login");
		verifyLoginTranscript(loginTranscript);

		console.log(
			"Restart phase: confirm the persisted account/model, request exactly ANTHROPIC_RESTART_READY, then exit.",
		);
		const restartTranscript = await runInteractive(target, profileDir, automaticBrowser, "restart");
		verifyRestartTranscript(restartTranscript);
		console.log(`PASS: ${target.label} completed Claude subscription login, tier, streaming, and restart UAT.`);
	} finally {
		await fs.rm(profileDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	for (const target of parseTargets(process.argv.slice(2))) {
		if (target.executable) await fs.access(target.executable, fs.constants.X_OK);
		await runTarget(target);
	}
}

if (import.meta.main) await main();
