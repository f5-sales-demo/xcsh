import { type Component, Container } from "@f5-sales-demo/pi-tui";
import {
	selectorCompactRow,
	selectorFrameContentWidth,
	selectorProse,
	selectorTranscriptFrame,
} from "./selector-frame";

/** Frame arbitrary static transcript-adjacent content, including OSC links. */
export class TranscriptComponentFrame extends Container {
	constructor(
		private readonly title: string,
		private readonly purpose: string,
		private readonly content: Component,
		private readonly footer: string[] = [],
	) {
		super();
	}

	override render(width: number): string[] {
		const body = this.content.render(selectorFrameContentWidth(width));
		return selectorTranscriptFrame(
			width,
			this.title,
			this.purpose,
			body.map(line => selectorCompactRow(line)),
			this.footer,
		);
	}
}

/** Bounded-width static notice inserted alongside transcript content without changing transcript messages. */
export class TranscriptNoticeComponent extends Container {
	constructor(
		private readonly title: string,
		private readonly purpose: string,
		private readonly content: string,
	) {
		super();
	}

	override render(width: number): string[] {
		const body = this.content.split("\n").filter(line => Bun.stripANSI(line).trim());
		return selectorTranscriptFrame(
			width,
			this.title,
			this.purpose,
			body.map(line => selectorProse(line)),
		);
	}
}
