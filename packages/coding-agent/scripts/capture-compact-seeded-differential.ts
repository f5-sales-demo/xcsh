import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const root = resolve(import.meta.dir, "../../..");
const args = process.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
};
const baselineRoot = valueFor("--baseline-root");
const preFixRoot = valueFor("--pre-fix-root");
if (!baselineRoot || !preFixRoot)
	throw new Error(
		"Usage: bun capture-compact-seeded-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const output = resolve(
	valueFor("--output") ??
		join(root, "packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json"),
);

interface CandidateReceipt {
	commit: string;
	initialBytes: number;
	baseline?: {
		escapeInterrupted: boolean;
		interruptedBytesUnchanged: boolean;
		successPersisted: boolean;
		reopenedSummary: boolean;
	};
	preFix?: {
		reviewOpened: boolean;
		cancelledBytesUnchanged: boolean;
		escapeNavigationOnly: boolean;
		ctrlCInterrupted: boolean;
		interruptedBytesUnchanged: boolean;
		successPersisted: boolean;
		reopenedSummary: boolean;
		noopBytesAndRequestsUnchanged: boolean;
	};
}

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
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

async function commit(directory: string): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	if (exitCode !== 0) throw new Error(`Cannot resolve commit for ${directory}`);
	return stdout.trim();
}

async function sourceEval(directory: string, code: string): Promise<string> {
	const child = Bun.spawn([process.execPath, "-e", code], { cwd: directory, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`Source helper failed in ${directory}: ${stderr.trim() || stdout.trim()}`);
	return stdout.trim();
}

function usage() {
	return {
		input: 100,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 150,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

async function seedSession(directory: string, cwd: string, sessionDir: string): Promise<string> {
	const source = `
import { SessionManager } from "./packages/coding-agent/src/session/session-manager.ts";
const cwd = ${JSON.stringify(cwd)};
const sessionDir = ${JSON.stringify(sessionDir)};
const usage = ${JSON.stringify(usage())};
const seed = SessionManager.create(cwd, sessionDir);
seed.appendMessage({ role: "user", content: "Synthetic first compaction request", timestamp: 1 });
seed.appendMessage({ role: "assistant", content: [{ type: "text", text: "Synthetic first response for compaction." }], api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-5", usage, stopReason: "stop", timestamp: 2 });
seed.appendMessage({ role: "user", content: "Synthetic second compaction request", timestamp: 3 });
seed.appendMessage({ role: "assistant", content: [{ type: "text", text: "Synthetic second response for compaction." }], api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-5", usage, stopReason: "stop", timestamp: 4 });
if ("retryPersistence" in seed) await seed.retryPersistence();
else {
	await seed.ensureOnDisk();
	await seed.flush();
}
const file = seed.getSessionFile();
await seed.close();
if (!file) throw new Error("Seed session was not persisted");
console.log(JSON.stringify({ file }));
`;
	return (JSON.parse(await sourceEval(directory, source)) as { file: string }).file;
}

async function hasCompactionSummary(directory: string, sessionFile: string): Promise<boolean> {
	const source = `
import { SessionManager } from "./packages/coding-agent/src/session/session-manager.ts";
const manager = await SessionManager.open(${JSON.stringify(sessionFile)});
const hasCompaction = manager.getEntries().some(entry => entry.type === "compaction");
await manager.close();
console.log(JSON.stringify({ hasCompaction }));
`;
	return (JSON.parse(await sourceEval(directory, source)) as { hasCompaction: boolean }).hasCompaction;
}

function anthropicStream(events: unknown[]): Response {
	return new Response(
		`${events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\n`,
		{
			headers: { "content-type": "text/event-stream", "request-id": `req_seeded_compact_${messageNumber}` },
		},
	);
}

let messageNumber = 0;
function compactResponse(): Response {
	const id = `msg_seeded_compact_${++messageNumber}`;
	return anthropicStream([
		{
			type: "message_start",
			message: {
				id,
				model: "claude-sonnet-4-5",
				usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		},
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Synthetic planning continued." } },
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		},
		{ type: "message_stop" },
	]);
}

async function captureCandidate(
	directory: string,
	expectedCommit: string,
	providerUrl: string,
): Promise<CandidateReceipt> {
	const actualCommit = await commit(directory);
	if (actualCommit !== expectedCommit)
		throw new Error(`Expected ${expectedCommit}, got ${actualCommit} in ${directory}`);
	const profile = await createTerminalUatProfile({ columns: 80, rows: 24, theme: "dark", symbols: "unicode" }, "read");
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({ providers: { anthropic: { baseUrl: providerUrl, apiKey: "synthetic-seeded-compact" } } }),
	);
	await Bun.write(
		join(profile.agentDir, "config.yml"),
		`${await Bun.file(join(profile.agentDir, "config.yml")).text()}compaction:\n  keepRecentTokens: 1\n  reserveTokens: 1024\n  remoteEnabled: false\n`,
	);
	const sessionFile = await seedSession(directory, profile.cwd, join(profile.root, "sessions"));
	const initialBytes = await Bun.file(sessionFile).text();
	const providerPostsBefore = providerPosts;
	const terminal = createCaptureTerminal(80, 24);
	const pty = new PtySession();
	let stream = "";
	let ended = false;
	let error: Error | undefined;
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
					"--session",
					sessionFile,
				]
					.map(quote)
					.join(" "),
				cwd: profile.cwd,
				env: profile.env,
				cols: 80,
				rows: 24,
				timeoutMs: 45_000,
			},
			(issue, chunk) => {
				if (issue) error = issue;
				stream += chunk ?? "";
				writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk ?? "", resolve)));
			},
		)
		.then(() => {
			ended = true;
		});
	const wait = async (predicate: () => boolean | Promise<boolean>, label: string, milliseconds = 10_000) => {
		const deadline = performance.now() + milliseconds;
		while (performance.now() < deadline) {
			await writes;
			if (error) throw error;
			if (await predicate()) return;
			if (ended) throw new Error(`candidate exited before ${label}`);
			await Bun.sleep(25);
		}
		throw new Error(`timed out waiting for ${label}; viewport:\n${viewport(terminal)}`);
	};
	const bytes = async () => Bun.file(sessionFile).text();
	const postCount = () => providerPosts - providerPostsBefore;
	const start = () => pty.write("/compact Preserve synthetic decisions\r");
	const summaryPresent = () => hasCompactionSummary(directory, sessionFile);
	try {
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		if (expectedCommit === BASELINE_COMMIT) {
			start();
			await wait(() => viewport(terminal).includes("Compacting context"), "published compaction start");
			pty.write("\x1b");
			await wait(() => viewport(terminal).includes("Compaction cancelled"), "published Escape interruption");
			const interruptedBytesUnchanged = (await bytes()) === initialBytes;
			start();
			await wait(async () => (await bytes()) !== initialBytes, "published compaction persistence", 20_000);
			return {
				commit: actualCommit,
				initialBytes: initialBytes.length,
				baseline: {
					escapeInterrupted: true,
					interruptedBytesUnchanged,
					successPersisted: (await bytes()) !== initialBytes,
					reopenedSummary: await summaryPresent(),
				},
			};
		}

		start();
		await wait(() => viewport(terminal).includes("Review session compaction"), "pre-fix compaction review");
		pty.write("\r");
		await wait(() => !viewport(terminal).includes("Review session compaction"), "pre-fix review cancellation");
		const cancelledBytesUnchanged = (await bytes()) === initialBytes;
		start();
		await wait(() => viewport(terminal).includes("Review session compaction"), "pre-fix second compaction review");
		pty.write("\x1b[B\r");
		await wait(() => viewport(terminal).includes("Applying session compaction"), "pre-fix compaction start");
		pty.write("\x1b");
		await Bun.sleep(100);
		await writes;
		const escapeNavigationOnly = viewport(terminal).includes("Applying session compaction");
		pty.write("\x03");
		await wait(() => viewport(terminal).includes("Compaction interrupted"), "pre-fix Ctrl+C interruption");
		const interruptedBytesUnchanged = (await bytes()) === initialBytes;
		start();
		await wait(() => viewport(terminal).includes("Review session compaction"), "pre-fix third compaction review");
		pty.write("\x1b[B\r");
		await wait(async () => (await bytes()) !== initialBytes, "pre-fix compaction persistence", 20_000);
		const savedBytes = await bytes();
		const postsAfterSuccess = postCount();
		start();
		await wait(() => viewport(terminal).includes("already compacted"), "pre-fix compaction no-op");
		return {
			commit: actualCommit,
			initialBytes: initialBytes.length,
			preFix: {
				reviewOpened: true,
				cancelledBytesUnchanged,
				escapeNavigationOnly,
				ctrlCInterrupted: true,
				interruptedBytesUnchanged,
				successPersisted: savedBytes !== initialBytes,
				reopenedSummary: await summaryPresent(),
				noopBytesAndRequestsUnchanged: (await bytes()) === savedBytes && postCount() === postsAfterSuccess,
			},
		};
	} finally {
		try {
			pty.kill();
		} catch {
			// The command may have already exited.
		}
		await done.catch(() => {});
		terminal.dispose();
	}
}

let providerPosts = 0;
const provider = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/v1/models") return Response.json({ data: [{ id: "claude-sonnet-4-5" }] });
		if (path === "/v1/messages") {
			providerPosts++;
			await Bun.sleep(1_000);
			return compactResponse();
		}
		return new Response("unexpected compact fixture request", { status: 503 });
	},
});

try {
	const baseline = await captureCandidate(resolve(baselineRoot), BASELINE_COMMIT, provider.url.toString());
	const preFix = await captureCandidate(resolve(preFixRoot), PRE_FIX_COMMIT, provider.url.toString());
	await mkdir(dirname(output), { recursive: true });
	await Bun.write(
		output,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				kind: "interactive-compact-seeded-differential",
				baseline,
				preFix,
				providerPosts,
				classification:
					"intentional-safety-addition: pre-fix replaces immediate Escape-cancellable compaction with cancel-first review, Escape navigation, explicit Ctrl+C interruption, and persisted no-op protection.",
			},
			null,
		)}\n`,
	);
} finally {
	await provider.stop(true);
}
