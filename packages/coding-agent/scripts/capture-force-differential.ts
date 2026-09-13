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
		"Usage: bun capture-force-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const output = resolve(
	valueFor("--output") ?? join(root, "packages/coding-agent/test/evidence/force-differential-v1/receipt.json"),
);

interface CandidateReceipt {
	commit: string;
	emptyInvocation: {
		viewport: string;
		selectorOpened: boolean;
		sessionFilesBefore: number;
		sessionFilesAfterCancel: number;
	};
	explicitRead: { viewport: string; sessionFilesBefore: number; sessionFilesAfter: number };
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
		JSON.stringify({ providers: { anthropic: { baseUrl: providerUrl, apiKey: "synthetic-force-differential" } } }),
	);
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
					"--tools",
					"read",
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
			(issue, chunk) => {
				if (issue) error = issue;
				stream += chunk ?? "";
				writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk ?? "", resolve)));
			},
		)
		.then(() => {
			ended = true;
		});
	const wait = async (predicate: () => boolean, label: string) => {
		const deadline = performance.now() + 10_000;
		while (performance.now() < deadline) {
			await writes;
			if (error) throw error;
			if (predicate()) return;
			if (ended) throw new Error(`candidate exited before ${label}`);
			await Bun.sleep(25);
		}
		throw new Error(`timed out waiting for ${label}`);
	};
	const sessionFiles = () => [...new Bun.Glob("*.jsonl").scanSync({ cwd: join(profile.root, "sessions") })].length;
	try {
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		await Bun.sleep(750);
		await writes;
		const sessionFilesBefore = sessionFiles();
		pty.write("/force\r");
		await wait(
			() => viewport(terminal).includes("Queue a forced tool call") || viewport(terminal).includes("Usage: /force"),
			"argument-less force outcome",
		);
		const emptyInvocation = {
			viewport: viewport(terminal),
			selectorOpened: viewport(terminal).includes("Queue a forced tool call"),
			sessionFilesBefore,
			sessionFilesAfterCancel: sessionFilesBefore,
		};
		if (emptyInvocation.selectorOpened) {
			pty.write("\r");
			await wait(() => !viewport(terminal).includes("Queue a forced tool call"), "force selector cancellation");
		}
		emptyInvocation.sessionFilesAfterCancel = sessionFiles();
		const explicitBefore = sessionFiles();
		pty.write("/force read\r");
		await wait(
			() => viewport(terminal).includes("forced to use read") || viewport(terminal).includes("Queued read once"),
			"explicit force acknowledgement",
		);
		return {
			commit: actualCommit,
			emptyInvocation,
			explicitRead: {
				viewport: viewport(terminal),
				sessionFilesBefore: explicitBefore,
				sessionFilesAfter: sessionFiles(),
			},
		};
	} finally {
		try {
			pty.kill();
		} catch {
			// Process may have exited.
		}
		await done.catch(() => {});
		terminal.dispose();
	}
}

const provider = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		if (new URL(request.url).pathname === "/v1/models") return Response.json({ data: [{ id: "claude-sonnet-4-5" }] });
		return new Response("unexpected force fixture request", { status: 503 });
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
				kind: "interactive-force-differential",
				baseline,
				preFix,
				classification:
					"intentional-safety-addition: pre-fix adds a cancel-first active-tool selector for an argument-less /force while retaining explicit /force read queueing without executing a tool.",
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await provider.stop(true);
}
