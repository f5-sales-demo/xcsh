import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const FABLE_MODEL = "anthropic/claude-fable-5-1";
export const FABLE_5_MODEL = "anthropic/claude-fable-5";
export const OPUS_CONTROL_MODEL = "anthropic/claude-opus-5";

type AuthMode = "oauth" | "api-key";
type ExpectedOutcome = "success" | "entitlement-failure";

interface UatTarget {
	label: string;
	argv: string[];
}

export function redactFableUatOutput(value: string): string {
	return Bun.stripANSI(value)
		.replace(/(https:\/\/(?:claude|platform\.claude)\.com\/[^\s?]+)\?\S+/gi, "$1?[REDACTED]")
		.replace(/\b(authorization|x-api-key)\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, "$1: [REDACTED]")
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(
			/\b(access_token|refresh_token|authorization_code|code_verifier|token|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1$2[REDACTED]",
		);
}

export function parseFableUatArgs(argv: string[]): {
	targets: UatTarget[];
	auth: AuthMode;
	expected: ExpectedOutcome;
} {
	const targets: UatTarget[] = [];
	let auth: AuthMode = "oauth";
	let expected: ExpectedOutcome = "success";
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--source") {
			targets.push({ label: "source", argv: ["bun", "dev", "--"] });
		} else if (argument === "--installed") {
			const executable = argv[++index];
			if (!executable) throw new Error("--installed requires an xcsh executable path");
			targets.push({ label: `installed:${executable}`, argv: [executable] });
		} else if (argument === "--auth") {
			const value = argv[++index];
			if (value !== "oauth" && value !== "api-key") throw new Error("--auth must be oauth or api-key");
			auth = value;
		} else if (argument === "--expect") {
			const value = argv[++index];
			if (value !== "success" && value !== "entitlement-failure") {
				throw new Error("--expect must be success or entitlement-failure");
			}
			expected = value;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return { targets: targets.length > 0 ? targets : [{ label: "source", argv: ["bun", "dev", "--"] }], auth, expected };
}

function isolatedEnvironment(profileDir: string, auth: AuthMode): Record<string, string> {
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
	if (auth === "api-key") {
		const apiKey = Bun.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set for --auth api-key");
		env.ANTHROPIC_API_KEY = apiKey;
	}
	return env;
}

async function runInteractive(target: UatTarget, env: Record<string, string>): Promise<string> {
	const child = Bun.spawn([...target.argv, "--no-session", "--model", "fable", "--thinking", "high"], {
		cwd: path.resolve(import.meta.dir, "../../.."),
		env,
		stdin: "inherit",
		stdout: "pipe",
		stderr: "pipe",
	});
	let transcript = "";
	const relay = async (stream: ReadableStream<Uint8Array>, destination: NodeJS.WriteStream) => {
		for await (const chunk of stream) {
			transcript += new TextDecoder().decode(chunk);
			destination.write(chunk);
		}
	};
	await Promise.all([relay(child.stdout, process.stdout), relay(child.stderr, process.stderr), child.exited]);
	if (child.exitCode !== 0) {
		throw new Error(`Fable UAT exited ${child.exitCode}\n${redactFableUatOutput(transcript).slice(-4000)}`);
	}
	return Bun.stripANSI(transcript);
}

function verifyTranscript(transcript: string, expected: ExpectedOutcome): void {
	if (expected === "entitlement-failure") {
		if (!transcript.includes("Anthropic access requires credits for this model")) {
			throw new Error("Expected the actionable Fable entitlement failure");
		}
		if (/auto.?retry|retrying/i.test(transcript)) throw new Error("Entitlement failure unexpectedly retried");
		return;
	}
	for (const marker of [
		"FABLE_STREAM_READY",
		"FABLE_CONTINUITY_READY",
		"read",
		"shell",
		"todo_write",
		"FABLE_SKILL_READY",
		"FABLE_PLUGIN_READY",
		"FABLE_MCP_READY",
		"FABLE_CONTEXT_READY",
		"FABLE_ROUTE_READY",
		"FABLE_IMAGE_READY",
		FABLE_5_MODEL,
		OPUS_CONTROL_MODEL,
	]) {
		if (!transcript.includes(marker)) throw new Error(`Missing Fable UAT evidence: ${marker}`);
	}
}

async function runTarget(target: UatTarget, auth: AuthMode, expected: ExpectedOutcome): Promise<void> {
	const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-fable-uat-"));
	await fs.chmod(profileDir, 0o700);
	try {
		const env = isolatedEnvironment(profileDir, auth);
		console.log(`\n${target.label}: clean ${auth} profile; expected ${expected}`);
		if (auth === "oauth") console.log("First run /login anthropic and complete the browser sign-in.");
		if (expected === "success") {
			console.log(
				"Run the displayed Fable 5.1 checklist for streaming/model attribution, continuity, read/shell/todo_write, fixture skill/plugin/MCP, xcsh context, routing, and image input; then run explicit Fable 5 and Opus 5 text/tool controls. Preserve the printed marker names exactly and exit.",
			);
		} else {
			console.log("Send one prompt, wait for the immediate entitlement error, then exit without retrying.");
		}
		verifyTranscript(await runInteractive(target, env), expected);
		console.log(`PASS: ${target.label} ${auth} ${expected}`);
	} finally {
		await fs.rm(profileDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const options = parseFableUatArgs(process.argv.slice(2));
	for (const target of options.targets) {
		if (target.argv.length === 1) await fs.access(target.argv[0], fs.constants.X_OK);
		await runTarget(target, options.auth, options.expected);
	}
}

if (import.meta.main) await main();
