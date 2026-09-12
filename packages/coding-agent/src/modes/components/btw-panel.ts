import { Container, Markdown, type TUI } from "@f5-sales-demo/pi-tui";
import { replaceTabs } from "../../tools/render-utils";
import { getMarkdownTheme, theme } from "../theme/theme";
import { appInterruptHint } from "../utils/keybinding-matchers";
import { selectorCancelHint, selectorFrame, selectorFrameContentWidth } from "./selector-frame";

type BtwPanelState = "running" | "complete" | "aborted" | "error";

interface BtwPanelComponentOptions {
	question: string;
	tui: TUI;
}

export class BtwPanelComponent extends Container {
	#question: string;
	#tui: TUI;
	#state: BtwPanelState = "running";
	#answer = "";
	#errorMessage: string | undefined;
	#closed = false;

	constructor(options: BtwPanelComponentOptions) {
		super();
		this.#question = options.question;
		this.#tui = options.tui;
	}

	appendText(delta: string): void {
		if (!delta || this.#closed) return;
		this.#answer += delta;
		this.#tui.requestRender();
	}

	setAnswer(text: string): void {
		if (this.#closed) return;
		this.#answer = text;
		this.#tui.requestRender();
	}

	markComplete(): void {
		if (this.#closed) return;
		this.#state = "complete";
		this.#errorMessage = undefined;
		this.#tui.requestRender();
	}

	markAborted(): void {
		if (this.#closed) return;
		this.#state = "aborted";
		this.#errorMessage = undefined;
		this.#tui.requestRender();
	}

	markError(message: string): void {
		if (this.#closed) return;
		this.#state = "error";
		this.#errorMessage = message;
		this.#tui.requestRender();
	}

	close(): void {
		this.#closed = true;
	}

	override render(width: number): string[] {
		const innerWidth = selectorFrameContentWidth(width);
		const answer = replaceTabs(this.#answer).trim();
		const body = answer
			? new Markdown(answer, 0, 0, getMarkdownTheme()).render(innerWidth)
			: [theme.fg("dim", this.#state === "running" ? "Waiting for response…" : "No text returned.")];
		const state = this.#stateLine();
		return selectorFrame(
			width,
			body.length + 12,
			"BTW",
			"Ephemeral side answer from a snapshot of the current session; it is not added to the transcript.",
			[],
			[theme.fg("contentAccent", replaceTabs(this.#question)), "", ...body],
			state ? [state] : [],
			[this.#footerLine()],
		);
	}

	#footerLine(): string {
		switch (this.#state) {
			case "running":
				return `${appInterruptHint()} · Esc keeps this request running`;
			case "complete":
				return selectorCancelHint("dismiss");
			case "aborted":
				return selectorCancelHint("dismiss");
			case "error":
				return selectorCancelHint("dismiss");
		}
	}

	#stateLine(): string {
		switch (this.#state) {
			case "running":
				return theme.fg("muted", "Loading side answer…");
			case "complete":
				return theme.fg("success", `${theme.status.success} Answer complete`);
			case "aborted":
				return theme.fg("warning", `${theme.status.warning} Interrupted`);
			case "error":
				return theme.fg("error", `${theme.status.error} ${replaceTabs(this.#errorMessage ?? "Unknown error")}`);
		}
	}
}
