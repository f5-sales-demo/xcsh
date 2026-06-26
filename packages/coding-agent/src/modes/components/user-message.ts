import { Container, Markdown, padding, Spacer, visibleWidth } from "@f5-sales-demo/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";

// U+2503 BOX DRAWINGS HEAVY VERTICAL — continuation bar on wrapped lines.
const CONTINUATION_BAR = "┃";
// Markdown child uses paddingX=1 and clamps contentWidth>=1, so its minimum
// render output is 3 terminal cells. Anything narrower than prefix+3 would
// overflow the requested width — bail out instead.
const MIN_MARKDOWN_WIDTH = 3;
// Two-column layout: the gutter (col 0..GUTTER_WIDTH-1) stays outside the
// userMessageBg painted region and holds the π icon on the first content
// line / two spaces on continuations — mirroring how GutterBlock renders
// its ● indicator at col 0. The painted region starts at col GUTTER_WIDTH
// and hosts the ┃ accent bar on every content line (including the first).
const GUTTER_WIDTH = 2;
const GUTTER_PAD = "  ";

/**
 * Renders a user message as an F5-branded admonition block with a two-column
 * layout: the π icon sits in the gutter at col 0 on the first content line
 * (outside the painted region, matching the `●` indicator pattern used by
 * `GutterBlock`); the ┃ heavy vertical bar renders at col GUTTER_WIDTH inside
 * `userMessageBg` on every content line including the first. Both glyphs use
 * the `border` fg. The bg is painted across the full requested width, and a
 * leading blank spacer separates the prompt from the preceding block.
 */
export class UserMessageComponent extends Container {
	#text: string;
	#synthetic: boolean;

	constructor(text: string, synthetic = false) {
		super();
		this.#text = text;
		this.#synthetic = synthetic;
		this.#rebuild();
	}

	// Mirror AssistantMessageComponent: on invalidate, drop the Markdown child
	// and rebuild it so getMarkdownTheme() is re-captured. Without this, a
	// theme change leaves the Markdown child rendering with the original
	// construction-time theme.
	override invalidate(): void {
		super.invalidate();
		this.#rebuild();
	}

	#rebuild(): void {
		this.children = [];
		const color = this.#synthetic
			? (value: string) => theme.fg("dim", value)
			: (value: string) => `\x1b[3m${theme.fg("userMessageText", value)}\x1b[23m`;
		this.addChild(new Spacer(1));
		this.addChild(new Markdown(this.#text, 0, 0, getMarkdownTheme(), { color }));
	}

	override render(width: number): string[] {
		const contPrefix = `${CONTINUATION_BAR} `;
		// π lives in the fixed-width gutter (see the content map below), so it
		// does not factor into innerWidth. Only contPrefix eats content budget.
		const innerWidth = width - GUTTER_WIDTH - visibleWidth(contPrefix);
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

		// First-line gutter: π icon padded to exactly GUTTER_WIDTH cells. The
		// glyph width is theme-dependent (Unicode π = 1 col, Nerd Font PUA = 2
		// cols, ASCII "pi" = 2 cols); right-pad with spaces so the gutter
		// occupies a fixed slot and the ┃ bar at col GUTTER_WIDTH aligns across
		// every content line.
		const piIcon = theme.icon.pi;
		const piPadSize = Math.max(0, GUTTER_WIDTH - visibleWidth(piIcon));
		// Pad inside the theme.fg wrap so the border-fg escape, glyph, and
		// pad space form one contiguous span (no intervening fg reset). This
		// matches the shape the raw-escape assertion in test 6 looks for.
		const piGutter = theme.fg("border", piIcon + " ".repeat(piPadSize));

		const leading = raw.slice(0, firstContent);
		const content = raw.slice(firstContent).map((line, i) => {
			const prefix = theme.fg("border", contPrefix);
			const combined = prefix + line;
			const pad = Math.max(0, width - GUTTER_WIDTH - visibleWidth(combined));
			const gutter = i === 0 ? piGutter : GUTTER_PAD;
			return gutter + theme.bg("userMessageBg", combined + padding(pad));
		});

		return [...leading, ...content];
	}
}
