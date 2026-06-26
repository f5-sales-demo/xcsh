import { afterEach, describe, expect, it } from "bun:test";
import { ImageProtocol, TERMINAL } from "@f5-sales-demo/pi-tui";
import { getThemeByName } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { renderOutputBlock } from "@f5-sales-demo/xcsh/tui/output-block";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;

describe("renderOutputBlock", () => {
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
