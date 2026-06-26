import { beforeAll, describe, expect, it } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { BashExecutionComponent } from "../src/modes/components/bash-execution";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

const ui = { requestRender: () => {} } as unknown as TUI;

// Strip ANSI escape sequences so status assertions read cleanly.
// NBSP → regular space so test matchers like `.toContain("(error: msg)")`
// don't need to care about the wrap-prevention character choice.
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u00a0/g, " ");
}

function renderedFooter(c: BashExecutionComponent): string {
	return stripAnsi(c.render(80).join("\n"));
}

describe("BashExecutionComponent — outcome + status footer", () => {
	it("running: outcome is undefined, no status footer", () => {
		const c = new BashExecutionComponent("echo hi", ui, false);
		expect(c.outcome).toBeUndefined();
		const footer = renderedFooter(c);
		expect(footer).not.toContain("(exit");
		expect(footer).not.toContain("(error:");
		expect(footer).not.toContain("(cancelled)");
	});

	it("clean zero exit: outcome 'success', no (exit N) footer", () => {
		const c = new BashExecutionComponent("echo ok", ui, false);
		c.setComplete(0, false);
		expect(c.outcome).toBe("success");
		const footer = renderedFooter(c);
		expect(footer).not.toContain("(exit");
		expect(footer).not.toContain("(error:");
	});

	it("non-zero exit: outcome 'error', footer shows (exit N)", () => {
		const c = new BashExecutionComponent("false", ui, false);
		c.setComplete(1, false);
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(exit 1)");
	});

	it("cancelled: outcome 'error', footer shows (cancelled)", () => {
		const c = new BashExecutionComponent("sleep 10", ui, false);
		c.setComplete(undefined, true);
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(cancelled)");
	});

	it("setError(Error): outcome 'error', footer shows (error: <message>)", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("shell crashed"));
		expect(c.outcome).toBe("error");
		const footer = renderedFooter(c);
		expect(footer).toContain("(error: shell crashed)");
		// Should NOT fall back to (exit undefined) or (cancelled)
		expect(footer).not.toContain("(exit");
		expect(footer).not.toContain("(cancelled)");
	});

	it("setError(string): outcome 'error', footer shows the string message", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError("spawn ENOENT");
		expect(c.outcome).toBe("error");
		expect(renderedFooter(c)).toContain("(error: spawn ENOENT)");
	});

	it("setError stops the loader and is a no-op if called twice", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("first"));
		expect(c.outcome).toBe("error");
		// Second call must not regress state or throw.
		c.setError(new Error("second"));
		expect(c.outcome).toBe("error");
	});

	it("setError: multi-line exception message is collapsed to a single line", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("line one\nline two\nline three"));
		const footer = renderedFooter(c);
		// All three parts should appear on the SAME footer line — no embedded
		// newlines that could break TUI layout.
		const errorLine = footer.split("\n").find(l => l.includes("(error:"));
		expect(errorLine).toBeDefined();
		expect(errorLine).toContain("line one");
		expect(errorLine).toContain("line two");
		expect(errorLine).toContain("line three");
	});

	it("setError: tab and control characters are stripped", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("bad\tword\x07here"));
		const footer = renderedFooter(c);
		expect(footer).toContain("(error:");
		// Raw control chars (tab, BEL) must not survive into the footer.
		expect(footer).not.toContain("\t");
		expect(footer).not.toContain("\x07");
	});

	it("setError: overly long message is truncated with an ellipsis (rendered wide)", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		const longMsg = "x".repeat(500);
		c.setError(new Error(longMsg));
		// Render at a wide terminal so the sanitizer's ellipsis is visible
		// — visual-truncate at narrow widths clips the line before the
		// trailing `…` the sanitizer appends. Layout safety at narrow
		// widths is tested below.
		const wide = stripAnsi(c.render(400).join("\n"));
		const errorLine = wide.split("\n").find(l => l.includes("(error:"));
		expect(errorLine).toBeDefined();
		// Strip the terminal-width padding before measuring the payload length.
		expect(errorLine!.trimEnd().length).toBeLessThan(250);
		expect(errorLine).toContain("…");
	});

	it("setError: narrow render width keeps the entire footer on a single row", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("x".repeat(500)));
		const narrowLines = c.render(80).map(stripAnsi);
		// The row containing `(error:` must also contain the closing `)` —
		// if the footer wrapped across multiple terminal rows, the opening
		// `(error:` would be on one row and the closing `)` on another.
		const errorRow = narrowLines.find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		expect(errorRow).toMatch(/\(error:.*\)/);
	});

	it("setError: gutter-wrapped layout also keeps the footer on a single row", async () => {
		// Real UI path: BashExecutionComponent is wrapped in a tool gutter
		// before being added to the chat container. That gutter consumes 2
		// cells on every row, tightening the footer budget beyond the
		// component's own math. Verify that the sanitizer budget is tight
		// enough that `(error: ...)` fits even under the gutter overhead.
		const { createToolGutter } = await import("../src/modes/components/gutter-block");
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("x".repeat(500)));
		const wrapped = createToolGutter(ui, c);
		wrapped.setDone("error");
		const rows = wrapped.render(80).map(stripAnsi);
		const errorRow = rows.find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		expect(errorRow).toMatch(/\(error:.*\)/);
	});

	it("setError: ANSI-colored exception text is rendered without escape-code garbage", () => {
		const c = new BashExecutionComponent("thing", ui, false);
		c.setError(new Error("\x1b[31mboom\x1b[0m"));
		const footer = renderedFooter(c);
		const errorRow = footer.split("\n").find(l => l.includes("(error:"));
		expect(errorRow).toBeDefined();
		// The CSI payload (`[31m`, `[0m`) must be fully stripped — not just
		// the ESC byte — or the footer will render `[31mboom[0m` garbage.
		expect(errorRow).toContain("boom");
		expect(errorRow).not.toContain("[31m");
		expect(errorRow).not.toContain("[0m");
	});
});
