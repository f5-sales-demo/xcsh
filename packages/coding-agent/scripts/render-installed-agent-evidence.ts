import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCaptureTerminal, terminalViewportAnsi, writeTerminalCapture } from "./terminal-capture";

interface Viewport {
	label: string;
	streamBytes: number;
	rows: number;
	columns: number;
	requiredText: string[];
	forbiddenText: string[];
}

/** Independent cell replay of recorded PTY output; raw render products stay private. */
export async function renderInstalledAgentEvidence(root: string): Promise<void> {
	const privateRoot = join(root, "private");
	const summaries: Array<{ scenario: string; frames: number; result: "pass" | "fail" }> = [];
	for (const entry of (await readdir(privateRoot, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (!entry.isDirectory() || entry.name === "tls") continue;
		const directory = join(privateRoot, entry.name);
		const viewportNames = (await readdir(directory)).filter(name => /^viewport-\d+\.json$/.test(name)).sort();
		if (!viewportNames.length) throw new Error(`Missing captured viewport for ${entry.name}`);
		const stream = await readFile(join(directory, "pty.bin"));
		let offset = 0;
		let valid = true;
		let terminal: ReturnType<typeof createCaptureTerminal> | undefined;
		try {
			for (const name of viewportNames) {
				const viewport = JSON.parse(await readFile(join(directory, name), "utf8")) as Viewport;
				if (
					!Number.isSafeInteger(viewport.streamBytes) ||
					viewport.streamBytes < offset ||
					viewport.streamBytes > stream.length
				)
					throw new Error(`Invalid captured byte boundary for ${entry.name}/${name}`);
				terminal ??= createCaptureTerminal(viewport.columns, viewport.rows);
				if (terminal.cols !== viewport.columns || terminal.rows !== viewport.rows)
					throw new Error(`Captured dimensions changed for ${entry.name}`);
				await new Promise<void>(done => terminal!.write(stream.subarray(offset, viewport.streamBytes), done));
				offset = viewport.streamBytes;
				const lines = terminalViewportAnsi(terminal);
				const text = Bun.stripANSI(lines.join("\n"));
				const passed =
					Array.isArray(viewport.requiredText) &&
					Array.isArray(viewport.forbiddenText) &&
					viewport.requiredText.every(value => text.includes(value)) &&
					viewport.forbiddenText.every(value => !text.includes(value));
				valid &&= passed;
				await writeTerminalCapture(
					join(directory, "rendered"),
					name.replace(".json", ""),
					lines,
					{ columns: viewport.columns, rows: viewport.rows },
					{ foreground: "#d8dee9", background: "#101522" },
					{
						kind: "actual-terminal-viewport",
						label: viewport.label,
						source: "recorded-PTY-xterm-replay",
						streamSha256: createHash("sha256").update(stream).digest("hex"),
						streamBytes: offset,
						cellAssertions: passed ? "pass" : "fail",
					},
				);
			}
		} finally {
			terminal?.dispose();
		}
		summaries.push({ scenario: entry.name, frames: viewportNames.length, result: valid ? "pass" : "fail" });
	}
	if (!summaries.length) throw new Error("No PTY evidence was rendered");
	await Bun.write(
		join(root, "receipts", "terminal-replay.json"),
		JSON.stringify(
			{
				result: summaries.every(value => value.result === "pass") ? "pass" : "fail",
				renderer: "existing-terminal-capture-with-Unicode-11-xterm",
				scenarios: summaries,
				visualReview: "rendered; image inspection is a separate recorded step",
			},
			null,
			2,
		),
	);
	if (summaries.some(value => value.result !== "pass"))
		throw new Error("Recorded terminal cells failed acceptance assertions");
}

if (import.meta.main) {
	if (process.argv.length !== 3)
		throw new Error("Usage: bun scripts/render-installed-agent-evidence.ts EVIDENCE_DIRECTORY");
	await renderInstalledAgentEvidence(resolve(process.argv[2]));
}
