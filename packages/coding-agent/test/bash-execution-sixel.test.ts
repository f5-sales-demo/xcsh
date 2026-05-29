import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import type { TUI } from "@f5xc-salesdemos/pi-tui";
import { ImageProtocol, TERMINAL } from "@f5xc-salesdemos/pi-tui/terminal-capabilities";
import { BashExecutionComponent } from "@f5xc-salesdemos/xcsh/modes/components/bash-execution";
import { getThemeByName, setThemeInstance } from "@f5xc-salesdemos/xcsh/modes/theme/theme";
import { sanitizeWithImagePassthrough } from "@f5xc-salesdemos/xcsh/utils/image-passthrough";

type MutableTerminalInfo = { imageProtocol: ImageProtocol | null };
const terminal = TERMINAL as unknown as MutableTerminalInfo;

const SIXEL = "\x1bPqabc\x1b\\";

describe("BashExecutionComponent image passthrough", () => {
	const originalProtocol = TERMINAL.imageProtocol;
	const ui = { requestRender: () => {} } as unknown as TUI;

	beforeEach(async () => {
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		setThemeInstance(theme!);
	});
	afterEach(() => {
		terminal.imageProtocol = originalProtocol;
	});

	it("preserves SIXEL output when image protocol is set", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;

		const component = new BashExecutionComponent("echo sixel", ui, false);
		component.appendOutput(SIXEL);
		component.setComplete(0, false);

		expect(component.getOutput()).toContain(SIXEL);
	});

	it("does not truncate long SIXEL payload lines", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;

		const payload = `\x1bPq${"A".repeat(5000)}\x1b\\`;
		const component = new BashExecutionComponent("echo sixel", ui, false);
		component.appendOutput(payload);
		component.setComplete(0, false);

		const output = component.getOutput();
		expect(output).toContain("\x1bPq");
		expect(output).toContain("\x1b\\");
		expect(output).not.toContain("chars omitted");
	});

	it("still truncates long non-image lines", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;

		const longText = "x".repeat(5000);
		const component = new BashExecutionComponent("echo text", ui, false);
		component.appendOutput(longText);
		component.setComplete(0, false);

		const output = component.getOutput();
		expect(output).toContain("chars omitted");
		expect(output).not.toContain("\x1bPq");
	});

	it("strips image escapes when protocol is null", () => {
		terminal.imageProtocol = null;

		const sanitized = sanitizeWithImagePassthrough(SIXEL, sanitizeText);
		const component = new BashExecutionComponent("test sixel", ui, false);
		component.appendOutput(sanitized);
		component.setComplete(0, false);

		expect(component.getOutput()).not.toContain("\x1bPq");
		expect(component.getOutput()).toBe("");
	});
});

describe("BashExecutionComponent streaming throttle", () => {
	const ui = { requestRender: () => {} } as unknown as TUI;

	beforeEach(async () => {
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		setThemeInstance(theme!);
	});

	it("caps stored lines during streaming", () => {
		const component = new BashExecutionComponent("test", ui, false);

		const lines = Array.from({ length: 500 }, (_, i) => `line${i}`).join("\n");
		component.appendOutput(lines);

		const output = component.getOutput();
		const outputLineCount = output.split("\n").length;
		expect(outputLineCount).toBeLessThanOrEqual(101);
		expect(output).toContain("line499");
		expect(output).not.toContain("line0\n");
	});

	it("gate drops rapid chunks", async () => {
		const component = new BashExecutionComponent("test", ui, false);

		for (let i = 0; i < 100; i++) {
			component.appendOutput(`chunk${i}\n`);
		}

		const output = component.getOutput();
		expect(output).toContain("chunk0");
		expect(output).not.toContain("chunk99");

		await Bun.sleep(60);
		component.appendOutput("after_gate\n");
		expect(component.getOutput()).toContain("after_gate");
	});

	it("setComplete replaces streaming output with final output", () => {
		const component = new BashExecutionComponent("test", ui, false);

		component.appendOutput("streaming_line\n");
		component.setComplete(0, false, { output: "final_line_1\nfinal_line_2" });

		const output = component.getOutput();
		expect(output).toContain("final_line_1");
		expect(output).toContain("final_line_2");
		expect(output).not.toContain("streaming_line");
	});
});
