import { expect, test } from "bun:test";
import xterm from "@xterm/headless";
import { ansiPalette, ansiToPango, createCaptureTerminal, terminalViewportAnsi } from "../scripts/terminal-capture";

test("capture emulator reserves two terminal cells for Unicode folder symbols", async () => {
	const terminal = createCaptureTerminal(12, 3);
	try {
		await new Promise<void>(resolve => terminal.write("📁 project", resolve));
		expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getWidth()).toBe(2);
		expect(terminal.buffer.active.getLine(0)?.getCell(1)?.getWidth()).toBe(0);
		expect(Bun.stripANSI(terminalViewportAnsi(terminal)[0])).toBe("📁 project  ");
	} finally {
		terminal.dispose();
	}
});

test("viewport capture preserves final cursor edits, wide cells and terminal attributes", async () => {
	const terminal = new xterm.Terminal({ cols: 12, rows: 3, allowProposedApi: true });
	try {
		await new Promise<void>(resolve =>
			terminal.write("obsolete\r\x1b[2K\x1b[1;3;4;5;9;38;5;196;48;2;1;2;3m界A\x1b[0m\r\nsecond", resolve),
		);
		const lines = terminalViewportAnsi(terminal);
		expect(lines.map(line => Bun.stripANSI(line))).toEqual(["界A         ", "second      ", "            "]);
		expect(lines[0]).toContain("0;1;3;4;5;9;38;5;196;48;2;1;2;3m界");
		const markup = ansiToPango(lines[0], defaults);
		expect(markup).toContain('strikethrough="true"');
		expect(markup).toContain('foreground="#ff0000" background="#010203"');
	} finally {
		terminal.dispose();
	}
});

const defaults = { foreground: "#eeeeee", background: "#111111" };
test("static capture samples the visible phase of blinking cursor text", () => {
	expect(ansiToPango("\x1b[5m▏\x1b[25mtext", defaults)).toContain("▏");
	expect(ansiToPango("\x1b[6mrapid\x1b[0m", defaults)).toContain("rapid");
});
test("capture preserves standard, indexed and truecolour foreground/background selection", () => {
	expect(ansiPalette(196)).toBe("#ff0000");
	expect(ansiPalette(232)).toBe("#080808");
	const markup = ansiToPango("\x1b[31;44mA\x1b[38;5;196;48;2;1;2;3mB\x1b[0mC", defaults);
	expect(markup).toContain('foreground="#cd0000" background="#0000ee"');
	expect(markup).toContain('foreground="#ff0000" background="#010203"');
	expect(markup).toContain('foreground="#eeeeee" background="#111111">C');
});
test("capture preserves inversion, escapes markup and rejects unsupported styling", () => {
	expect(ansiToPango("\x1b[7m<&>\x1b[27mplain", defaults)).toContain(
		'foreground="#111111" background="#eeeeee">&lt;&amp;&gt;',
	);
	expect(() => ansiToPango("\x1b[999mtext", defaults)).toThrow("Unsupported");
	expect(() => ansiPalette(256)).toThrow();
});
