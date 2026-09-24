import { afterEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { ImageProtocol, TERMINAL, visibleWidth } from "@f5-sales-demo/pi-tui";
import { getThemeByName } from "../src/modes/theme/theme";
import { renderOutputBlock } from "../src/tui/output-block";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;

describe("renderOutputBlock", () => {
	it("keeps structured rails inside bordered content", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const lines = renderOutputBlock(
			{
				width: 40,
				sections: [
					{
						label: "Sources",
						structured: true,
						lines: [
							"├─ A source description whose continuation should retain its rail inside the border",
							"└─ next",
						],
					},
				],
			},
			theme,
		);
		const plain = lines.map(sanitizeText);
		expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
		expect(plain.some(line => line.includes("│  continuation"))).toBe(true);
		expect(
			plain
				.filter(line => line.includes("continuation") || line.includes("inside the border"))
				.every(line => line.startsWith("│ ")),
		).toBe(true);
	});
	const originalProtocol = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = originalProtocol;
	});

	it("passes SIXEL lines through without trimming or padding", async () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;
		const sixel = "\x1bPqabc\x1b\\";
		const lines = renderOutputBlock(
			{
				width: 40,
				sections: [{ label: "Output", lines: ["regular line", sixel] }],
			},
			uiTheme,
		);

		expect(lines.filter(line => line === sixel)).toHaveLength(1);
		const regularLine = lines.find(line => line.includes("regular line"));
		expect(regularLine).toBeDefined();
		expect(regularLine).not.toBe("regular line");
	});
});
