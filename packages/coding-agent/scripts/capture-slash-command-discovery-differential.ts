import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

interface CommandDefinition {
	name: string;
	aliases?: readonly string[];
	subcommands?: readonly { name: string }[];
}

interface SurfaceReceipt {
	surface: string;
	expectedLabel: string;
	reachable: boolean;
	viewport: string;
}

interface SideReceipt {
	candidate: "published-v21.24.4" | "pre-fix-e68d757";
	commit: string;
	startup: "ready" | "failed";
	surfaces: SurfaceReceipt[];
}

const root = resolve(import.meta.dir, "../../..");
const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const args = process.argv.slice(2);
const baselineFlag = args.indexOf("--baseline-root");
if (baselineFlag === -1 || !args[baselineFlag + 1])
	throw new Error(
		"Usage: bun capture-slash-command-discovery-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const baselineRoot = resolve(args[baselineFlag + 1]!);
const preFixFlag = args.indexOf("--pre-fix-root");
if (preFixFlag === -1 || !args[preFixFlag + 1])
	throw new Error(
		"Usage: bun capture-slash-command-discovery-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const preFixRoot = resolve(args[preFixFlag + 1]!);
const outputFlag = args.indexOf("--output");
const output = resolve(
	(outputFlag === -1 ? undefined : args[outputFlag + 1]) ??
		join(root, "packages/coding-agent/test/evidence/slash-command-discovery-differential-v1/receipts.json"),
);

const baselineModule = (await import(
	`${pathToFileURL(join(baselineRoot, "packages/coding-agent/src/slash-commands/builtin-registry.ts")).href}?discovery=${Date.now()}`
)) as { BUILTIN_SLASH_COMMAND_DEFS: readonly CommandDefinition[] };
const preFixModule = (await import(
	`${pathToFileURL(join(preFixRoot, "packages/coding-agent/src/slash-commands/builtin-registry.ts")).href}?discovery=${Date.now()}`
)) as { BUILTIN_SLASH_COMMAND_DEFS: readonly CommandDefinition[] };

interface DiscoverySurface {
	surface: string;
	/** The visible completion row expected once the editor has applied this draft. */
	expectedLabel: string;
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

function surfaces(definitions: readonly CommandDefinition[], aliasesByName: Map<string, string[]>): DiscoverySurface[] {
	const bySurface = new Map<string, DiscoverySurface>();
	for (const definition of definitions) {
		bySurface.set(`/${definition.name}`, { surface: `/${definition.name}`, expectedLabel: definition.name });
		for (const alias of aliasesByName.get(definition.name) ?? definition.aliases ?? [])
			bySurface.set(`/${alias}`, { surface: `/${alias}`, expectedLabel: definition.name });
		for (const subcommand of definition.subcommands ?? [])
			bySurface.set(`/${definition.name} ${subcommand.name}`, {
				surface: `/${definition.name} ${subcommand.name}`,
				expectedLabel: subcommand.name,
			});
	}
	return [...bySurface.values()].sort((left, right) => left.surface.localeCompare(right.surface));
}

async function commit(directory: string): Promise<string> {
	const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: directory });
	if (result.exitCode !== 0) throw new Error(`Cannot resolve baseline commit: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

if ((await commit(baselineRoot)) !== BASELINE_COMMIT)
	throw new Error(`Baseline root is not ${BASELINE_COMMIT}: ${baselineRoot}`);
if ((await commit(preFixRoot)) !== PRE_FIX_COMMIT)
	throw new Error(`Pre-fix root is not ${PRE_FIX_COMMIT}: ${preFixRoot}`);

function viewport(terminal: ReturnType<typeof createCaptureTerminal>): string {
	return Array.from(
		{ length: terminal.rows },
		(_, row) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
	).join("\n");
}

function hasCompletionRow(rendered: string, label: string): boolean {
	return rendered.split("\n").some(line => line.trimStart().startsWith(`❯ ${label}`));
}

function sanitizeViewport(rendered: string): string {
	return rendered
		.replaceAll(/\/Users\/[^\n]*/g, "<user-path>")
		.replaceAll(/(?:\/private)?\/var\/folders\/[^\n]*/g, "<isolated-temp-path>")
		.replaceAll(/xcsh-terminal-uat-[A-Za-z0-9]+/g, "xcsh-terminal-uat-XXXXXX");
}

/**
 * This is deliberately discovery-only: every surface is typed into a real PTY
 * and captured before execution. It is evidence for syntax/reachability, not a
 * substitute for the command-specific mutation, failure, and parity UAT.
 */
async function captureSide(
	directory: string,
	definitions: readonly CommandDefinition[],
	candidate: SideReceipt["candidate"],
): Promise<SideReceipt> {
	const aliasesByName = registryAliases(
		await Bun.file(join(directory, "packages/coding-agent/src/slash-commands/builtin-registry.ts")).text(),
	);
	const profile = await createTerminalUatProfile({ columns: 80, rows: 24, theme: "dark", symbols: "unicode" });
	const provider = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: request => {
			if (new URL(request.url).pathname === "/v1/models")
				return Response.json({ data: [{ id: "claude-sonnet-4-5", object: "model" }] });
			return Response.json({ type: "message", content: [], stop_reason: "end_turn" });
		},
	});
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({ providers: { anthropic: { baseUrl: provider.url.toString(), apiKey: "synthetic-discovery" } } }),
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
				timeoutMs: 60_000,
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

	const wait = async (predicate: () => boolean, label: string) => {
		const deadline = performance.now() + 15_000;
		while (performance.now() < deadline) {
			await writes;
			if (failure) throw failure;
			if (predicate()) return;
			if (ended) throw new Error(`Candidate exited before ${label}: ${stream.replaceAll("\u001b", "<ESC>")}`);
			await Bun.sleep(25);
		}
		throw new Error(`Timed out waiting for ${label} in ${directory}: ${stream.replaceAll("\u001b", "<ESC>")}`);
	};

	try {
		// The published build's welcome pane is taller than 24 rows.  It can push
		// the version header out of the rendered viewport even though the editor
		// is live, so readiness must use the raw PTY stream rather than viewport
		// visibility.
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		const receipts: SurfaceReceipt[] = [];
		for (const [index, { surface, expectedLabel }] of surfaces(definitions, aliasesByName).entries()) {
			if (index > 0) {
				pty.write("\x15");
				await Bun.sleep(25);
				if (ended)
					throw new Error(`Candidate exited while clearing ${surface}: ${stream.replaceAll("\u001b", "<ESC>")}`);
			}
			pty.write(surface);
			const discoveryDeadline = performance.now() + 2_000;
			while (performance.now() < discoveryDeadline) {
				await writes;
				if (hasCompletionRow(viewport(terminal), expectedLabel)) break;
				if (failure) throw failure;
				if (ended) throw new Error(`Candidate exited while discovering ${surface}`);
				await Bun.sleep(25);
			}
			const rendered = viewport(terminal);
			receipts.push({
				surface,
				expectedLabel,
				reachable: hasCompletionRow(rendered, expectedLabel),
				viewport: sanitizeViewport(rendered),
			});
		}
		return { candidate, commit: await commit(directory), startup: "ready", surfaces: receipts };
	} finally {
		try {
			pty.kill();
		} catch {
			// Already terminated.
		}
		await done.catch(() => {});
		terminal.dispose();
		await provider.stop(true);
	}
}

// Capture sequentially: isolated profiles already prevent state sharing, and
// serialized PTYs leave each receipt attributable to one candidate stream.
const baseline = await captureSide(baselineRoot, baselineModule.BUILTIN_SLASH_COMMAND_DEFS, "published-v21.24.4");
const current = await captureSide(preFixRoot, preFixModule.BUILTIN_SLASH_COMMAND_DEFS, "pre-fix-e68d757");
await mkdir(resolve(output, ".."), { recursive: true });
await Bun.write(
	output,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			kind: "interactive-discovery-only",
			limitation:
				"Receipts prove editor-level command reachability and displayed discovery only. They do not classify execution, cancellation, mutation, persistence, retries, interruption, or behavioral parity.",
			baseline,
			current,
		},
		null,
		2,
	)}\n`,
);
console.log(
	JSON.stringify({ output, baselineSurfaces: baseline.surfaces.length, currentSurfaces: current.surfaces.length }),
);
