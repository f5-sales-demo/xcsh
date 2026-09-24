import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { getThemeByName } from "../../src/modes/theme/theme";
import { renderCall, taskToolRenderer } from "../../src/task/render";
import type { AgentProgress, SingleResult, TaskToolDetails } from "../../src/task/types";
import { renderStructuredRow } from "../../src/tui/tree-list";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

function makeProgress(overrides?: Partial<AgentProgress>): AgentProgress {
	return {
		index: 0,
		id: "1-Worker",
		agent: "worker",
		agentSource: "bundled",
		status: "running",
		task: "Do some work",
		description: "doing work",
		recentTools: [],
		recentOutput: [],
		toolCount: 2,
		tokens: 100,
		durationMs: 500,
		...overrides,
	};
}

describe("task renderCall keeps only pending state (call phase)", () => {
	it("keeps the Task context rail and text column through wrapping and resize", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const sentence =
			"Verify that a long contextual sentence about transcript rendering and terminal alignment wraps within its tree branch without appearing at the left edge of the transcript.";
		const component = renderCall(
			{
				agent: "quick_task",
				tasks: [{ id: "WrapBaseline", description: "Return marker", assignment: "Return WRAP_BASELINE_OK" }],
				context: `## Goal\n${sentence}`,
			},
			{ expanded: false, isPartial: true },
			theme!,
		);
		for (const width of [80, 120, 155]) {
			const lines = component.render(width).map(sanitizeText);
			const start = lines.findIndex(line => line.includes("Verify that a long contextual sentence"));
			expect(start).toBeGreaterThan(0);
			const contextLines = lines.slice(
				start,
				lines.findIndex((line, index) => index > start && line.includes("Tasks:")),
			);
			expect(contextLines.length).toBeGreaterThan(1);
			for (const line of contextLines) {
				expect(line.startsWith(" │  ")).toBe(true);
				expect(line.length).toBeLessThanOrEqual(width);
			}
			expect(contextLines.map(line => line.slice(4)).join(" ")).toContain("left edge of the transcript.");
		}
	});
	it("call-phase text contains no terminal ✓/✗ glyphs", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = renderCall(
			{
				agent: "worker",
				tasks: [
					{ id: "One", description: "first", assignment: "do a" },
					{ id: "Two", description: "second", assignment: "do b" },
				],
			},
			{ expanded: false, isPartial: true },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		// renderCall emits icon: "pending" — verify no terminal glyphs leak.
		expect(rendered).not.toMatch(/[✓✔✗✘]/);
	});
});

describe("structured task rows", () => {
	it("wraps styled Unicode, tabs and long words at terminal cell widths", () => {
		const content = `styled \u001b[36m界🙂\u001b[0m\t${"longword".repeat(12)} ending`;
		for (const width of [24, 80, 120]) {
			const rows = renderStructuredRow(content, " │  ", " │  ", width);
			expect(rows.length).toBeGreaterThan(1);
			expect(rows.every(row => sanitizeText(row).startsWith(" │  "))).toBe(true);
			expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
			expect(rows.map(row => sanitizeText(row).slice(4)).join("")).toContain("ending");
		}
	});

	it("keeps OSC hyperlink controls attached while wrapping a linked label", () => {
		const linked =
			"\u001b]8;;https://example.invalid/reference\u0007a linked reference with several words and a long ending\u001b]8;;\u0007";
		const rows = renderStructuredRow(linked, " │  ", " │  ", 25);
		expect(rows.length).toBeGreaterThan(1);
		expect(rows.every(row => visibleWidth(row) <= 25)).toBe(true);
		expect(rows.every(row => sanitizeText(row).startsWith(" │  "))).toBe(true);
		expect(rows.map(row => sanitizeText(row).slice(4)).join(" ")).toContain("long ending");
	});

	it("keeps streaming and completed result rails and full expanded task text", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const task =
			"Verify the completed task output stays aligned inside a narrow terminal with the whole assignment visible.";
		const result: SingleResult = {
			index: 0,
			id: "0-WrapBaseline",
			agent: "quick_task",
			agentSource: "bundled",
			task,
			description:
				"Return a deliberately long status description that wraps beneath its tree branch and keeps all words visible",
			exitCode: 0,
			output: "WRAP_BASELINE_OK",
			stderr: "",
			truncated: false,
			durationMs: 10,
			tokens: 100,
		};
		for (const width of [40, 80, 120, 155]) {
			for (const details of [
				{
					projectAgentsDir: null,
					results: [],
					totalDurationMs: 10,
					progress: [makeProgress({ task, description: result.description })],
				},
				{ projectAgentsDir: null, results: [result], totalDurationMs: 10 },
			] satisfies TaskToolDetails[]) {
				const rows = taskToolRenderer
					.renderResult(
						{ content: [{ type: "text", text: "" }], details },
						{ expanded: true, isPartial: details.results.length === 0 },
						theme!,
					)
					.render(width);
				expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
				const plain = rows.map(sanitizeText);
				expect(plain.join(" ").replace(/\s+/g, " ")).toContain("whole assignment visible.");
				expect(plain.filter(row => row.includes("assignment visible.")).every(row => row.startsWith("   "))).toBe(
					true,
				);
			}
		}
	});

	it("preserves non-final nested task rails in collapsed and expanded views", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const longDescription =
			"A nested worker reports a deliberately long status that crosses several viewport rows while remaining within its original tree";
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 10,
			progress: [
				makeProgress({ id: "0-First", description: longDescription }),
				makeProgress({ id: "1-Second", description: "second" }),
			],
		};
		for (const expanded of [false, true]) {
			const rows = taskToolRenderer
				.renderResult({ content: [{ type: "text", text: "" }], details }, { expanded, isPartial: true }, theme)
				.render(42)
				.map(sanitizeText);
			const first = rows.findIndex(row => row.includes("A nested worker"));
			expect(first).toBeGreaterThanOrEqual(0);
			expect(rows[first]?.includes("├")).toBe(true);
			expect(rows[first + 1]?.startsWith("   │  ")).toBe(true);
			expect(rows.every(row => row.length <= 42)).toBe(true);
		}
	});
});

describe("task renderResult progress — terminal sub-agent states have no inline status glyph (#173)", () => {
	it("completed progress status line contains no ✓/✗/⚠ glyphs after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 1000,
			progress: [makeProgress({ status: "completed" })],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("failed progress status line contains no ✓/✗/⚠ glyphs after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 1000,
			progress: [makeProgress({ status: "failed" })],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("aborted progress status line contains no ✓/✗/⚠ glyphs after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 1000,
			progress: [makeProgress({ status: "aborted" })],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("running progress status line renders without crashing (spinner preserved)", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 500,
			progress: [makeProgress({ status: "running" })],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			theme!,
		);
		expect(() => component.render(200)).not.toThrow();
	});
});
