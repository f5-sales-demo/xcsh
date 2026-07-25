/**
 * The shared glyph icons (unified from the Chrome + VS Code seeds so every
 * surface reads as one product): the composer's up-arrow send, rounded-square
 * stop and attach plus, plus the header-bar controls.
 *
 * Header icons are SVG rather than the text glyphs they replaced (≡ ✎ ⋯): an
 * Office task-pane WebView has no say over font fallback, so a glyph can render
 * as tofu or shift the row's metrics. They are `aria-hidden` — the accessible
 * name lives on the button's `aria-label`.
 */
export function SendIcon() {
	return (
		<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
			<path d="M10 5l5 5-1.4 1.4L11 8.83V15H9V8.83L6.4 11.4 5 10z" />
		</svg>
	);
}

export function StopIcon() {
	return (
		<svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
			<rect x="5" y="5" width="10" height="10" rx="2" />
		</svg>
	);
}

export function PlusIcon() {
	return (
		<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
			<path d="M10 5a.75.75 0 01.75.75V9.25h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5V5.75A.75.75 0 0110 5z" />
		</svg>
	);
}

/** The 1.5px-stroke circle outline both circular header marks are drawn inside, so
 *  the clock and new-chat glyphs stay the same weight and diameter as each other. */
const CIRCLE_OUTLINE = "M10 3a7 7 0 100 14 7 7 0 000-14zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11z";

/** Header: past chats — a clock face, the conventional "history" mark. */
export function HistoryIcon() {
	return (
		<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
			<path d={CIRCLE_OUTLINE} />
			<path d="M9.25 6a.75.75 0 011.5 0v3.94l2.4 1.39a.75.75 0 01-.75 1.3l-2.78-1.6a.75.75 0 01-.37-.65V6z" />
		</svg>
	);
}

/** Header: start a new chat — a plus in a circle. */
export function NewChatIcon() {
	return (
		<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
			<path d={CIRCLE_OUTLINE} />
			<path d="M10 6.5a.75.75 0 01.75.75v2h2a.75.75 0 010 1.5h-2v2a.75.75 0 01-1.5 0v-2h-2a.75.75 0 010-1.5h2v-2A.75.75 0 0110 6.5z" />
		</svg>
	);
}

/** Header: overflow menu — a vertical ellipsis. */
export function MoreIcon() {
	return (
		<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
			<circle cx="10" cy="5" r="1.4" />
			<circle cx="10" cy="10" r="1.4" />
			<circle cx="10" cy="15" r="1.4" />
		</svg>
	);
}
