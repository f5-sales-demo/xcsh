import { type Component, Container } from "@f5-sales-demo/pi-tui";
import { selectorFrame, selectorFrameContentWidth } from "./selector-frame";

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
		return selectorFrame(
			width,
			body.length + this.footer.length + 7,
			this.title,
			this.purpose,
			[],
			body,
			[],
			this.footer,
			{
				maxBodyRows: Math.max(1, body.length),
			},
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
		return selectorFrame(width, body.length + 7, this.title, this.purpose, [], body, [], [], {
			maxBodyRows: Math.max(1, body.length),
		});
	}
}
