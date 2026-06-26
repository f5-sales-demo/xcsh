import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import type { ToolSession } from "@f5-sales-demo/xcsh/tools";
import { type TodoPhase, TodoWriteTool } from "@f5-sales-demo/xcsh/tools";
import chalk from "chalk";
import { getThemeByName } from "../../src/modes/theme/theme";
import { todoWriteToolRenderer } from "../../src/tools/todo-write";

function createSession(initialPhases: TodoPhase[] = []): ToolSession {
	let phases = initialPhases;
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		getTodoPhases: () => phases,
		setTodoPhases: next => {
			phases = next;
		},
	};
}

describe("TodoWriteTool auto-start behavior", () => {
	it("auto-starts the first task after replace", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [{ content: "status" }, { content: "diagnostics" }],
						},
					],
				},
			],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["in_progress", "pending"]);
		const summary = result.content.find(part => part.type === "text");
		if (summary?.type !== "text") throw new Error("Expected text summary from todo_write");
		expect(summary.text).toContain("Remaining items (2):");
		expect(summary.text).toContain("task-1 status [in_progress] (Execution)");
		expect(summary.text).toContain("task-2 diagnostics [pending] (Execution)");
	});

	it("auto-promotes the next pending task when current task is completed", async () => {
		const tool = new TodoWriteTool(createSession());
		await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [{ content: "status" }, { content: "diagnostics" }],
						},
					],
				},
			],
		});

		const result = await tool.execute("call-2", {
			ops: [{ op: "update", id: "task-1", status: "completed" }],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["completed", "in_progress"]);
		const summary = result.content.find(part => part.type === "text");
		if (summary?.type !== "text") throw new Error("Expected text summary from todo_write");
		expect(summary.text).toContain("Remaining items (1):");
		expect(summary.text).toContain("task-2 diagnostics [in_progress] (Execution)");

		const completedResult = await tool.execute("call-3", {
			ops: [{ op: "update", id: "task-2", status: "completed" }],
		});
		const completedSummary = completedResult.content.find(part => part.type === "text");
		if (completedSummary?.type !== "text") {
			throw new Error("Expected text summary from todo_write");
		}
		expect(completedSummary.text).toContain("Remaining items: none.");
	});

	it("keeps only one in_progress task when replace input contains multiples", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [
								{ content: "status", status: "in_progress" },
								{ content: "diagnostics", status: "in_progress" },
							],
						},
					],
				},
			],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["in_progress", "pending"]);
	});
});

describe("TodoWriteTool details field", () => {
	it("preserves details through replace op", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Work",
							tasks: [
								{ content: "Fix parser", details: "Update src/parser.ts line 42" },
								{ content: "Add tests" },
							],
						},
					],
				},
			],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks[0].details).toBe("Update src/parser.ts line 42");
		expect(tasks[1].details).toBeUndefined();
	});

	it("preserves details through add_task op", async () => {
		const tool = new TodoWriteTool(createSession());
		await tool.execute("call-1", {
			ops: [{ op: "replace", phases: [{ name: "Work", tasks: [{ content: "First" }] }] }],
		});

		const result = await tool.execute("call-2", {
			ops: [{ op: "add_task", phase: "phase-1", content: "Second", details: "Check edge cases" }],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks[1].details).toBe("Check edge cases");
	});

	it("updates details via update op", async () => {
		const tool = new TodoWriteTool(createSession());
		await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [{ name: "Work", tasks: [{ content: "Fix bug", details: "Old details" }] }],
				},
			],
		});

		const result = await tool.execute("call-2", {
			ops: [{ op: "update", id: "task-1", details: "New details with\nlines" }],
		});

		const task = result.details?.phases[0]?.tasks[0];
		expect(task?.details).toBe("New details with\nlines");
	});

	it("includes details in summary for in_progress tasks", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Work",
							tasks: [{ content: "Fix parser", details: "Edit src/parser.ts" }],
						},
					],
				},
			],
		});

		const summary = result.content.find(part => part.type === "text");
		if (summary?.type !== "text") throw new Error("Expected text summary");
		// Task is auto-promoted to in_progress, so details should appear in summary
		expect(summary.text).toContain("Edit src/parser.ts");
	});
});

describe("todoWriteToolRenderer phase indentation", () => {
	async function renderDark(phases: TodoPhase[]): Promise<string[]> {
		const theme = await getThemeByName("xcsh-dark");
		if (!theme) throw new Error("dark theme not found");
		const result = {
			content: [{ type: "text", text: "ignored" }],
			details: { phases, storage: "memory" as const },
		};
		const component = todoWriteToolRenderer.renderResult(result, { expanded: true, isPartial: false }, theme);
		return sanitizeText(component.render(120).join("\n")).split("\n");
	}

	it("indents task lines under phase headers when multiple phases exist", async () => {
		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Preparation",
				tasks: [
					{ id: "task-1", status: "in_progress", content: "Preheat oven to 350F" },
					{ id: "task-2", status: "pending", content: "Grease and flour two pans" },
				],
			},
			{
				id: "phase-2",
				name: "Baking",
				tasks: [{ id: "task-3", status: "pending", content: "Bake for 30 minutes" }],
			},
		];

		const lines = await renderDark(phases);
		const body = lines.slice(1); // drop the overall status header line

		// Phase headers keep their 2-space indent.
		const phaseHeaders = body.filter(l => l.includes("Preparation") || l.includes("Baking"));
		expect(phaseHeaders.length).toBe(2);
		for (const line of phaseHeaders) expect(line.startsWith("  ")).toBe(true);

		// Every task line must carry the same 2-space indent so tree branches
		// nest visually under the phase name.
		for (const content of ["Preheat oven to 350F", "Grease and flour two pans", "Bake for 30 minutes"]) {
			const line = body.find(l => l.includes(content));
			expect(line).toBeDefined();
			expect(line!.startsWith("  ")).toBe(true);
		}
	});

	it("renders completed tasks with chromeAccent todo.done + dim strikethrough content", async () => {
		const theme = await getThemeByName("xcsh-dark");
		if (!theme) throw new Error("dark theme not found");

		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Baking",
				tasks: [
					{ id: "task-1", status: "completed", content: "Preheat oven" },
					{ id: "task-2", status: "in_progress", content: "Bake cake" },
				],
			},
		];
		const result = {
			content: [{ type: "text", text: "ignored" }],
			details: { phases, storage: "memory" as const },
		};
		const component = todoWriteToolRenderer.renderResult(result, { expanded: true, isPartial: false }, theme);
		const raw = component.render(120).join("\n");

		// The completed-task styling now uses the todo.done symbol in
		// chromeAccent with a dim strikethrough on the content.
		const expectedCheck = theme.fg("chromeAccent", theme.todo.done);
		const expectedContent = theme.fg("dim", chalk.strikethrough("Preheat oven"));
		expect(raw).toContain(expectedCheck);
		expect(raw).toContain(expectedContent);

		// The old checkbox symbol must no longer appear for completed tasks.
		expect(raw).not.toContain(theme.fg("chromeAccent", theme.checkbox.checked));
	});

	it("appends a summary line with active/pending/completed counts for mixed lists", async () => {
		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Work",
				tasks: [
					{ id: "task-1", status: "in_progress", content: "Active" },
					{ id: "task-2", status: "pending", content: "Next" },
					{ id: "task-3", status: "pending", content: "Later" },
					{ id: "task-4", status: "completed", content: "Done" },
				],
			},
		];

		const lines = await renderDark(phases);
		const nonEmpty = lines.filter(l => l.trim().length > 0);
		const last = nonEmpty[nonEmpty.length - 1];
		expect(last.trim()).toBe("1 active, 2 pending, 1 completed");
	});

	it("uses theme.todo.active for in_progress tasks and not the old checkbox", async () => {
		const theme = await getThemeByName("xcsh-dark");
		if (!theme) throw new Error("dark theme not found");
		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Work",
				tasks: [
					{ id: "task-1", status: "in_progress", content: "Active" },
					{ id: "task-2", status: "pending", content: "Next" },
				],
			},
		];
		const result = {
			content: [{ type: "text", text: "ignored" }],
			details: { phases, storage: "memory" as const },
		};
		const raw = todoWriteToolRenderer
			.renderResult(result, { expanded: true, isPartial: false }, theme)
			.render(120)
			.join("\n");

		expect(raw).toContain(theme.fg("warning", theme.todo.active));
		// The active task must not carry the old unchecked symbol.
		expect(raw).not.toContain(theme.fg("contentAccent", `${theme.checkbox.unchecked} Active`));
	});

	it("omits the summary line for a single-task list", async () => {
		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Solo",
				tasks: [{ id: "task-1", status: "in_progress", content: "Only task" }],
			},
		];

		const lines = await renderDark(phases);
		const nonEmpty = lines.filter(l => l.trim().length > 0);
		const last = nonEmpty[nonEmpty.length - 1];
		expect(last).toContain("Only task");
		expect(last.trim()).not.toMatch(/\d+ (active|pending|completed)/);
	});

	it("does not indent task lines when only one phase is present", async () => {
		const phases: TodoPhase[] = [
			{
				id: "phase-1",
				name: "Solo",
				tasks: [
					{ id: "task-1", status: "in_progress", content: "Only task" },
					{ id: "task-2", status: "pending", content: "Second task" },
				],
			},
		];

		const lines = await renderDark(phases);
		const body = lines.slice(1);

		// No phase header rendered when phases.length === 1.
		expect(body.some(l => l.includes("Solo"))).toBe(false);

		// Task lines must not carry the multi-phase 2-space indent.
		for (const content of ["Only task", "Second task"]) {
			const line = body.find(l => l.includes(content));
			expect(line).toBeDefined();
			expect(line!.startsWith("  ")).toBe(false);
		}
	});
});
