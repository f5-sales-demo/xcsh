import { beforeAll, describe, expect, it } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { PythonExecutionComponent } from "../src/modes/components/python-execution";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

const ui = { requestRender: () => {} } as unknown as TUI;

// Strip ANSI and normalize NBSP to regular space — tests shouldn't care
// about the wrap-prevention character choice.
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u00a0/g, " ");
}

function renderedFooter(c: PythonExecutionComponent): string {
	return stripAnsi(c.render(80).join("\n"));
}

describe("PythonExecutionComponent — outcome + status footer", () => {
	it("running: outcome is undefined, no status footer", () => {
		const c = new PythonExecutionComponent("print('x')", ui, false);
		expect(c.outcome).toBeUndefined();
		const footer = renderedFooter(c);
		expect(footer).not.toContain("(exit");
		expect(footer).not.toContain("(error:");
		expect(footer).not.toContain("(cancelled)");
	});

	it("clean zero exit: outcome 'success', no (exit N) footer", () => {
		const c = new PythonExecutionComponent("1+1", ui, false);
		c.setComplete(0, false);
		expect(c.outcome).toBe("success");
		expect(renderedFooter(c)).not.toContain("(exit");
	});

	it("non-zero exit: outcome 'error', footer shows (exit N)", () => {
		const c = new PythonExecutionComponent("raise SystemExit(2)", ui, false);
		c.setComplete(2, false);
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(exit 2)");
	});

	it("cancelled: outcome 'error', footer shows (cancelled)", () => {
		const c = new PythonExecutionComponent("import time; time.sleep(10)", ui, false);
		c.setComplete(undefined, true);
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(cancelled)");
	});

	it("setError(Error): outcome 'error', footer shows (error: <message>)", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("interpreter not found"));
		expect(c.outcome).toBe("error");
		const footer = renderedFooter(c);
		expect(footer).toContain("(error: interpreter not found)");
		expect(footer).not.toContain("(exit");
		expect(footer).not.toContain("(cancelled)");
	});

	it("setError(string): outcome 'error', footer shows the string message", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError("spawn ENOENT");
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(error: spawn ENOENT)");
	});

	it("setError is idempotent on a terminal component", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("first"));
		c.setError(new Error("second"));
		expect(c.outcome).toBe("error");
	});

	it("setError: multi-line exception message is collapsed to a single line", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("line one\nline two"));
		const footer = renderedFooter(c);
		const errorLine = footer.split("\n").find(l => l.includes("(error:"));
		expect(errorLine).toBeDefined();
		expect(errorLine).toContain("line one");
		expect(errorLine).toContain("line two");
	});

	it("setError: tab and control characters are stripped", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("bad\tword\x07here"));
		const footer = renderedFooter(c);
		expect(footer).toContain("(error:");
		expect(footer).not.toContain("\t");
		expect(footer).not.toContain("\x07");
	});

	it("setError: overly long message is truncated with an ellipsis (rendered wide)", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("x".repeat(500)));
		const wide = stripAnsi(c.render(400).join("\n"));
		const errorLine = wide.split("\n").find(l => l.includes("(error:"));
		expect(errorLine).toBeDefined();
		// Strip the terminal-width padding before measuring the payload length.
		expect(errorLine!.trimEnd().length).toBeLessThan(250);
		expect(errorLine).toContain("…");
	});

	it("setError: narrow render width keeps the entire footer on a single row", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("x".repeat(500)));
		const narrowLines = c.render(80).map(stripAnsi);
		const errorRow = narrowLines.find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		expect(errorRow).toMatch(/\(error:.*\)/);
	});

	it("setError: gutter-wrapped layout also keeps the footer on a single row", async () => {
		const { createToolGutter } = await import("../src/modes/components/gutter-block");
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("x".repeat(500)));
		const wrapped = createToolGutter(ui, c);
		wrapped.setDone("error");
		const rows = wrapped.render(80).map(stripAnsi);
		const errorRow = rows.find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		expect(errorRow).toMatch(/\(error:.*\)/);
	});

	it("setError: ANSI-colored exception text is rendered without escape-code garbage", () => {
		const c = new PythonExecutionComponent("print", ui, false);
		c.setError(new Error("\x1b[31mboom\x1b[0m"));
		const footer = renderedFooter(c);
		const errorRow = footer.split("\n").find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		expect(errorRow).toContain("boom");
		expect(errorRow).not.toContain("[31m");
		expect(errorRow).not.toContain("[0m");
	});
});
