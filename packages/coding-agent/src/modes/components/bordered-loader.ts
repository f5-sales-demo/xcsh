import { CancellableLoader, Container, Spacer, Text, type TUI } from "@f5-sales-demo/pi-tui";
import type { Theme } from "../../modes/theme/theme";
import { appInterruptHint } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

/** Loader wrapped with borders for hook UI */
export class BorderedLoader extends Container {
	#loader: CancellableLoader;

	constructor(
		tui: TUI,
		theme: Theme,
		message: string,
		private cancellable = true,
	) {
		super();
		const borderColor = (s: string) => theme.fg("border", s);
		this.addChild(new DynamicBorder(borderColor));
		this.#loader = new CancellableLoader(
			tui,
			s => theme.fg("spinnerAccent", s),
			s => theme.fg("muted", s),
			message,
		);
		this.addChild(this.#loader);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("muted", cancellable ? appInterruptHint() : "This operation cannot be interrupted."), 1, 0),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));
	}

	get signal(): AbortSignal {
		return this.#loader.signal;
	}

	set onAbort(fn: (() => void) | undefined) {
		this.#loader.onAbort = fn;
	}

	handleInput(data: string): void {
		if (this.cancellable) this.#loader.handleInput(data);
	}

	dispose(): void {
		this.#loader.dispose();
	}
}
