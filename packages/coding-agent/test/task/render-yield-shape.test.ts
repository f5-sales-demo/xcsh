import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { AgentProgress, SingleResult, TaskToolDetails } from "../../src/task";
import { taskToolRenderer } from "../../src/task/render";

// Regression port from upstream #1989: when a subagent stores a non-array value in
// `extractedToolData.submit_result`, the renderer cast it to `Array<{ data }>` and
// then called `?.map`. Optional chaining only short-circuits on null/undefined,
// so a plain object made `.map` undefined and crashed the TUI with
// `TypeError: completeData?.map is not a function`. The renderer must tolerate
// both shapes (array and single object) without throwing, on both the live
// progress branch (`renderAgentProgress`) and the final result branch
// (`renderAgentResult`).
describe("task renderer: malformed submit_result slot", () => {
	beforeAll(async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		setThemeInstance(theme!);
	});

	afterAll(() => {
		_resetSettingsForTest();
	});

	const reviewVerdict = {
		overall_correctness: "correct",
		confidence: 0.92,
		explanation: "Looks good.",
	};

	function makeCompletedResult(extractedToolData: Record<string, unknown>): SingleResult {
		return {
			index: 0,
			id: "reviewer",
			agent: "reviewer",
			agentSource: "bundled",
			task: "review the patch",
			assignment: "review the patch",
			description: "review the patch",
			exitCode: 0,
			output: "",
			stderr: "",
			truncated: false,
			durationMs: 250,
			tokens: 100,
			// Cast deliberately: production typings declare `unknown[]`, but the
			// renderer must defend against a stray non-array value — that's
			// exactly what this regression test exercises.
			extractedToolData: extractedToolData as Record<string, unknown[]>,
		};
	}

	function makeCompletedProgress(extractedToolData: Record<string, unknown>): AgentProgress {
		return {
			index: 0,
			id: "reviewer",
			agent: "reviewer",
			agentSource: "bundled",
			status: "completed",
			task: "review the patch",
			assignment: "review the patch",
			description: "review the patch",
			recentTools: [],
			recentOutput: [],
			toolCount: 1,
			tokens: 100,
			durationMs: 250,
			extractedToolData: extractedToolData as Record<string, unknown[]>,
		};
	}

	async function renderResultText(extractedToolData: Record<string, unknown>): Promise<string> {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [makeCompletedResult(extractedToolData)],
			totalDurationMs: 250,
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: false, spinnerFrame: 0 },
			theme,
		);
		return Bun.stripANSI(component.render(160).join("\n"));
	}

	async function renderProgressText(extractedToolData: Record<string, unknown>): Promise<string> {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 250,
			progress: [makeCompletedProgress(extractedToolData)],
		};
		const component = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			theme,
		);
		return Bun.stripANSI(component.render(160).join("\n"));
	}

	it("does not throw and still surfaces the verdict when submit_result is a single object (result branch)", async () => {
		const text = await renderResultText({
			submit_result: { data: reviewVerdict, status: "success" },
		});
		expect(text).toContain("correct");
	});

	it("does not throw and still surfaces the verdict when submit_result is a single object (progress branch)", async () => {
		const text = await renderProgressText({
			submit_result: { data: reviewVerdict, status: "success" },
		});
		expect(text).toContain("correct");
	});

	it("does not throw when submit_result is a non-object primitive (both branches)", async () => {
		// Primitives can't carry a verdict — renderer must drop them silently
		// instead of crashing.
		await expect(renderResultText({ submit_result: "not-an-array" })).resolves.toBeString();
		await expect(renderProgressText({ submit_result: 42 })).resolves.toBeString();
	});

	it("still renders the canonical array shape unchanged", async () => {
		const text = await renderResultText({
			submit_result: [{ data: reviewVerdict, status: "success" }],
		});
		expect(text).toContain("correct");
	});
});
