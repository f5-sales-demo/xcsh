import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { CopySelectorComponent } from "../src/modes/components/copy-selector";
import { getCurrentThemeName, setSymbolPreset, setTheme } from "../src/modes/theme/theme";
import type { SessionMessageEntry } from "../src/session/session-manager";
import { writeTerminalCapture } from "./terminal-capture";

// Synthetic component evidence only: no clipboard, credentials, browser or user session is accessed.
const root = resolve(import.meta.dir, "../../..");
const output = await mkdtemp(join(tmpdir(), "xcsh-copy-selector-captures-"));
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: root });
if (revision.exitCode || diff.exitCode) throw new Error("Cannot establish capture provenance");
const hash = createHash("sha256").update(diff.stdout);
for (const pattern of [
	"packages/coding-agent/src/modes/**/*.ts",
	"packages/coding-agent/src/config/**/*.ts",
	"packages/tui/src/**/*.ts",
	"packages/coding-agent/scripts/*capture*.ts",
]) {
	for (const file of [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort()) {
		hash.update(file).update(await Bun.file(join(root, file)).bytes());
	}
}
const fingerprint = hash.digest("hex");

function entry(id: string, message: AgentMessage): SessionMessageEntry {
	return { type: "message", id, parentId: null, timestamp: "2026-09-10T00:00:00Z", message };
}
function user(id: string, content: string): SessionMessageEntry {
	return entry(id, { role: "user", content, timestamp: 1 });
}
function assistant(id: string, text: string): SessionMessageEntry {
	return entry(id, {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "synthetic-capture",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	} as AgentMessage);
}

const browseEntries = [
	user("entry-user-0001", "Show a safe synthetic example."),
	assistant(
		"entry-assistant-0002",
		"Here is the synthetic result.\n```ts\nconst synthetic = true;\n```\n[Documentation](https://example.test/docs)",
	),
];
const longEntries = [
	user("entry-long-0003", Array.from({ length: 45 }, (_, index) => `Synthetic detail line ${index + 1}`).join("\n")),
];
const earlierEntries = [
	user("entry-earlier-0000", "Earlier synthetic request"),
	...Array.from({ length: 700 }, (_, index) => assistant(`entry-tail-${index}`, `Synthetic response ${index}`)),
];

function selector(entries: SessionMessageEntry[], rows: number) {
	return new CopySelectorComponent(entries, {
		requestRender() {},
		onPick() {},
		onOpen() {},
		onCancel() {},
		viewportRows: () => rows,
		loadAllEntries: () => entries,
	});
}

const scenarios: Array<{
	name: string;
	actions: string[];
	expected: string;
	build: (rows: number, columns: number) => CopySelectorComponent;
}> = [
	{
		name: "browse",
		actions: ["open /copy"],
		expected: "Searchable identity-qualified transcript list; newest entry selected",
		build: (rows: number) => selector(browseEntries, rows),
	},
	{
		name: "no-match",
		actions: ["open /copy", "type zzzz-no-match into search"],
		expected: "Explicit no-match state; Escape clears search before closing",
		build: (rows: number) => {
			const component = selector(browseEntries, rows);
			component.handleInput("zzzz-no-match");
			return component;
		},
	},
	{
		name: "actions",
		actions: ["open /copy", "open selected assistant entry"],
		expected: "Explicit whole-entry, block-copy and link-open actions; first action selected",
		build: (rows: number) => {
			const component = selector(browseEntries, rows);
			component.handleInput("\r");
			return component;
		},
	},
	{
		name: "details-paged",
		actions: ["open /copy", "open long entry", "page down once"],
		expected: "Long action details page without losing selected action or parent identity",
		build: (rows: number, columns: number) => {
			const component = selector(longEntries, rows);
			component.handleInput("\r");
			component.render(columns);
			component.handleInput("\x1b[6~");
			return component;
		},
	},
	{
		name: "earlier-history",
		actions: ["open /copy with a bounded 600-entry tail"],
		expected: "Explicit sticky Load earlier transcript action while latest identity stays selected",
		build: (rows: number) => selector(earlierEntries, rows),
	},
	{
		name: "empty",
		actions: ["render /copy with no transcript entries"],
		expected: "Explicit empty state without a selectable mutation",
		build: (rows: number) => selector([], rows),
	},
];

let count = 0;
for (const theme of ["xcsh-dark", "xcsh-light"]) {
	for (const symbols of ["unicode", "ascii"] as const) {
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		] as const) {
			await setSymbolPreset(symbols);
			if (!(await setTheme(theme)).success || getCurrentThemeName() !== theme)
				throw new Error("Wrong capture theme");
			for (const scenario of scenarios) {
				const component = scenario.build(rows, columns);
				const lines = component.render(columns);
				await writeTerminalCapture(
					output,
					`${scenario.name}-${columns}x${rows}-${theme}-${symbols}`,
					lines,
					{ columns, rows },
					theme === "xcsh-dark"
						? { foreground: "#d8dee9", background: "#1f2430" }
						: { foreground: "#2e3440", background: "#f7f7f5" },
					{
						fixture: "copy-selector-synthetic-v1",
						theme,
						symbols,
						state: scenario.name,
						actions: scenario.actions,
						expected: scenario.expected,
						observed: { renderedRows: lines.length, targetCount: component.targetCount },
						revision: revision.stdout.toString().trim(),
						fingerprint,
						fingerprintScope: "tracked diff plus mode/config/TUI/capture sources",
						persistenceProof: false,
						baseline: "current candidate component fixture, not historical baseline",
					},
				);
				component.dispose();
				count++;
			}
		}
	}
}
console.log(JSON.stringify({ output, captures: count, fingerprint }));
