import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";

interface UatTarget {
	label: string;
	argv: string[];
	executable?: string;
}

export const OPENAI_CODEX_SOL_MODEL = "openai-codex/gpt-5.6-sol";
export const OPENAI_CODEX_GPT56_MODELS = [
	"openai-codex/gpt-5.6-luna",
	"openai-codex/gpt-5.6-terra",
	OPENAI_CODEX_SOL_MODEL,
] as const;
export const OPENAI_CODEX_SOL_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

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
			/\b(access_token|refresh_token|id_token|authorization_code|code_verifier|device_auth_id|user_code|code|token|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
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

async function typeIntoPty(session: PtySession, value: string): Promise<void> {
	for (const character of value) {
		session.write(character);
		await Bun.sleep(5);
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
		SSH_CONNECTION: "uat-client uat-server",
		PI_CODEX_DEBUG: "1",
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
	const outputChunks: string[] = [];
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
				if (chunk) {
					transcript += chunk;
					outputChunks.push(chunk);
				}
			},
		)
		.finally(() => {
			exited = true;
		});

	try {
		const waitForNewOutput = async (
			start: number,
			predicate: (visible: string) => boolean,
			description: string,
			timeoutMs: number,
		) =>
			waitFor(
				target.label,
				() => transcript.slice(start),
				predicate,
				description,
				() => exited,
				timeoutMs,
			);
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
		if (startup.includes("ChatGPT Plus/Pro (Browser callback)")) {
			throw new Error(`${target.label} listed the hidden browser compatibility provider`);
		}
		if (startup.includes("Model Provider URL")) {
			throw new Error(`${target.label} entered LiteLLM URL configuration during fresh startup`);
		}

		await Bun.sleep(150);
		await typeIntoPty(session, "openai-codex");
		await waitFor(
			target.label,
			() => transcript,
			visible => visible.includes("ChatGPT Plus/Pro (Codex Subscription)") && visible.includes("1 match"),
			"the filtered ChatGPT provider",
			() => exited,
			STARTUP_TIMEOUT_MS,
		);
		session.write("\r");
		let outputStart = transcript.length;
		await waitForNewOutput(
			outputStart,
			visible =>
				visible.includes("ChatGPT subscription sign-in method") &&
				visible.indexOf("Device Code") < visible.indexOf("Browser Login"),
			"the SSH-ordered ChatGPT login methods",
			STARTUP_TIMEOUT_MS,
		);
		session.write("\r");
		await waitFor(
			target.label,
			() => transcript,
			visible => visible.includes("https://auth.openai.com/codex/device") && visible.includes("One-time code:"),
			"the ChatGPT device authorization code",
			() => exited,
			STARTUP_TIMEOUT_MS,
		);
		const deviceOutput = visibleTranscript(transcript);
		const deviceCode = deviceOutput.match(/One-time code:\s*([A-Z0-9-]+)/)?.[1];
		if (!deviceCode) throw new Error(`${target.label} rendered no readable device code`);
		console.log(`AUTHORIZATION REQUIRED: open https://auth.openai.com/codex/device and enter ${deviceCode}`);
		// One human authorization step occurs here. Enter leaves the code readable and starts polling.
		session.write("\r");
		await waitFor(
			target.label,
			() => transcript,
			visible =>
				visible.includes("Successfully logged in to openai-codex") &&
				visible.includes(`Default model: ${OPENAI_CODEX_SOL_MODEL}`),
			"ChatGPT OAuth completion and Sol selection",
			() => exited,
			OAUTH_TIMEOUT_MS,
		);

		const selectAndVerify = async (model: string, effort: (typeof OPENAI_CODEX_SOL_EFFORTS)[number]) => {
			outputStart = transcript.length;
			session.write("/model\r");
			await waitForNewOutput(
				outputStart,
				visible => visible.includes("QUICK") && visible.includes("ALL MODELS"),
				"the model picker",
				STARTUP_TIMEOUT_MS,
			);
			await typeIntoPty(session, model);
			await waitForNewOutput(
				outputStart,
				visible => visible.includes(`[${model}]`),
				`${model} search result`,
				STARTUP_TIMEOUT_MS,
			);
			session.write("\r");
			await waitForNewOutput(
				outputStart,
				visible => visible.includes("Thinking for:") && visible.includes("provider default"),
				`${model} reasoning picker`,
				STARTUP_TIMEOUT_MS,
			);
			const thinkingOrder = ["inherit", "off", "low", "medium", "high", "xhigh", "max"] as const;
			const pickerOutput = visibleTranscript(transcript.slice(outputStart));
			const selectedMatches = [...pickerOutput.matchAll(/[›>]\s+(inherit|off|low|medium|high|xhigh|max)\s+—/g)];
			const selectedEffort = selectedMatches.at(-1)?.[1];
			if (!selectedEffort) throw new Error(`${model} reasoning picker did not expose its selected effort`);
			const targetEffort = effort === "none" ? "off" : effort;
			const currentIndex = thinkingOrder.indexOf(selectedEffort as (typeof thinkingOrder)[number]);
			const targetIndex = thinkingOrder.indexOf(targetEffort as (typeof thinkingOrder)[number]);
			const downwardMoves = (targetIndex - currentIndex + thinkingOrder.length) % thinkingOrder.length;
			for (let index = 0; index < downwardMoves; index += 1) session.write("\x1b[B");
			session.write("\r");
			await waitForNewOutput(
				outputStart,
				visible => visible.includes(`Default model: ${model}`),
				`${model}:${effort} selection`,
				STARTUP_TIMEOUT_MS,
			);
			const sentinel = `XCSH_${model.split("-").at(-1)?.toUpperCase()}_${effort.toUpperCase()}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
			session.write(`Reply with exactly ${sentinel} and nothing else.\r`);
			await waitForNewOutput(
				outputStart,
				visible => countOccurrences(visible, sentinel) >= 2,
				`${model}:${effort} streamed response`,
				SENTINEL_TIMEOUT_MS,
			);
		};

		for (const model of OPENAI_CODEX_GPT56_MODELS) await selectAndVerify(model, "medium");
		for (const effort of OPENAI_CODEX_SOL_EFFORTS) await selectAndVerify(OPENAI_CODEX_SOL_MODEL, effort);

		await selectAndVerify(OPENAI_CODEX_SOL_MODEL, "medium");
		const behavioralCases = [
			{
				prompt: "Compute 137 * 29. Reply with exactly ARITHMETIC_3973 and nothing else.",
				expected: "ARITHMETIC_3973",
				description: "deterministic arithmetic",
			},
			{
				prompt:
					"Correct this JavaScript: const add = (a, b) => a - b. Reply with exactly CODE_FIX_a_plus_b and nothing else.",
				expected: "CODE_FIX_a_plus_b",
				description: "deterministic code correction",
			},
			{
				prompt:
					'Emit one JSON object with exactly these keys and values, without markdown: {"sentinel":"STRUCTURED_OK","count":3}',
				expected: '{"sentinel":"STRUCTURED_OK","count":3}',
				description: "constrained structured output",
			},
		];
		for (const testCase of behavioralCases) {
			outputStart = transcript.length;
			session.write(`${testCase.prompt}\r`);
			await waitForNewOutput(
				outputStart,
				visible => countOccurrences(visible, testCase.expected) >= 2,
				testCase.description,
				SENTINEL_TIMEOUT_MS,
			);
		}
		const streamChunkStart = outputChunks.length;
		outputStart = transcript.length;
		session.write("Repeat the word STREAM exactly 80 times separated by single spaces, with nothing else.\r");
		await waitForNewOutput(
			outputStart,
			visible => countOccurrences(visible, "STREAM") >= 80,
			"multi-delta streamed output",
			SENTINEL_TIMEOUT_MS,
		);
		const streamedChunks = outputChunks
			.slice(streamChunkStart)
			.filter(chunk => visibleTranscript(chunk).includes("STREAM")).length;
		if (streamedChunks < 2) throw new Error("Streamed response was not observed across multiple PTY updates");

		const convergenceToken = `CONVERGE_${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
		outputStart = transcript.length;
		session.write(`Remember ${convergenceToken}. Reply with exactly STORED and nothing else.\r`);
		await waitForNewOutput(
			outputStart,
			visible => countOccurrences(visible, "STORED") >= 2,
			"multi-turn storage acknowledgement",
			SENTINEL_TIMEOUT_MS,
		);
		outputStart = transcript.length;
		session.write("Reply with exactly the token I asked you to remember and nothing else.\r");
		await waitForNewOutput(
			outputStart,
			visible => visible.includes(convergenceToken),
			"multi-turn convergence",
			SENTINEL_TIMEOUT_MS,
		);

		// PI_CODING_AGENT_DIR selects an isolated non-default profile, so the
		// directory resolver intentionally keeps root logs under HOME/.xcsh.
		const logDir = path.join(stateDir, ".xcsh", "logs");
		const logFiles = await fs.readdir(logDir);
		const rawDiagnostics = (
			await Promise.all(logFiles.map(file => fs.readFile(path.join(logDir, file), "utf8")))
		).join("\n");
		const sanitizedDiagnostics = redactSensitiveOutput(rawDiagnostics);
		for (const model of OPENAI_CODEX_GPT56_MODELS)
			expectDiagnostic(sanitizedDiagnostics, `"model":"${model.slice("openai-codex/".length)}"`);
		for (const effort of OPENAI_CODEX_SOL_EFFORTS)
			expectDiagnostic(sanitizedDiagnostics, `"reasoningEffort":"${effort}"`);
		if (
			/access_token|refresh_token|authorization_code|code_verifier|Bearer\s+(?!\[REDACTED\])/i.test(
				sanitizedDiagnostics,
			)
		) {
			throw new Error("Retained Codex diagnostics contain credential material");
		}
		if (callbackError) throw callbackError;
		console.log(
			`PASS: ${target.label} completed fresh xcsh ChatGPT OAuth and the ${OPENAI_CODEX_SOL_MODEL} sentinel.`,
		);
	} finally {
		if (!exited) session.kill();
		await runPromise.catch(() => undefined);
		await fs.rm(stateDir, { recursive: true, force: true });
	}
}

function expectDiagnostic(diagnostics: string, expected: string): void {
	if (!diagnostics.includes(expected)) throw new Error(`Missing sanitized request diagnostic: ${expected}`);
}

async function main(): Promise<void> {
	const targets = parseTargets(process.argv.slice(2));
	for (const target of targets) {
		if (target.executable) await fs.access(target.executable, fs.constants.X_OK);
		await runFreshOAuthRoundTrip(target);
	}
	console.log("PASS: fresh-state xcsh-native OpenAI subscription acceptance completed.");
}

if (import.meta.main) {
	await main();
}
