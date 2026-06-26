import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { getThemeByName } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { renderCall, taskToolRenderer } from "../../src/task/render";
import type { AgentProgress, TaskToolDetails } from "../../src/task/types";

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
