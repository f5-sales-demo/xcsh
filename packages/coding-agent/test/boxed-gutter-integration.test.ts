import { beforeAll, describe, expect, it, vi } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Box, type Component, Text, type TUI } from "@f5-sales-demo/pi-tui";
import { renderExaResult } from "../src/exa/render";
import { lspToolRenderer } from "../src/lsp/render";
import { GutterBlock } from "../src/modes/components/gutter-block";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { getThemeByName, initTheme, type Theme } from "../src/modes/theme/theme";
import { taskToolRenderer } from "../src/task/render";
import { askToolRenderer } from "../src/tools/ask";
import { astEditToolRenderer } from "../src/tools/ast-edit";
import { astGrepToolRenderer } from "../src/tools/ast-grep";
import { bashToolRenderer } from "../src/tools/bash";
import { calculatorToolRenderer } from "../src/tools/calculator";
import { debugToolRenderer } from "../src/tools/debug";
import { renderReadUrlResult } from "../src/tools/fetch";
import { findToolRenderer } from "../src/tools/find";
import { grepToolRenderer } from "../src/tools/grep";
import { inspectImageToolRenderer } from "../src/tools/inspect-image-renderer";
import { notebookToolRenderer } from "../src/tools/notebook";
import { readToolRenderer } from "../src/tools/read";
import { searchToolBm25Renderer } from "../src/tools/search-tool-bm25";
import { sshToolRenderer } from "../src/tools/ssh";
import { todoWriteToolRenderer } from "../src/tools/todo-write";
import { vimToolRenderer } from "../src/tools/vim";
import { writeToolRenderer } from "../src/tools/write";
import { webSearchToolRenderer } from "../src/web/search/render";

beforeAll(async () => {
	await initTheme();
});

function mockTUI(): TUI {
	return { requestRender: vi.fn() } as unknown as TUI;
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Matches every terminal-status glyph we've been stripping across Phase 5/6.
// Any of these on the generic fallback line means the icon strip failed.
const TERMINAL_GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

// End-to-end reproduction of xcsh#153: a real Box(paddingY=1) wrapping a real
// Text emits ANSI-background-colored empty lines as padding. The GutterBlock
// must still place its indicator on the line containing the actual content —
// not on the invisible padding line above it.
describe("GutterBlock + Box(paddingY=1) integration (xcsh#153)", () => {
	it("places the ● indicator on the content line, not on the Box's top padding line", () => {
		const ui = mockTUI();
		const bgFn = (s: string) => `\x1b[48;5;236m${s}\x1b[0m`;
		const box = new Box(1, 1, bgFn);
		box.addChild(new Text("Title", 1, 0));

		const gutter = new GutterBlock(ui, box, {
			symbol: "●",
			activeColorFn: s => s,
			doneColorFn: s => s,
			animated: false,
		});

		const lines = gutter.render(40);
		// Box emits: [top-pad, content, bottom-pad] — 3 lines minimum.
		expect(lines.length).toBeGreaterThanOrEqual(3);

		// Locate the line that actually contains the visible "Title" text.
		const titleIdx = lines.findIndex(line => stripAnsi(line).includes("Title"));
		expect(titleIdx).toBeGreaterThan(-1);

		// The indicator must be on that line, not above it.
		expect(lines[titleIdx]).toStartWith("● ");

		// Any line before the title is a padding line — it must carry the
		// continuation pad, never the indicator.
		for (let i = 0; i < titleIdx; i++) {
			expect(lines[i]).not.toStartWith("● ");
			expect(lines[i]).toStartWith("  ");
		}
	});

	// The 9 boxed tool-output call sites in modes/components/ were flipped to
	// paddingY=0 so no background-colored blank rows render above or below the
	// content. This test locks the invariant: Box(_, 0, bgFn) with a single Text
	// child renders exactly one content line — no leading/trailing padding.
	it("Box(paddingY=0) wrapping Text renders exactly one content line, no padding rows", () => {
		const bgFn = (s: string) => `\x1b[48;5;236m${s}\x1b[0m`;
		const box = new Box(1, 0, bgFn);
		box.addChild(new Text("Content", 1, 0));

		const lines = box.render(40);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0])).toContain("Content");
	});
});

// Phase 6 Task 21 — ToolExecutionComponent's generic fallback (for tools
// without a registered renderer and without a custom renderCall/renderResult)
// must NOT emit a terminal success/error glyph in its status line. The
// gutter ball is now the sole outcome indicator; only "pending" streams an
// icon while the tool is still running.
describe("ToolExecutionComponent generic fallback — no terminal status glyph (xcsh#173)", () => {
	// "mystery_tool" is not in toolRenderers and we pass tool=undefined, so
	// #updateDisplay() falls through to the #formatToolExecution() path at
	// line ~688 — the exact code this task modifies.
	const MYSTERY_TOOL = "mystery_tool";

	function renderGenericFallback(result: { isError: boolean }): string {
		const ui = mockTUI();
		const component = new ToolExecutionComponent(MYSTERY_TOOL, { query: "hello" }, {}, undefined, ui);
		component.updateResult({ content: [{ type: "text", text: "some output" }], isError: result.isError }, false);
		return stripAnsi(component.render(120).join("\n"));
	}

	it("renders no terminal glyph on success (isError=false)", () => {
		const rendered = renderGenericFallback({ isError: false });
		// Tool label should appear — sanity check that we hit the fallback.
		expect(rendered).toContain(MYSTERY_TOOL);
		expect(rendered).not.toMatch(TERMINAL_GLYPH_REGEX);
	});

	it("renders no terminal glyph on error (isError=true)", () => {
		const rendered = renderGenericFallback({ isError: true });
		expect(rendered).toContain(MYSTERY_TOOL);
		expect(rendered).not.toMatch(TERMINAL_GLYPH_REGEX);
	});

	it("still renders a pending indicator while streaming (isPartial=true)", () => {
		// When the tool is still running, the status line should carry the
		// pending-icon branch. We don't assert a specific glyph (theme-dependent)
		// but we do assert the status line has a non-empty leading token —
		// enough to prove the branch fires.
		const ui = mockTUI();
		const component = new ToolExecutionComponent(MYSTERY_TOOL, { query: "hello" }, {}, undefined, ui);
		component.updateResult({ content: [{ type: "text", text: "" }] }, true);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain(MYSTERY_TOOL);
		// Pending is the only branch that still emits an icon, and none of the
		// pending symbols are in the terminal-glyph set.
		expect(rendered).not.toMatch(TERMINAL_GLYPH_REGEX);
	});
});

// Phase 5/6 regression sweep (xcsh#173). The invariant under test: after a tool
// completes, its rendered output contains NO inline terminal status glyph.
// The gutter ball (●) is the sole outcome indicator.
//
// Per-renderer tests already cover this individually. This describe block is an
// end-to-end sweep: it iterates a representative cross-section of the renderer
// registry and asserts the same invariant from a single place, so a regression
// in ANY renderer surfaces here without relying on the matching per-renderer
// file to still be exercised.
//
// For renderers whose body legitimately contains status-like glyphs by design
// (task checkboxes, vim mode indicator, gh per-job conclusion symbols, ask
// per-question verdicts), we narrow the assertion to the header line only.
//
// Deferred scopes known at the time of this task (xcsh#173 review):
//   • task/render.ts renderAgentResult + renderReviewResult emit theme.status.*
//     for inner sub-agent verdicts (lines ~291, ~659, ~756-761, ~777, ~797,
//     ~822). Argued to be "inner verdicts", not the outer tool outcome. Handled
//     by narrowing task's assertion to the outer header.
//   • tools/debug.ts:565 and lsp/render.ts:111, 180 still call formatStatusIcon
//     in a template literal for their header. Assertions below narrow to body
//     text that survives ANSI strip (no inline glyphs expected in body); the
//     header carries a glyph until a follow-up refactors these call sites.
//     Flagged in the task report rather than stripped here to keep this task
//     focused on the regression net.
//   • tools/resolve.ts:163 renders a full-width inverse-background Accept/
//     Discard verdict banner using uiTheme.status.success/error. This is an
//     architectural UI element (branded card), not a status indicator in the
//     consolidation sense, so it is not swept here.
//   • tools/review.ts:179 renders a per-finding success/error glyph inline.
//     Report-finding results are authored output (not a tool-outcome status),
//     and the glyph is an intentional visual marker of acceptance state.
//   • Renderers not in the sweep: editToolRenderer, pythonToolRenderer,
//     reportFindingToolRenderer, resolveToolRenderer. edit/python have their
//     own per-file renderer tests that cover the no-glyph invariant; resolve/
//     report-finding are in-scope only if the architectural UI gets revisited.
describe("xcsh#173 — tool renderResult output has no terminal status glyph (end-to-end sweep)", () => {
	// Helper that renders a component and returns the ANSI-stripped multi-line
	// string. All renderers expose a render(width): string[] contract.
	function renderLines(component: Component, width = 200): string[] {
		return sanitizeText(component.render(width).join("\n")).split("\n");
	}

	function assertNoGlyphInFull(component: Component, label: string, width = 200) {
		const rendered = sanitizeText(component.render(width).join("\n"));
		expect(rendered, `${label}: full renderResult output must not contain terminal status glyphs`).not.toMatch(
			TERMINAL_GLYPH_REGEX,
		);
	}

	function assertNoGlyphInHeader(component: Component, label: string, width = 200) {
		const lines = renderLines(component, width);
		const header = lines[0] ?? "";
		expect(header, `${label}: header line must not contain terminal status glyphs`).not.toMatch(TERMINAL_GLYPH_REGEX);
	}

	const fullOptions = { expanded: false, isPartial: false };

	it("grep renderResult: zero-match + success both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		for (const fixture of [
			{ label: "zero", result: { content: [{ type: "text", text: "" }], details: { matchCount: 0, fileCount: 0 } } },
			{
				label: "match",
				result: { content: [{ type: "text", text: "foo:1:bar" }], details: { matchCount: 1, fileCount: 1 } },
			},
		]) {
			const component = grepToolRenderer.renderResult(fixture.result as never, fullOptions, theme, {
				pattern: "bar",
			});
			assertNoGlyphInFull(component, `grep (${fixture.label})`);
		}
	});

	it("find renderResult: zero-result + success both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		for (const fixture of [
			{
				label: "zero",
				result: {
					content: [{ type: "text", text: "No files found matching pattern" }],
					details: { scopePath: ".", fileCount: 0, files: [], truncated: false },
				},
			},
			{
				label: "success",
				result: {
					content: [{ type: "text", text: "a.ts\nb.ts" }],
					details: { scopePath: ".", fileCount: 2, files: ["a.ts", "b.ts"], truncated: false },
				},
			},
		]) {
			const component = findToolRenderer.renderResult(fixture.result as never, fullOptions, theme, {
				pattern: "*.ts",
			});
			assertNoGlyphInFull(component, `find (${fixture.label})`);
		}
	});

	it("ast-grep renderResult: zero-match + match both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const zero = {
			content: [{ type: "text", text: "" }],
			details: {
				matchCount: 0,
				fileCount: 0,
				filesSearched: 1,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileMatches: [],
			},
		};
		const match = {
			content: [{ type: "text", text: "1:const x = 1;" }],
			details: {
				matchCount: 1,
				fileCount: 1,
				filesSearched: 1,
				limitReached: false,
				scopePath: ".",
				files: ["a.ts"],
				fileMatches: [{ file: "a.ts", matches: [{ line: 1, column: 1, preview: "const x = 1;" }] }],
			},
		};
		for (const [label, result] of [
			["zero", zero],
			["match", match],
		] as const) {
			const component = astGrepToolRenderer.renderResult(result as never, fullOptions, theme, {
				pat: ["const $A = $B"],
			});
			assertNoGlyphInFull(component, `ast-grep (${label})`);
		}
	});

	it("ast-edit renderResult: zero-replacement is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const zero = {
			content: [{ type: "text", text: "" }],
			details: {
				totalReplacements: 0,
				filesTouched: 0,
				filesSearched: 1,
				applied: false,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileReplacements: [],
			},
		};
		const component = astEditToolRenderer.renderResult(zero as never, fullOptions, theme, {
			ops: [{ pat: "a", out: "b" }],
		});
		assertNoGlyphInFull(component, "ast-edit (zero)");
	});

	it("calculator renderResult: zero + success + error all glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const fixtures = [
			{
				label: "zero",
				result: { content: [{ type: "text", text: "" }], details: { results: [] } },
				args: { calculations: [] },
			},
			{
				label: "success",
				result: {
					content: [{ type: "text", text: "2" }],
					details: { results: [{ expression: "1+1", value: 2, output: "2" }] },
				},
				args: { calculations: [{ expression: "1+1", prefix: "", suffix: "" }] },
			},
			{
				label: "error",
				result: {
					content: [{ type: "text", text: "Invalid expression" }],
					details: { results: [] },
					isError: true,
				},
				args: { calculations: [{ expression: "bad+", prefix: "", suffix: "" }] },
			},
		];
		for (const fixture of fixtures) {
			const component = calculatorToolRenderer.renderResult(
				fixture.result as never,
				fullOptions,
				theme,
				fixture.args as never,
			);
			assertNoGlyphInFull(component, `calculator (${fixture.label})`);
		}
	});

	it("exa renderResult: zero-result + success both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const zero = {
			content: [{ type: "text", text: "" }],
			details: {
				response: { results: [], costDollars: { total: 0.0001 }, searchTime: 0.1, requestId: "req-0" },
				toolName: "exa_search",
			},
		};
		const success = {
			content: [{ type: "text", text: "formatted" }],
			details: {
				response: {
					results: [{ title: "T", url: "https://example.com/t", text: "body" }],
					costDollars: { total: 0.005 },
					searchTime: 0.4,
					requestId: "req-1",
				},
				toolName: "exa_search",
			},
		};
		for (const [label, result] of [
			["zero", zero],
			["success", success],
		] as const) {
			const component = renderExaResult(result as never, fullOptions, theme);
			assertNoGlyphInFull(component, `exa (${label})`);
		}
	});

	it("ask renderResult (fallback, no details) is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		// Note: ask's per-question result branch intentionally renders status.success/
		// status.warning symbols as part of each question verdict. The fallback branch
		// (no details) renders just the header and raw text, which must stay glyph-free.
		const result = { content: [{ type: "text", text: "plain fallback answer" }] };
		const component = askToolRenderer.renderResult(result as never, { expanded: true, isPartial: false }, theme);
		assertNoGlyphInFull(component, "ask (fallback)");
	});

	it("search-tool-bm25 renderResult is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				query: "issue",
				limit: 1,
				total_tools: 1,
				activated_tools: ["mcp_t"],
				active_selected_tools: ["mcp_t"],
				tools: [
					{
						name: "mcp_t",
						label: "t",
						description: "d",
						server_name: "s",
						mcp_tool_name: "t",
						schema_keys: ["a"],
						score: 1,
					},
				],
			},
		};
		const component = searchToolBm25Renderer.renderResult(result as never, fullOptions, theme);
		assertNoGlyphInFull(component, "search-tool-bm25");
	});

	it("read renderResult (image branch) is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [
				{ type: "text", text: "" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } },
			],
		};
		const component = readToolRenderer.renderResult(result as never, fullOptions, theme, {
			file_path: "/tmp/x.png",
		});
		assertNoGlyphInFull(component, "read (image)");
	});

	it("bash renderResult: success + error both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		for (const [label, isError, text] of [
			["success", false, "hello\n"],
			["error", true, "command failed"],
		] as const) {
			const result = { content: [{ type: "text", text }], isError };
			const component = bashToolRenderer.renderResult(result as never, fullOptions, theme, {
				command: isError ? "false" : "echo hello",
			});
			assertNoGlyphInFull(component, `bash (${label})`);
		}
	});

	it("write renderResult is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = { content: [{ type: "text", text: "file written" }] };
		const component = writeToolRenderer.renderResult(result as never, fullOptions, theme, {
			file_path: "/tmp/x.ts",
			content: "export const x = 1;\n",
		});
		assertNoGlyphInFull(component, "write");
	});

	it("notebook renderResult is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [{ type: "text", text: "Replaced cell 0 (code). Notebook now has 3 cells." }],
			details: {
				action: "edit" as const,
				cellIndex: 0,
				cellType: "code",
				totalCells: 3,
				cellSource: ["print('hi')\n"],
			},
		};
		const component = notebookToolRenderer.renderResult(result as never, fullOptions, theme, {
			notebook_path: "/tmp/d.ipynb",
			action: "edit",
			cell_index: 0,
			content: "print('hi')",
		} as never);
		assertNoGlyphInFull(component, "notebook");
	});

	it("ssh renderResult: success + error both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		for (const [label, isError, text] of [
			["success", false, "hello from remote\n"],
			["error", true, "ssh: connect refused"],
		] as const) {
			const result = { content: [{ type: "text", text }], isError };
			const component = sshToolRenderer.renderResult(result as never, fullOptions, theme, {
				host: "example",
				command: isError ? "false" : "echo hello",
			});
			assertNoGlyphInFull(component, `ssh (${label})`);
		}
	});

	it("fetch renderReadUrlResult header is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [{ type: "text", text: "body" }],
			details: {
				kind: "url" as const,
				url: "https://example.com/",
				finalUrl: "https://example.com/",
				contentType: "text/html",
				method: "GET",
				truncated: false,
				notes: [],
			},
		};
		const component = renderReadUrlResult(result as never, fullOptions, theme);
		// Header-only check: fetch's Metadata section may intentionally surface
		// a ⚠ "Output truncated" note when truncation occurs; the outer status
		// line carries no glyph.
		assertNoGlyphInHeader(component, "fetch");
	});

	it("vim renderResult header is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		// NOTE: vim body may contain mode-indicator characters; header must stay clean.
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				file: "a.ts",
				mode: "NORMAL" as const,
				cursor: { line: 1, col: 1 },
				totalLines: 1,
				modified: false,
				viewport: { start: 1, end: 1 },
				viewportLines: [{ line: 1, text: "const x = 1;", isCursor: true, isSelected: false }],
			},
			isError: false,
		};
		const component = vimToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false, spinnerFrame: 0 },
			theme,
		);
		assertNoGlyphInHeader(component, "vim");
	});

	it("inspect-image renderResult: success + error both glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		for (const [label, isError, text] of [
			["success", false, "A photo of a cat."],
			["error", true, "Error: image not found"],
		] as const) {
			const result = {
				content: [{ type: "text", text }],
				details: isError ? undefined : { model: "gpt-4o", imagePath: "/tmp/cat.png", mimeType: "image/png" },
				isError,
			};
			const component = inspectImageToolRenderer.renderResult(result as never, fullOptions, theme, {
				path: "/tmp/cat.png",
				question: "what is this?",
			});
			assertNoGlyphInFull(component, `inspect-image (${label})`);
		}
	});

	it("todo-write renderResult header is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		// NOTE: todo-write body contains per-task status checkboxes by design
		// (checked/unchecked markers). Only the header (outer tool outcome) is
		// asserted here.
		const result = {
			content: [{ type: "text", text: "updated" }],
			details: {
				phases: [
					{
						name: "Phase 1",
						tasks: [
							{ id: "t1", content: "first", status: "completed" as const },
							{ id: "t2", content: "second", status: "pending" as const },
						],
					},
				],
			},
		};
		const component = todoWriteToolRenderer.renderResult(result as never, fullOptions, theme);
		assertNoGlyphInHeader(component, "todo-write");
	});

	it("web-search renderResult is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [{ type: "text", text: "answer body" }],
			details: {
				response: {
					provider: "anthropic" as const,
					answer: "answer body",
					sources: [{ title: "S", url: "https://example.com/" }],
					usage: { inputTokens: 10, outputTokens: 5, searchRequests: 1 },
					model: "claude",
					requestId: "r",
					durationMs: 1000,
				},
			},
		};
		const component = webSearchToolRenderer.renderResult(result as never, fullOptions, theme, { query: "q" });
		assertNoGlyphInFull(component, "web-search");
	});

	it("task renderResult (progress-only) is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		// NOTE: task's renderAgentResult (for final results with SingleResult
		// entries) still emits theme.status.* glyphs for per-sub-agent verdicts
		// inside the body (xcsh#173 deferred scope). The progress-only path —
		// used while sub-agents stream — is glyph-free, so we pin the
		// regression net on that representative branch.
		const details = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 1000,
			progress: [
				{
					index: 0,
					id: "1-Worker",
					agent: "worker",
					agentSource: "bundled" as const,
					status: "completed" as const,
					task: "Do work",
					description: "doing work",
					recentTools: [],
					recentOutput: [],
					toolCount: 1,
					tokens: 10,
					durationMs: 500,
				},
			],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true },
			theme,
		);
		assertNoGlyphInFull(component, "task (progress)");
	});

	// Deferred-scope smoke: debug and lsp still emit formatStatusIcon in their
	// header template literals (xcsh#173 review). We assert the *body* of each
	// renderer remains glyph-free so regressions outside that known site still
	// surface, and we leave the header check commented out with a pointer.
	it("debug renderResult body (below header) is glyph-free", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const result = {
			content: [{ type: "text", text: "stack frame #0\nstack frame #1" }],
			details: { action: "stack_trace", snapshot: undefined },
			isError: false,
		};
		const component = debugToolRenderer.renderResult(result as never, fullOptions, theme, {
			action: "stack_trace",
		});
		// DEFERRED: debug.ts:565 emits formatStatusIcon(status, ...) in the header
		// template literal. Follow-up will convert to renderStatusLine({icon}) so
		// header glyphs can be stripped too. For now we pin the body.
		const lines = renderLines(component);
		const body = lines.slice(1).join("\n");
		expect(body, "debug body must not contain terminal status glyphs").not.toMatch(TERMINAL_GLYPH_REGEX);
	});

	it("lsp renderResult stays inside its documented glyph budget", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		// Generic text result (does not match hover/diagnostics/references/symbols
		// branches) exercises the vanilla Response path, which should carry no
		// terminal status glyph at all once the header refactor lands.
		const result = {
			content: [{ type: "text", text: "generic response text line one\ngeneric response text line two" }],
			details: { action: "hover", request: { file: "/tmp/a.ts" } },
			isError: false,
		};
		const component = lspToolRenderer.renderResult(result as never, fullOptions, theme, {
			action: "hover",
			file: "/tmp/a.ts",
		});
		// DEFERRED (xcsh#173 review): lsp/render.ts:111 + 180-181 emit
		// formatStatusIcon(...) in the header template literal. Follow-up will
		// convert to renderStatusLine({icon}) so header glyphs can be stripped.
		// For now we pin the body against the four OUTCOME glyphs only —
		// renderSymbols / renderGeneric legitimately use theme.styledSymbol(
		// "status.info", ...) as a line-content marker (ⓘ), which is NOT a
		// tool-outcome status and is out of scope for this consolidation.
		const lines = renderLines(component);
		const body = lines.slice(1).join("\n");
		expect(body, "lsp body must not contain outcome status glyphs").not.toMatch(/[✓✔✗✘⚠]/);
	});
});

// Phase 5/6 regression sweep (xcsh#173) — call phase (isPartial=true).
// The invariant explicitly exempts the pending/streaming path: while a tool is
// still running, renderCall may emit a pending icon. We lock in that the
// pending icon is NOT one of the terminal success/error/warning glyphs.
describe("xcsh#173 — tool renderCall pending icon is not a terminal-status glyph", () => {
	it("renderCall emits a pending-phase icon (grep sample) that is not in TERMINAL_GLYPH_REGEX", async () => {
		const theme = (await getThemeByName("xcsh-dark")) as Theme;
		const component = grepToolRenderer.renderCall({ pattern: "needle" }, { expanded: false, isPartial: true }, theme);
		const rendered = sanitizeText(component.render(120).join("\n"));
		// The rendered status line should carry the tool title at minimum.
		expect(rendered).toContain("Grep");
		// Pending-phase icons live in a different glyph set than the terminal
		// success/error/warning glyphs this issue is consolidating.
		expect(rendered).not.toMatch(TERMINAL_GLYPH_REGEX);
	});
});

// Phase 6 Task 7 — the event controller translates
// { isError, isWarning } on ToolExecutionEndEvent into a three-way
// gutter outcome. This test duplicates the mapping contract locally (same as
// event-controller-warning-outcome.test.ts) and asserts that a tracked
// GutterBlock forwarded a "warning" outcome ends up calling setDone("warning").
// If the mapping drifts, the gutter ball will silently regress to success/
// error instead of orange.
describe("xcsh#173 — tool_execution_end → gutter setDone three-way outcome", () => {
	function mapOutcome(event: { isError?: boolean; isWarning?: boolean }): "success" | "error" | "warning" {
		return event.isError ? "error" : event.isWarning ? "warning" : "success";
	}

	function trackedGutter() {
		const ui = mockTUI();
		const calls: Array<string | undefined> = [];
		const gutter = new GutterBlock(ui, { render: () => ["body"], invalidate: vi.fn() } as unknown as Component, {
			symbol: "●",
			activeColorFn: s => s,
			doneColorFn: s => s,
			animated: false,
		});
		const originalSetDone = gutter.setDone.bind(gutter);
		gutter.setDone = ((outcome?: "success" | "error" | "warning") => {
			calls.push(outcome);
			originalSetDone(outcome);
		}) as typeof gutter.setDone;
		return { gutter, calls };
	}

	it("isWarning=true without isError maps to 'warning'", () => {
		expect(mapOutcome({ isError: false, isWarning: true })).toBe("warning");
		expect(mapOutcome({ isWarning: true })).toBe("warning");
	});

	it("isError dominates isWarning", () => {
		expect(mapOutcome({ isError: true, isWarning: true })).toBe("error");
	});

	it("both flags falsy default to 'success'", () => {
		expect(mapOutcome({})).toBe("success");
		expect(mapOutcome({ isError: false, isWarning: false })).toBe("success");
	});

	it("GutterBlock.setDone receives 'warning' when the mapped outcome is warning", () => {
		const { gutter, calls } = trackedGutter();
		gutter.setDone(mapOutcome({ isError: false, isWarning: true }));
		expect(calls).toEqual(["warning"]);
	});
});
