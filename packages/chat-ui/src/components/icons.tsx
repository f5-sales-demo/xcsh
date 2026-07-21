/**
 * The shared composer glyph icons (unified from the Chrome + VS Code seeds so
 * every surface reads as one product): an up-arrow send, a rounded-square stop,
 * and a plus for attach.
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
