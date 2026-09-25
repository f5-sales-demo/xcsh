import { type Component, padding, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import type { RecapRecord } from "../../session/recap";
import { theme } from "../theme/theme";

/** A compact, secondary transcript line whose wrapped text starts below its first word. */
export class RecapMessageComponent implements Component {
	constructor(readonly recap: RecapRecord) {}
	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const add = (prefix: string, content: string) => {
			const available = Math.max(1, width - prefix.length);
			for (const [index, segment] of wrapTextWithAnsi(content, available).entries()) {
				const lead = index === 0 ? prefix : padding(prefix.length);
				lines.push(theme.italic(theme.fg("dim", lead + segment)));
			}
		};
		add("  ↳ Recap: ", this.recap.summary);
		if (this.recap.nextAction) add("    Next: ", this.recap.nextAction);
		return lines;
	}
}
