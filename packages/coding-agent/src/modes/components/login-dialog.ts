import { getOAuthProviders } from "@f5-sales-demo/pi-ai";
import { Container, getKeybindings, Input, Spacer, Text, type TUI } from "@f5-sales-demo/pi-tui";
import { theme } from "../../modes/theme/theme";
import { type OpenHttpUrlResult, openHttpUrl } from "../../utils/open";
import { appInterruptHint, matchesAppInterrupt } from "../utils/keybinding-matchers";
import { presentAuthLink } from "./auth-link-presenter";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
} from "./selector-frame";

interface LoginDialogDependencies {
	openUrl?: (url: string) => undefined | OpenHttpUrlResult | Promise<OpenHttpUrlResult>;
	presentLink?: typeof presentAuthLink;
}

/**
 * Login dialog component - replaces editor during OAuth login flow
 */
export class LoginDialogComponent extends Container {
	#contentContainer: Container;
	#input: Input;
	#tui: TUI;
	#abortController = new AbortController();
	#inputResolver?: (value: string) => void;
	#inputRejecter?: (error: Error) => void;
	#providerName: string;
	#offset = 0;
	#capacity = 1;
	#length = 0;

	constructor(
		tui: TUI,
		providerId: string,
		private onComplete: (success: boolean, message?: string) => void,
		private dependencies: LoginDialogDependencies = {},
	) {
		super();
		this.#tui = tui;

		const providerInfo = getOAuthProviders().find(p => p.id === providerId);
		this.#providerName = providerInfo?.name || providerId;

		// Dynamic content area
		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		// Input (always present, used when needed)
		this.#input = new Input();
		this.#input.onSubmit = () => {
			if (this.#inputResolver) {
				this.#inputResolver(this.#input.getValue());
				this.#inputResolver = undefined;
				this.#inputRejecter = undefined;
			}
		};
		this.#input.onEscape = () => {
			// The configured selector Back binding is handled by the dialog.
		};
	}

	override render(width: number): string[] {
		const rows = this.#tui.terminal?.rows || process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const content = this.#contentContainer
			.render(inner)
			.filter(line => !/^\s*(?:Esc: cancel|\(Escape to cancel\))\s*$/u.test(Bun.stripANSI(line)));
		this.#length = content.length;
		this.#capacity = Math.max(1, rows - 10);
		this.#offset = Math.max(0, Math.min(this.#offset, Math.max(0, this.#length - this.#capacity)));
		return selectorFrame(
			width,
			rows,
			`Login to ${this.#providerName}`,
			"Complete provider authentication; credentials are handled by the provider flow and are never displayed here.",
			[],
			content.slice(this.#offset, this.#offset + this.#capacity),
			[],
			[
				...(this.#length > this.#capacity
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: authentication details`]
					: []),
				appInterruptHint(),
				selectorCancelHint("cancel login"),
			],
		);
	}

	get signal(): AbortSignal {
		return this.#abortController.signal;
	}

	#cancel(): void {
		this.#abortController.abort();
		if (this.#inputRejecter) {
			this.#inputRejecter(new Error("Login cancelled"));
			this.#inputResolver = undefined;
			this.#inputRejecter = undefined;
		}
		this.onComplete(false, "Login cancelled");
	}

	/**
	 * Called by onAuth callback - show URL and optional instructions
	 */
	showAuth(url: string, instructions?: string, openUrl?: string): void {
		this.#contentContainer.clear();
		this.#contentContainer.addChild(new Spacer(1));
		(this.dependencies.presentLink ?? presentAuthLink)(this.#contentContainer, url);

		if (instructions) {
			this.#contentContainer.addChild(new Spacer(1));
			this.#contentContainer.addChild(new Text(theme.fg("warning", instructions), 1, 0));
		}

		// Open browser (best-effort)
		void Promise.resolve((this.dependencies.openUrl ?? openHttpUrl)(openUrl ?? url)).then(result => {
			if (result && typeof result === "object" && "ok" in result && !result.ok) {
				this.#contentContainer.addChild(
					new Text(theme.fg("error", `Could not open browser: ${result.error}`), 1, 0),
				);
				this.#tui.requestRender();
			}
		});

		this.#tui.requestRender();
	}

	/**
	 * Show input for manual code/URL entry (for callback server providers)
	 */
	showManualInput(prompt: string): Promise<string> {
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(theme.fg("dim", prompt), 1, 0));
		if (!this.#contentContainer.children.includes(this.#input)) {
			this.#contentContainer.addChild(this.#input);
		}
		this.#contentContainer.addChild(new Text(theme.fg("dim", "(Escape to cancel)"), 1, 0));
		this.#tui.requestRender();

		const { promise, resolve, reject } = Promise.withResolvers<string>();
		this.#inputResolver = resolve;
		this.#inputRejecter = reject;
		return promise;
	}

	/**
	 * Called by onPrompt callback - show prompt and wait for input
	 * Note: Does NOT clear content, appends to existing (preserves URL from showAuth)
	 */
	showPrompt(message: string, placeholder?: string): Promise<string> {
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(theme.fg("text", message), 1, 0));
		if (placeholder) {
			this.#contentContainer.addChild(new Text(theme.fg("dim", `e.g., ${placeholder}`), 1, 0));
		}
		if (!this.#contentContainer.children.includes(this.#input)) {
			this.#contentContainer.addChild(this.#input);
		}
		this.#contentContainer.addChild(new Text(theme.fg("dim", "Esc: cancel"), 1, 0));

		this.#input.setValue("");
		this.#tui.requestRender();

		const { promise, resolve, reject } = Promise.withResolvers<string>();
		this.#inputResolver = resolve;
		this.#inputRejecter = reject;
		return promise;
	}

	/**
	 * Show waiting message (for polling flows like GitHub Copilot)
	 */
	showWaiting(message: string): void {
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
		this.#contentContainer.addChild(new Text(theme.fg("dim", "(Escape to cancel)"), 1, 0));
		this.#tui.requestRender();
	}

	/**
	 * Called by onProgress callback
	 */
	showProgress(message: string): void {
		this.#contentContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
		this.#tui.requestRender();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		if (matchesAppInterrupt(data)) {
			this.#cancel();
			return;
		}
		if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			this.#offset = Math.max(
				0,
				Math.min(
					Math.max(0, this.#length - this.#capacity),
					this.#offset + (matchesSelectorKey(data, "pageUp") ? -this.#capacity : this.#capacity),
				),
			);
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.#cancel();
			return;
		}

		// Pass to input
		this.#input.handleInput(data);
	}
}
