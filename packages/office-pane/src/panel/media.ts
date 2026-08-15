import type { ChatMediaContent } from "@f5-sales-demo/xcsh-chat-ui";
import type { ChatMediaMsg } from "../core";

export type TransportMediaDescriptor = ChatMediaMsg["media"];

export function mediaAssetRefs(descriptor: TransportMediaDescriptor): string[] {
	const refs: string[] = [];
	const seen = new Set<string>();
	const add = (ref: string | undefined) => {
		if (!ref || seen.has(ref)) return;
		seen.add(ref);
		refs.push(ref);
	};
	add(descriptor.original?.ref);
	add(descriptor.poster?.ref);
	for (const frame of descriptor.timeline ?? []) {
		if ("asset" in frame) add(frame.asset.ref);
	}
	return refs;
}

export function toChatMediaContent(
	descriptor: TransportMediaDescriptor,
	assetUrls: ReadonlyMap<string, string>,
): ChatMediaContent {
	return {
		id: descriptor.id,
		kind: descriptor.kind,
		...(descriptor.original ? { src: assetUrls.get(descriptor.original.ref) } : {}),
		...(descriptor.poster ? { posterSrc: assetUrls.get(descriptor.poster.ref) } : {}),
		...(descriptor.timeline
			? {
					frames: descriptor.timeline.map(frame =>
						"asset" in frame
							? { src: assetUrls.get(frame.asset.ref), durationMs: frame.durationMs }
							: { text: frame.text, durationMs: frame.durationMs },
					),
				}
			: {}),
		caption: descriptor.caption,
		alt: descriptor.alt,
		width: descriptor.width,
		height: descriptor.height,
		degradation: descriptor.degradation,
		playback: {
			autoplay: descriptor.playback.autoplay,
			loop: descriptor.playback.loop,
			muted: true,
		},
	};
}
