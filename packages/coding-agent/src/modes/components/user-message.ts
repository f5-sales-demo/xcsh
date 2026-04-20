import { Container, Markdown } from "@f5xc-salesdemos/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";

// OSC 133 shell integration: marks prompt zones for terminal multiplexers
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

// U+258C LEFT HALF BLOCK — theme-coloured left bar, matches chrome accents.
const BAR_PREFIX = "▌ ";
const BAR_PREFIX_WIDTH = 2;

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string, synthetic = false) {
		super();
		const color = synthetic
			? (value: string) => theme.fg("dim", value)
			: (value: string) => theme.fg("userMessageText", value);
		this.addChild(
			new Markdown(text, 1, 0, getMarkdownTheme(), {
				color,
			}),
		);
	}

	override render(width: number): string[] {
		const innerWidth = width - BAR_PREFIX_WIDTH;
		if (innerWidth <= 0) {
			return [];
		}
		const inner = super.render(innerWidth);
		if (inner.length === 0) {
			return inner;
		}

		const bar = theme.fg("border", BAR_PREFIX);
		const lines = inner.map(line => bar + line);

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = lines[lines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;
		return lines;
	}
}
