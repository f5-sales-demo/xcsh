import { Container, Markdown } from "@f5-sales-demo/pi-tui";
import { getMarkdownTheme } from "../theme/theme";
import { selectorFrame, selectorFrameContentWidth } from "./selector-frame";

/** Static transcript-adjacent plan preview; approval controls live in the separate review overlay. */
export class PlanPreviewComponent extends Container {
	constructor(private readonly content: string) {
		super();
	}

	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		const body = new Markdown(this.content, 0, 0, getMarkdownTheme()).render(inner);
		return selectorFrame(
			width,
			body.length + 7,
			"Plan review",
			"Prepared execution plan; use the active review overlay to approve, revise, or cancel.",
			[],
			body,
			[],
			[],
		);
	}
}
