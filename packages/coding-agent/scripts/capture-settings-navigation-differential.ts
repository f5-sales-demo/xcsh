import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

/**
 * Captures the legacy settings navigation contract in real PTYs.  This is kept
 * separate from the candidate terminal matrix: the two source roots are pinned
 * to the published release and the immutable pre-correction source, so a
 * successful candidate capture cannot accidentally become parity evidence.
 */
const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const root = resolve(import.meta.dir, "../../..");
const args = process.argv.slice(2);

function valueFor(flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

const baselineRoot = valueFor("--baseline-root");
const preFixRoot = valueFor("--pre-fix-root");
if (!baselineRoot || !preFixRoot)
	throw new Error(
		"Usage: bun capture-settings-navigation-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const output = resolve(
	valueFor("--output") ??
		join(root, "packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json"),
);

interface CandidateReceipt {
	candidate: "published-v21.24.4" | "pre-fix-e68d757";
	commit: string;
	steps: Record<string, string>;
	configBytesPreserved: boolean;
	startupError?: string;
}

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

async function gitCommit(directory: string): Promise<string> {
	const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: directory });
	if (result.exitCode !== 0) throw new Error(`Cannot resolve HEAD for ${directory}: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

function sanitize(value: string): string {
	return value
		.replaceAll(/\/Users\/[^\n]*/g, "<user-path>")
		.replaceAll(/(?:\/private)?\/var\/folders\/[^\n]*/g, "<isolated-temp-path>")
		.replaceAll(/xcsh-terminal-uat-[A-Za-z0-9]+/g, "xcsh-terminal-uat-XXXXXX");
}

function viewport(terminal: ReturnType<typeof createCaptureTerminal>): string {
	return sanitize(
		Array.from(
			{ length: terminal.rows },
			(_, row) =>
				terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
		).join("\n"),
	);
}

async function captureCandidate(
	directory: string,
	expectedCommit: string,
	candidate: CandidateReceipt["candidate"],
	providerUrl: string,
): Promise<CandidateReceipt> {
	const commit = await gitCommit(directory);
	if (commit !== expectedCommit) throw new Error(`Expected ${expectedCommit}, got ${commit} in ${directory}`);
	const profile = await createTerminalUatProfile({ columns: 80, rows: 24, theme: "dark", symbols: "unicode" }, "none");
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({ providers: { anthropic: { baseUrl: providerUrl, apiKey: "settings-differential" } } }),
	);
	const configPath = join(profile.agentDir, "config.yml");
	const configBefore = await Bun.file(configPath).text();
	const terminal = createCaptureTerminal(80, 24);
	const pty = new PtySession();
	let stream = "";
	let ended = false;
	let issue: Error | undefined;
	let writes = Promise.resolve();
	const done = pty
		.start(
			{
				command: [
					process.execPath,
					join(directory, "packages/coding-agent/src/cli.ts"),
					"--no-extensions",
					"--no-skills",
					"--no-rules",
					"--no-tools",
					"--no-mcp",
					"--no-lsp",
					"--no-title",
					"--no-memories",
					"--provider",
					"anthropic",
					"--model",
					"claude-sonnet-4-5",
					"--session-dir",
					join(profile.root, "sessions"),
				]
					.map(quote)
					.join(" "),
				cwd: profile.cwd,
				env: profile.env,
				cols: 80,
				rows: 24,
				timeoutMs: 30_000,
			},
			(error, chunk) => {
				if (error) issue = error;
				stream += chunk ?? "";
				writes = writes.then(() => new Promise<void>(done => terminal.write(chunk ?? "", done)));
			},
		)
		.then(() => {
			ended = true;
		});
	const wait = async (predicate: () => boolean, label: string, timeout = 10_000) => {
		const deadline = performance.now() + timeout;
		while (performance.now() < deadline) {
			await writes;
			if (issue) throw issue;
			if (predicate()) return;
			if (ended) throw new Error(`Candidate exited before ${label}`);
			await Bun.sleep(25);
		}
		throw new Error(`Timed out waiting for ${label}`);
	};
	const settle = async () => {
		await Bun.sleep(250);
		await writes;
	};
	const steps: Record<string, string> = {};
	try {
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		await Bun.sleep(750);
		pty.write("/settings\r");
		await wait(
			() => viewport(terminal).includes("Settings") && viewport(terminal).includes("Appearance"),
			"settings",
		);
		steps.open = viewport(terminal);

		pty.write("\x1b[C");
		await settle();
		steps.right = viewport(terminal);
		pty.write("\x1b[D");
		await settle();
		steps.left = viewport(terminal);

		// The first appearance row is a choice editor in both source revisions.
		pty.write(" ");
		await settle();
		steps.space = viewport(terminal);
		pty.write("\r");
		await settle();
		steps.enter = viewport(terminal);
		pty.write("\x1b[6~");
		await settle();
		steps.pageDown = viewport(terminal);
		// SGR 1006 motion, wheel, and left click. Coordinates intentionally target
		// the list body; the captured result documents routing rather than guessing
		// that the candidates share the same frame geometry.
		pty.write("\x1b[<35;8;11M\x1b[<65;8;11M\x1b[<0;8;11M");
		await settle();
		steps.mouse = viewport(terminal);
		pty.write("\x1b\x1b");
		await settle();
		steps.escape = viewport(terminal);
		return {
			candidate,
			commit,
			steps,
			configBytesPreserved: configBefore === (await Bun.file(configPath).text()),
		};
	} catch (error) {
		return {
			candidate,
			commit,
			steps,
			configBytesPreserved: configBefore === (await Bun.file(configPath).text()),
			startupError: `${error instanceof Error ? error.message : String(error)}\n${sanitize(stream)}`,
		};
	} finally {
		try {
			pty.kill();
		} catch {
			// The lifecycle command may already have exited the isolated process.
		}
		await done.catch(() => {});
		terminal.dispose();
	}
}

const provider = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: request =>
		new URL(request.url).pathname === "/v1/models"
			? Response.json({ data: [{ id: "claude-sonnet-4-5", object: "model" }] })
			: Response.json({ type: "message", content: [], stop_reason: "end_turn" }),
});
try {
	const baseline = await captureCandidate(
		resolve(baselineRoot),
		BASELINE_COMMIT,
		"published-v21.24.4",
		provider.url.toString(),
	);
	const current = await captureCandidate(
		resolve(preFixRoot),
		PRE_FIX_COMMIT,
		"pre-fix-e68d757",
		provider.url.toString(),
	);
	await mkdir(resolve(output, ".."), { recursive: true });
	await Bun.write(
		output,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				kind: "interactive-settings-navigation-differential",
				coverage:
					"Real-PTY /settings open, empty-search Left/Right, Space, Enter, PageDown, SGR mouse motion/wheel/click, Escape, and configuration-byte observation at 80x24.",
				limitation:
					"This receipt compares the published and immutable pre-fix sources. Candidate correction evidence remains separate; review/save, every setting row, every choice list, and responsive variants are tracked separately.",
				baseline,
				current,
			},
			null,
			2,
		)}\n`,
	);
	console.log(
		JSON.stringify({ output, baseline: baseline.startupError ?? "ok", current: current.startupError ?? "ok" }),
	);
} finally {
	await provider.stop(true);
}
