import { describe, expect, it } from "bun:test";
import { CURSOR_MARKER } from "@f5-sales-demo/pi-tui";
import { Input } from "@f5-sales-demo/pi-tui/components/input";
import { setKittyProtocolActive } from "@f5-sales-demo/pi-tui/keys";
import { visibleWidth } from "@f5-sales-demo/pi-tui/utils";
import { getIndentation } from "@f5-sales-demo/pi-utils";

function renderedWidth(input: Input, width: number): number {
	const [line] = input.render(width);
	// TUI strips this marker before its width verification; tests should mimic that.
	return visibleWidth(line.replaceAll(CURSOR_MARKER, ""));
}

describe("Input component", () => {
	const wordLeft = "\x1bb"; // ESC-b (alt+b)
	const wordRight = "\x1bf"; // ESC-f (alt+f)

	function setupAtEnd(text: string): Input {
		const input = new Input();
		input.focused = true;
		input.setValue(text);
		input.handleInput("\x05"); // Ctrl+E (end)
		return input;
	}

	it("moves by CJK and punctuation blocks (backward)", () => {
		const text = "天气不错，去散步吧！";

		{
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("天气不错，去散步吧|！");
		}

		{
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("天气不错，|去散步吧！");
		}

		{
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("天气不错|，去散步吧！");
		}

		{
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("|天气不错，去散步吧！");
		}
	});

	it("moves by CJK and punctuation blocks (forward)", () => {
		const text = "天气不错，去散步吧！";
		const input = new Input();
		input.focused = true;
		input.setValue(text);
		input.handleInput("\x01"); // Ctrl+A (start)

		input.handleInput(wordRight);
		input.handleInput("|");
		expect(input.getValue()).toBe("天气不错|，去散步吧！");
	});

	it("treats NBSP as whitespace for word navigation", () => {
		const nbsp = "\u00A0";
		const text = `Hola${nbsp}mundo`;
		const input = setupAtEnd(text);
		input.handleInput(wordLeft);
		input.handleInput("|");
		expect(input.getValue()).toBe(`Hola${nbsp}|mundo`);
	});

	it("keeps common joiners inside words", () => {
		{
			const text = "co-operate l’été";
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("co-operate |l’été");
		}

		{
			const text = "co-operate l’été";
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("|co-operate l’été");
		}
	});

	it("recognizes Unicode punctuation as delimiter blocks", () => {
		{
			const text = "¿Cómo estás? ¡Muy bien!";
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("¿Cómo estás? ¡Muy bien|!");
		}

		{
			const text = "¿Cómo estás? ¡Muy bien!";
			const input = setupAtEnd(text);
			input.handleInput(wordLeft);
			input.handleInput(wordLeft);
			input.handleInput("|");
			expect(input.getValue()).toBe("¿Cómo estás? ¡Muy |bien!");
		}
	});

	it("does not delete twice when Kitty sends backspace press and release", () => {
		setKittyProtocolActive(true);
		const input = setupAtEnd("ab");

		input.handleInput("\x1b[127u");
		expect(input.getValue()).toBe("a");

		input.handleInput("\x1b[127;1:3u");
		expect(input.getValue()).toBe("a");

		setKittyProtocolActive(false);
	});

	it("inserts NumLock keypad digits from Kitty CSI-u input", () => {
		setKittyProtocolActive(true);
		const input = setupAtEnd("a");

		input.handleInput("\x1b[57407;129u");
		expect(input.getValue()).toBe("a8");

		setKittyProtocolActive(false);
	});

	it("inserts keypad operators from Kitty CSI-u input", () => {
		setKittyProtocolActive(true);
		const input = setupAtEnd("a");

		input.handleInput("\x1b[57410u");
		expect(input.getValue()).toBe("a/");

		setKittyProtocolActive(false);
	});

	it("normalizes tabs in buffered bracketed paste using configured indentation", () => {
		const input = setupAtEnd("");

		input.handleInput("\x1b[200~a\t");
		expect(input.getValue()).toBe("");

		input.handleInput("b\r\n");
		expect(input.getValue()).toBe("");

		input.handleInput("c\x1b[201~");
		expect(input.getValue()).toBe(`a${" ".repeat(getIndentation())}bc`);
	});

	it("never renders a line wider than the terminal width (wide chars)", () => {
		const input = new Input();
		input.focused = true;
		// Long wide-script text: string length != terminal cell width.
		input.setValue("天气不错，去散步吧！".repeat(50));
		input.handleInput("\x05"); // Ctrl+E (end)
		const width = 40;
		expect(renderedWidth(input, width)).toBeLessThanOrEqual(width);
	});

	describe("masked input (tokens / passwords)", () => {
		// Build the SGR pattern without a literal ESC so the regex carries no control char.
		const sgrRe = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
		const stripAnsi = (s: string): string => s.replaceAll(CURSOR_MARKER, "").replace(sgrRe, "");

		it("getValue() still returns the real secret", () => {
			const input = new Input();
			input.setMasked(true);
			input.setValue("super-secret-token");
			expect(input.getValue()).toBe("super-secret-token");
		});

		it("render obscures the secret with bullet glyphs and leaks no real characters", () => {
			const input = new Input();
			input.focused = true;
			input.setMasked(true);
			input.setValue("hunter2");
			input.handleInput("\x05"); // Ctrl+E (cursor to end)

			const visible = stripAnsi(input.render(40)[0]);
			expect(visible).toContain("•".repeat(7)); // one bullet per grapheme
			expect(visible).not.toContain("hunter2");
			expect(visible).not.toContain("hunter");
		});

		it("typed characters are masked but captured in the value", () => {
			const input = new Input();
			input.focused = true;
			input.setMasked(true);
			input.handleInput("p");
			input.handleInput("a");
			input.handleInput("ss");
			expect(input.getValue()).toBe("pass");
			const visible = stripAnsi(input.render(40)[0]);
			expect(visible).not.toContain("pass");
			expect(visible).toContain("•".repeat(4));
		});

		it("masked render width equals unmasked for ASCII (cursor math intact)", () => {
			const masked = new Input();
			masked.focused = true;
			masked.setMasked(true);
			masked.setValue("token-1234");
			masked.handleInput("\x05");

			const plain = new Input();
			plain.focused = true;
			plain.setValue("token-1234");
			plain.handleInput("\x05");

			expect(renderedWidth(masked, 40)).toBe(renderedWidth(plain, 40));
		});

		it("unmasked input renders the real text", () => {
			const input = new Input();
			input.focused = true;
			input.setValue("visible");
			input.handleInput("\x05");
			const visible = stripAnsi(input.render(40)[0]);
			expect(visible).toContain("visible");
			expect(visible).not.toContain("•");
		});
	});
});
