import { type Component, Container, type TUI } from "@f5xc-salesdemos/pi-tui";
import { getSymbolTheme, theme } from "../theme/theme";

const GUTTER_WIDTH = 2; // 1 char indicator + 1 char space
const SPINNER_INTERVAL_MS = 80;
const GUTTER_PAD = "  "; // 2 spaces for continuation lines

// Matches CSI SGR escape sequences (\x1b[...m) used for colors and styles.
// Needed because Box/Text padding lines look like "\x1b[48;5;236m   \x1b[0m" —
// visually empty but not whitespace, so String.trim() alone leaves the escape
// codes behind and the line falsely reads as content.
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

export interface GutterConfig {
	/** Indicator symbol shown when done (e.g. "●", "✻", "※") */
	symbol: string;
	/** Color function for active state (used for static active indicator) */
	activeColorFn: (s: string) => string;
	/**
	 * Neutral done-state color. Used when `setDone()` is called without an
	 * outcome, or when the specific outcome color function is not configured.
	 */
	doneColorFn: (s: string) => string;
	/** Optional color function used for `setDone("success")`. */
	doneSuccessColorFn?: (s: string) => string;
	/** Optional color function used for `setDone("error")`. */
	doneErrorColorFn?: (s: string) => string;
	/** Optional color function used for `setDone("warning")`. */
	doneWarningColorFn?: (s: string) => string;
	/** Whether to show spinner animation when active */
	animated: boolean;
	/**
	 * Optional custom spinner frames. When set, these frames are used instead
	 * of the theme's default `spinnerFrames` (braille progression). Useful for
	 * gutters that want a distinct visual cadence — e.g. tool calls use a
	 * pulsing ● / blank alternation to differentiate from the ✻ thinking
	 * braille spinner.
	 */
	activeFrames?: string[];
	/**
	 * Optional per-frame interval in milliseconds. Defaults to
	 * `SPINNER_INTERVAL_MS` (80ms, right for the 10-frame braille progression).
	 * Low-frame-count patterns like the tool-call pulse (2 frames) need a
	 * slower cadence — otherwise the alternation reads as a rapid strobe
	 * rather than a breathing pulse.
	 */
	activeIntervalMs?: number;
}

type GutterState = "active" | "done";
type GutterOutcome = "success" | "error" | "warning";

/**
 * GutterBlock wraps a child component and prepends a 2-character left gutter
 * to every rendered line. The first line shows an indicator (optionally animated),
 * continuation lines show 2 spaces.
 */
export class GutterBlock<T extends Component> implements Component {
	#child: T;
	#config: GutterConfig;
	#state: GutterState;
	#outcome?: GutterOutcome;
	#ui: TUI;

	// Spinner state
	#spinnerFrames: string[];
	#currentFrame = 0;
	#intervalId?: ReturnType<typeof setInterval>;

	constructor(ui: TUI, child: T, config: GutterConfig, initialState: GutterState = "active") {
		this.#child = child;
		this.#config = config;
		this.#state = initialState;
		this.#ui = ui;
		this.#spinnerFrames = config.activeFrames ?? getSymbolTheme().spinnerFrames;

		if (initialState === "active" && config.animated) {
			this.#startSpinner();
		}
	}

	get child(): T {
		return this.#child;
	}

	get state(): GutterState {
		return this.#state;
	}

	setDone(outcome?: GutterOutcome): void {
		if (this.#state === "done") return;
		this.#outcome = outcome;
		this.#state = "done";
		this.#stopSpinner();
		this.#ui.requestRender();
	}

	/** Switch to thinking mode: change symbol to ✻ and start animated spinner */
	setThinkingMode(): void {
		if (this.#state === "done") return;
		this.#config = {
			symbol: "✻",
			activeColorFn: (s: string) => theme.fg("spinnerAccent", s),
			doneColorFn: (s: string) => theme.fg("dim", s),
			animated: true,
		};
		if (!this.#intervalId) {
			this.#startSpinner();
		}
	}

	/** Forward setExpanded to child if it supports it (duck-typed for isExpandable checks) */
	setExpanded(expanded: boolean): void {
		const child = this.#child as any;
		if (typeof child.setExpanded === "function") {
			child.setExpanded(expanded);
		}
	}

	invalidate(): void {
		this.#child.invalidate?.();
	}

	render(width: number): string[] {
		const childLines = this.#child.render(Math.max(1, width - GUTTER_WIDTH));

		if (childLines.length === 0) {
			return [];
		}

		// Find the first visually non-empty line. Leading lines may be plain "" (a
		// Spacer) or ANSI-background-padded "empty" lines from Box/Text paddingY>=1.
		// Strip SGR escapes before trim() so the padded lines register as empty.
		let firstContentIdx = 0;
		for (let i = 0; i < childLines.length; i++) {
			if (childLines[i].replace(ANSI_SGR_RE, "").trim() !== "") {
				firstContentIdx = i;
				break;
			}
		}

		const prefix = this.#buildGutterPrefix();
		const result: string[] = [];
		for (let i = 0; i < childLines.length; i++) {
			result.push((i === firstContentIdx ? prefix : GUTTER_PAD) + childLines[i]);
		}
		return result;
	}

	dispose(): void {
		this.#stopSpinner();
	}

	#buildGutterPrefix(): string {
		if (this.#state === "done") {
			const colorFn = this.#doneColorFnForOutcome();
			return `${colorFn(this.#config.symbol)} `;
		}

		if (this.#config.animated) {
			const frame = this.#spinnerFrames[this.#currentFrame];
			return `${this.#config.activeColorFn(frame)} `;
		}

		return `${this.#config.activeColorFn(this.#config.symbol)} `;
	}

	#doneColorFnForOutcome(): (s: string) => string {
		if (this.#outcome === "error" && this.#config.doneErrorColorFn) {
			return this.#config.doneErrorColorFn;
		}
		if (this.#outcome === "warning" && this.#config.doneWarningColorFn) {
			return this.#config.doneWarningColorFn;
		}
		if (this.#outcome === "success" && this.#config.doneSuccessColorFn) {
			return this.#config.doneSuccessColorFn;
		}
		return this.#config.doneColorFn;
	}

	#startSpinner(): void {
		const interval = this.#config.activeIntervalMs ?? SPINNER_INTERVAL_MS;
		this.#intervalId = setInterval(() => {
			this.#currentFrame = (this.#currentFrame + 1) % this.#spinnerFrames.length;
			this.#ui.requestRender();
		}, interval);
	}

	#stopSpinner(): void {
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}
	}
}

// ============================================================================
// DisposableContainer — stops gutter timers on clear/remove
// ============================================================================

function disposeIfGutter(child: Component): void {
	if (child instanceof GutterBlock) {
		child.dispose();
	}
}

/**
 * Container subclass that disposes GutterBlock children when they are
 * removed or the container is cleared. Prevents orphaned spinner timers.
 */
export class DisposableContainer extends Container {
	override removeChild(component: Component): void {
		disposeIfGutter(component);
		super.removeChild(component);
	}

	override clear(): void {
		for (const child of this.children) {
			disposeIfGutter(child);
		}
		super.clear();
	}
}

// ============================================================================
// Factory functions
// ============================================================================

/**
 * Animated ● gutter for tool calls and slash-command executions.
 * Active: pulsing dot — alternates ● / blank in `muted` color to
 *   differentiate from the braille ✻ thinking spinner. Matches the
 *   xcsh tool-initialization aesthetic.
 * Done (unknown outcome): `dim` — neutral "completed" color when the call
 *   site does not have success/error information.
 * Done (success): `gutterSuccess` (falls back to `success` when the theme
 *   does not define the dedicated token).
 * Done (error): `gutterError` (falls back to `error`).
 * Done (warning): `gutterWarning` (falls back to `warning`).
 */
export function createToolGutter<T extends Component>(ui: TUI, child: T): GutterBlock<T> {
	return new GutterBlock(ui, child, {
		symbol: "●",
		activeColorFn: (s: string) => theme.fg("muted", s),
		activeFrames: ["●", " "],
		// 600ms/frame ≈ 1.2s full on/off cycle — a breathing pulse rather than a
		// strobe. The braille spinner's 80ms works for 10 frames; a 2-frame
		// pulse at the same rate reads as a 6 Hz flicker.
		activeIntervalMs: 600,
		doneColorFn: (s: string) => theme.fg("dim", s),
		doneSuccessColorFn: (s: string) => theme.fg("gutterSuccess", s),
		doneErrorColorFn: (s: string) => theme.fg("gutterError", s),
		doneWarningColorFn: (s: string) => theme.fg("gutterWarning", s),
		animated: true,
	});
}

/** Static ● gutter for assistant text — immediately in done state, white/text color */
export function createTextGutter<T extends Component>(ui: TUI, child: T): GutterBlock<T> {
	return new GutterBlock(
		ui,
		child,
		{
			symbol: "●",
			activeColorFn: (s: string) => theme.fg("text", s),
			doneColorFn: (s: string) => theme.fg("text", s),
			animated: false,
		},
		"done",
	);
}

/**
 * ● gutter for streaming assistant messages — starts active (non-animated, white ●)
 * so it can switch to thinking mode (✻ spinner) if thinking content arrives.
 * Call setDone() when message_end fires.
 */
export function createStreamingAssistantGutter<T extends Component>(ui: TUI, child: T): GutterBlock<T> {
	return new GutterBlock(
		ui,
		child,
		{
			symbol: "●",
			activeColorFn: (s: string) => theme.fg("text", s),
			doneColorFn: (s: string) => theme.fg("text", s),
			animated: false,
		},
		"active",
	);
}

/** Animated ✻ gutter for thinking — spinner in spinnerAccent, done in dim */
export function createThinkingGutter<T extends Component>(ui: TUI, child: T): GutterBlock<T> {
	return new GutterBlock(ui, child, {
		symbol: "✻",
		activeColorFn: (s: string) => theme.fg("spinnerAccent", s),
		doneColorFn: (s: string) => theme.fg("dim", s),
		animated: true,
	});
}

/** Static ※ gutter for system/recap messages — immediately in done state, dim */
export function createSystemGutter<T extends Component>(ui: TUI, child: T): GutterBlock<T> {
	return new GutterBlock(
		ui,
		child,
		{
			symbol: "※",
			activeColorFn: (s: string) => theme.fg("dim", s),
			doneColorFn: (s: string) => theme.fg("dim", s),
			animated: false,
		},
		"done",
	);
}
