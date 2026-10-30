import { type Component, Text } from "@f5-sales-demo/pi-tui";
import {
	type AnswerDelivery,
	type AnswerRecap,
	DELIVERY_COPY,
} from "../../../../chat-ui/src/interactions/answer-recap";
import { theme } from "../theme/theme";

/** Text preserves submitted newlines and indentation; no markdown interpretation. */
export class AnswerRecapComponent implements Component {
	constructor(
		private recap: AnswerRecap,
		private readonly evidence?: string,
		private expanded = false,
	) {}
	setDelivery(state: AnswerDelivery): void {
		this.recap = { ...this.recap, state };
	}
	markBoundary(): void {
		if (["pending", "asked", "queued"].includes(this.recap.state)) this.setDelivery("recorded");
	}
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}
	render(width: number): string[] {
		const body = this.recap.rows
			.map(row =>
				this.recap.state === "pending" || this.recap.state === "asked"
					? row.question
					: [
							theme.bold(row.topic + " — " + row.answer),
							row.description,
							row.notes === undefined ? undefined : "Notes: " + row.notes,
						]
							.filter(value => value !== undefined)
							.join("\n"),
			)
			.join("\n\n");
		return new Text(
			[
				theme.bold(DELIVERY_COPY[this.recap.state]),
				body,
				this.evidence ? (this.expanded ? this.evidence : "(Ctrl+O for details)") : undefined,
			]
				.filter(value => value !== undefined)
				.join("\n\n"),
			1,
			0,
		).render(width);
	}
	invalidate(): void {}
}
