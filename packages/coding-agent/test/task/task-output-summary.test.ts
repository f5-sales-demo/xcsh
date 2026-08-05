import { describe, expect, test } from "bun:test";
import { prompt } from "@f5-sales-demo/pi-utils";
import taskSummaryTemplate from "../../src/prompts/tools/task-summary.md" with { type: "text" };
import { buildTaskOutputSummaries } from "../../src/task/summary";
import type { SingleResult } from "../../src/task/types";

function result(output: string): SingleResult {
	return {
		index: 0,
		id: "Review",
		agent: "explore",
		agentSource: "bundled",
		task: "Review the fixture",
		description: "Review",
		exitCode: 0,
		output,
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 1,
	};
}

describe("task output summaries", () => {
	test("headless tasks do not advertise an agent URL after their temporary artifacts are removed", () => {
		const [summary] = buildTaskOutputSummaries([result(`first line\n${"x".repeat(6000)}`)], false);
		const rendered = prompt.render(taskSummaryTemplate, {
			successCount: 1,
			totalCount: 1,
			cancelledCount: 0,
			hasCancelledNote: false,
			duration: "1ms",
			summaries: [summary],
			mergeSummary: "",
		});

		expect(summary.truncated).toBe(true);
		expect(summary.fullOutputUrl).toBeUndefined();
		expect(rendered).toContain("<preview>");
		expect(rendered).not.toContain("agent://");
	});

	test("persisted tasks retain their readable agent URL", () => {
		const [summary] = buildTaskOutputSummaries([result(`first line\n${"x".repeat(6000)}`)], true);
		const rendered = prompt.render(taskSummaryTemplate, {
			successCount: 1,
			totalCount: 1,
			cancelledCount: 0,
			hasCancelledNote: false,
			duration: "1ms",
			summaries: [summary],
			mergeSummary: "",
		});

		expect(summary.fullOutputUrl).toBe("agent://Review");
		expect(rendered).toContain('<preview full-path="agent://Review">');
	});
});
