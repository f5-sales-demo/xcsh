import { Container, Markdown, padding, Spacer, visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";

// U+2503 BOX DRAWINGS HEAVY VERTICAL — continuation bar on wrapped lines.
const CONTINUATION_BAR = "┃";
// Markdown child uses paddingX=1 and clamps contentWidth>=1, so its minimum
// render output is 3 terminal cells. Anything narrower than prefix+3 would
// overflow the requested width — bail out instead.
const MIN_MARKDOWN_WIDTH = 3;
// Leading gutter reserved for sibling GutterBlock indicators (● etc.) so the
// π / ┃ accent bar aligns with content text rather than sitting at column 0.
const GUTTER_WIDTH = 2;
const GUTTER_PAD = "  ";

/**
 * Renders a user message as an F5-branded admonition block: pi icon on the
 * first content line, heavy vertical bar on continuations (both in `border`
 * color), `userMessageBg` painted across the full requested width, and a
 * leading blank spacer separating the prompt from the preceding block.
 */
export class UserMessageComponent extends Container {
	constructor(text: string, synthetic = false) {
		super();
		const color = synthetic
			? (value: string) => theme.fg("dim", value)
			: (value: string) => `\x1b[3m${theme.fg("userMessageText", value)}\x1b[23m`;
		this.addChild(new Spacer(1));
		this.addChild(new Markdown(text, 1, 0, getMarkdownTheme(), { color }));
	}

	override render(width: number): string[] {
		const piPrefix = `${theme.icon.pi} `;
		const contPrefix = `${CONTINUATION_BAR} `;
		// Prefix width is theme-dependent — Unicode π is 1 col, Nerd Font
		// glyph and ASCII "pi" are 2 cols. Measure both and reserve the
		// larger so every content line leaves room for either shape.
		const prefixWidth = Math.max(visibleWidth(piPrefix), visibleWidth(contPrefix));
		const innerWidth = width - GUTTER_WIDTH - prefixWidth;
		if (innerWidth < MIN_MARKDOWN_WIDTH) {
			return [];
		}
		const raw = super.render(innerWidth);
		if (raw.length === 0) {
			return raw;
		}

		let firstContent = 0;
		while (firstContent < raw.length && raw[firstContent] === "") {
			firstContent++;
		}
		if (firstContent === raw.length) {
			return raw;
		}

		const leading = raw.slice(0, firstContent);
		const content = raw.slice(firstContent).map((line, i) => {
			const prefix = theme.fg("border", i === 0 ? piPrefix : contPrefix);
			const combined = prefix + line;
			const pad = Math.max(0, width - GUTTER_WIDTH - visibleWidth(combined));
			return GUTTER_PAD + theme.bg("userMessageBg", combined + padding(pad));
		});

		return [...leading, ...content];
	}
}
