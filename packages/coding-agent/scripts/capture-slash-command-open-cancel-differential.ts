import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

interface CommandDefinition {
	name: string;
	subcommands?: readonly { name: string }[];
}

interface SurfaceReceipt {
	surface: string;
	startup: "ready" | "failed";
	entered: boolean;
	escapeSent: boolean;
	processExited: boolean;
	openedViewport: string;
	cancelledViewport: string;
	keyboardProbe?: {
		down: string;
		pageDown: string;
		up: string;
	};
	startupStream?: string;
	error?: string;
}

interface SideReceipt {
	candidate: "published-v21.24.4" | "pre-fix-e68d757";
	commit: string;
	surfaces: SurfaceReceipt[];
}

const root = resolve(import.meta.dir, "../../..");
const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const args = process.argv.slice(2);
const baselineFlag = args.indexOf("--baseline-root");
const preFixFlag = args.indexOf("--pre-fix-root");
if (baselineFlag === -1 || !args[baselineFlag + 1] || preFixFlag === -1 || !args[preFixFlag + 1])
	throw new Error(
		"Usage: bun capture-slash-command-open-cancel-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const baselineRoot = resolve(args[baselineFlag + 1]!);
const preFixRoot = resolve(args[preFixFlag + 1]!);
const outputFlag = args.indexOf("--output");
const output = resolve(
	(outputFlag === -1 ? undefined : args[outputFlag + 1]) ??
		join(root, "packages/coding-agent/test/evidence/slash-command-open-cancel-differential-v1/receipts.json"),
);
const includeChildren = args.includes("--all-surfaces");
const keyboardProbe = args.includes("--keyboard-probe");
const onlyFlag = args.indexOf("--only");
const onlySurfaces =
	onlyFlag === -1
		? undefined
		: new Set(
				(args[onlyFlag + 1] ?? "")
					.split(",")
					.map(surface => surface.trim())
					.filter(Boolean),
			);

async function commit(directory: string): Promise<string> {
	const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: directory });
	if (result.exitCode !== 0) throw new Error(`Cannot resolve commit for ${directory}: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

if ((await commit(baselineRoot)) !== BASELINE_COMMIT)
	throw new Error(`Baseline root is not ${BASELINE_COMMIT}: ${baselineRoot}`);
if ((await commit(preFixRoot)) !== PRE_FIX_COMMIT)
	throw new Error(`Pre-fix root is not ${PRE_FIX_COMMIT}: ${preFixRoot}`);

async function definitions(directory: string): Promise<readonly CommandDefinition[]> {
	return (
		(await import(
			`${pathToFileURL(join(directory, "packages/coding-agent/src/slash-commands/builtin-registry.ts")).href}?open-cancel=${Date.now()}`
		)) as { BUILTIN_SLASH_COMMAND_DEFS: readonly CommandDefinition[] }
	).BUILTIN_SLASH_COMMAND_DEFS;
}

function registryAliases(source: string): Map<string, string[]> {
	const registry = source.slice(source.indexOf("const BUILTIN_SLASH_COMMAND_REGISTRY"));
	const matches = [...registry.matchAll(/^\t\{\n\t\tname: "([^"]+)"/gm)];
	return new Map(
		matches.map((match, index) => {
			const block = registry.slice(match.index, matches[index + 1]?.index ?? registry.indexOf("\n];", match.index));
			const aliases = /^\t\taliases: \[([^\]]*)\]/m.exec(block)?.[1];
			return [match[1]!, aliases ? [...aliases.matchAll(/"([^"]+)"/g)].map(alias => alias[1]!) : []];
		}),
	);
}

async function surfaces(directory: string, all: boolean): Promise<string[]> {
	// Targeted probes must not eagerly import the entire command registry. Besides
	// being unnecessary for a literal surface list, that import initializes every
	// command dependency in the compared source tree before its isolated CLI
	// process starts. The all-surface inventory deliberately retains that check.
	if (onlySurfaces) return [...onlySurfaces].toSorted();
	const commands = await definitions(directory);
	if (!all) {
		const topLevel = commands.map(command => `/${command.name}`).toSorted();
		return topLevel;
	}
	const aliases = registryAliases(
		await Bun.file(join(directory, "packages/coding-agent/src/slash-commands/builtin-registry.ts")).text(),
	);
	const allSurfaces = [
		...new Set(
			commands.flatMap(command => [
				`/${command.name}`,
				...(aliases.get(command.name) ?? []).map(alias => `/${alias}`),
				...(command.subcommands ?? []).map(subcommand => `/${command.name} ${subcommand.name}`),
			]),
		),
	].toSorted();
	return allSurfaces;
}

function viewport(terminal: ReturnType<typeof createCaptureTerminal>): string {
	return Array.from(
		{ length: terminal.rows },
		(_, row) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
	).join("\n");
}

function sanitizeViewport(rendered: string): string {
	return rendered
		.replaceAll(/\/Users\/[^\n]*/g, "<user-path>")
		.replaceAll(/(?:\/private)?\/var\/folders\/[^\n]*/g, "<isolated-temp-path>")
		.replaceAll(/xcsh-terminal-uat-[A-Za-z0-9]+/g, "xcsh-terminal-uat-XXXXXX");
}

/**
 * Enters and then sends Escape to each top-level command in a new disposable
 * profile. This is open/cancel evidence only: it intentionally does not claim
 * that mutation, failure, retry, persistence, or all nested-row paths were
 * covered. A new process per command prevents lifecycle commands from leaking
 * state into a later receipt.
 */
async function captureSurface(directory: string, surface: string, providerUrl: string): Promise<SurfaceReceipt> {
	const profile = await createTerminalUatProfile(
		{ columns: 80, rows: 24, theme: "dark", symbols: "unicode" },
		"export",
	);
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({ providers: { anthropic: { baseUrl: providerUrl, apiKey: "synthetic-open-cancel" } } }),
	);
	const terminal = createCaptureTerminal(80, 24);
	const pty = new PtySession();
	let stream = "";
	let ended = false;
	let failure: Error | null = null;
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
					.map(value => `'${value.replaceAll("'", "'\\''")}'`)
					.join(" "),
				cwd: profile.cwd,
				env: profile.env,
				cols: 80,
				rows: 24,
				timeoutMs: 30_000,
			},
			(error, chunk) => {
				if (error) failure = error;
				stream += chunk ?? "";
				writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk ?? "", resolve)));
			},
		)
		.then(() => {
			ended = true;
		});
	const wait = async (predicate: () => boolean, label: string, milliseconds = 10_000) => {
		const deadline = performance.now() + milliseconds;
		while (performance.now() < deadline) {
			await writes;
			if (failure) throw failure;
			if (predicate()) return;
			if (ended) throw new Error(`Candidate exited before ${label}`);
			await Bun.sleep(25);
		}
		throw new Error(`Timed out waiting for ${label}`);
	};
	try {
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		pty.write(`${surface}\r`);
		await Bun.sleep(350);
		await writes;
		const openedViewport = sanitizeViewport(viewport(terminal));
		let probe: SurfaceReceipt["keyboardProbe"];
		if (keyboardProbe && !ended) {
			pty.write("\x1b[B");
			await Bun.sleep(175);
			await writes;
			const down = sanitizeViewport(viewport(terminal));
			pty.write("\x1b[6~");
			await Bun.sleep(175);
			await writes;
			const pageDown = sanitizeViewport(viewport(terminal));
			pty.write("\x1b[A");
			await Bun.sleep(175);
			await writes;
			probe = { down, pageDown, up: sanitizeViewport(viewport(terminal)) };
		}
		if (!ended) {
			pty.write("\x1b");
			await Bun.sleep(250);
			await writes;
		}
		return {
			surface,
			startup: "ready",
			entered: true,
			escapeSent: !ended,
			processExited: ended,
			openedViewport,
			cancelledViewport: sanitizeViewport(viewport(terminal)),
			...(probe ? { keyboardProbe: probe } : {}),
		};
	} catch (error) {
		return {
			surface,
			startup: "failed",
			entered: false,
			escapeSent: false,
			processExited: ended,
			openedViewport: sanitizeViewport(viewport(terminal)),
			cancelledViewport: sanitizeViewport(viewport(terminal)),
			startupStream: sanitizeViewport(stream),
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		try {
			pty.kill();
		} catch {
			// The command may have already ended its process.
		}
		await done.catch(() => {});
		terminal.dispose();
	}
}

async function captureSide(
	directory: string,
	candidate: SideReceipt["candidate"],
	providerUrl: string,
): Promise<SideReceipt> {
	const commands = await surfaces(directory, includeChildren);
	const receipts: SurfaceReceipt[] = [];
	for (const surface of commands) {
		const receipt = await captureSurface(directory, surface, providerUrl);
		receipts.push(receipt);
		console.log(`${candidate} ${receipt.startup === "ready" ? "PASS" : "FAIL"} ${surface}`);
	}
	return { candidate, commit: await commit(directory), surfaces: receipts };
}

const provider = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: request => {
		if (new URL(request.url).pathname === "/v1/models")
			return Response.json({ data: [{ id: "claude-sonnet-4-5", object: "model" }] });
		return Response.json({ type: "message", content: [], stop_reason: "end_turn" });
	},
});
try {
	const baseline = await captureSide(baselineRoot, "published-v21.24.4", provider.url.toString());
	const current = await captureSide(preFixRoot, "pre-fix-e68d757", provider.url.toString());
	await mkdir(resolve(output, ".."), { recursive: true });
	await Bun.write(
		output,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				kind: includeChildren
					? "interactive-all-surfaces-open-cancel-only"
					: "interactive-top-level-open-cancel-only",
				keyboardProbe,
				limitation:
					"Receipts prove that each selected slash-command surface was entered at 80x24 and Escape was requested whenever its process remained alive. When keyboardProbe is true, Down, PageDown, and Up viewport states are also retained. They do not prove all selector-row coverage, mutation success/failure, persistence, retry, interruption, or full behavioral parity.",
				scope: includeChildren ? "top-level-aliases-subcommands" : "top-level-only",
				baseline,
				current,
			},
			null,
		)}\n`,
	);
	console.log(JSON.stringify({ output, baseline: baseline.surfaces.length, current: current.surfaces.length }));
} finally {
	await provider.stop(true);
}
