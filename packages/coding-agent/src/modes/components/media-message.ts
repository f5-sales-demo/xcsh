import type { TUI } from "@f5-sales-demo/pi-tui";
import {
	Container,
	deleteKittyImage,
	Image,
	ImageProtocol,
	MediaPlaybackScheduler,
	type MediaPlaybackState,
	stableKittyImageId,
	TERMINAL,
	Text,
} from "@f5-sales-demo/pi-tui";
import type { MediaMessage, MediaRasterFrameV1 } from "../../media/types";
import { type BlobStore, parseBlobRef } from "../../session/blob-store";
import { resolveImageOptions } from "../../tools/render-utils";
import { theme } from "../theme/theme";

export interface MediaRenderOptions {
	autoplay: boolean;
	reducedMotion: boolean;
	fpsCap: number;
}

export type MediaPlaybackAction = "play" | "pause" | "stop";

export interface MediaPlaybackControlResult {
	id: string;
	state: MediaPlaybackState;
}

type LoadedFrame = { text: string; durationMs: number } | { data: string; mimeType: string; durationMs: number };

const activeMediaComponents: MediaMessageComponent[] = [];

export function controlMediaPlayback(
	action: MediaPlaybackAction,
	target: "latest" | string = "latest",
): MediaPlaybackControlResult | null {
	const component =
		target === "latest"
			? activeMediaComponents.at(-1)
			: activeMediaComponents.findLast(candidate => candidate.mediaId === target);
	if (!component) return null;
	component.control(action);
	return { id: component.mediaId, state: component.playbackState };
}

export class MediaMessageComponent extends Container {
	readonly #imageId: number;
	readonly #viewportObserver: { marker: string; dispose: () => void };
	readonly #options: MediaRenderOptions;
	#frames: LoadedFrame[] = [];
	#scheduler?: MediaPlaybackScheduler;
	#timer?: ReturnType<typeof setTimeout>;
	#visible = false;
	#disposed = false;
	#extraDegradation?: string;

	constructor(
		private readonly message: MediaMessage,
		private readonly blobStore: BlobStore,
		private readonly ui: TUI,
		options: Partial<MediaRenderOptions> = {},
	) {
		super();
		this.#imageId = stableKittyImageId(message.media.id);
		this.#options = {
			autoplay: options.autoplay ?? true,
			reducedMotion: options.reducedMotion ?? false,
			fpsCap: Math.max(1, Math.min(60, Math.floor(options.fpsCap ?? message.media.playback.fpsCap))),
		};
		this.#viewportObserver = ui.registerViewportObserver(visible => this.#setVisible(visible));
		activeMediaComponents.push(this);
		this.addChild(new Text(theme.fg("dim", `Loading media ${message.media.id}…`), 0, 0));
		void this.#load();
	}

	get mediaId(): string {
		return this.message.media.id;
	}

	get playbackState(): MediaPlaybackState {
		return this.#scheduler?.state ?? "stopped";
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return [this.#viewportObserver.marker];
		return lines.map(line => this.#viewportObserver.marker + line);
	}

	control(action: MediaPlaybackAction): void {
		if (!this.#scheduler || this.#disposed) return;
		switch (action) {
			case "play":
				this.#scheduler.play(Date.now());
				this.#scheduleTick();
				break;
			case "pause":
				this.#scheduler.pause();
				this.#clearTimer();
				break;
			case "stop":
				this.#scheduler.stop();
				this.#clearTimer();
				this.#showFrame(0);
				break;
		}
		this.ui.requestRender();
	}

	async #loadAsset(frame: MediaRasterFrameV1): Promise<LoadedFrame | null> {
		const hash = parseBlobRef(frame.asset.ref);
		const data = hash ? await this.blobStore.get(hash) : null;
		if (!data) return null;
		return { data: data.toString("base64"), mimeType: frame.asset.mimeType, durationMs: frame.durationMs };
	}

	async #load(): Promise<void> {
		try {
			const { media } = this.message;
			const timeline = media.timeline;
			if (timeline?.length) {
				const isRaster = "asset" in timeline[0]!;
				const supportsMotion = !isRaster || TERMINAL.imageProtocol === ImageProtocol.Kitty;
				if (supportsMotion) {
					const loaded = await Promise.all(
						timeline.map(frame =>
							"asset" in frame
								? this.#loadAsset(frame)
								: Promise.resolve<LoadedFrame>({ text: frame.text, durationMs: frame.durationMs }),
						),
					);
					if (loaded.some(frame => frame === null)) {
						throw new Error("one or more timeline assets are unavailable");
					}
					this.#frames = loaded as LoadedFrame[];
				} else {
					this.#extraDegradation = "Motion playback requires a Kitty graphics terminal; showing a static poster.";
				}
			}

			if (this.#frames.length === 0) {
				const firstFrame = media.timeline?.[0];
				const asset =
					media.poster ??
					(media.kind === "image" ? media.original : undefined) ??
					(firstFrame && "asset" in firstFrame ? firstFrame.asset : undefined);
				if (asset) {
					const hash = parseBlobRef(asset.ref);
					const data = hash ? await this.blobStore.get(hash) : null;
					if (data) {
						this.#frames = [{ data: data.toString("base64"), mimeType: asset.mimeType, durationMs: 1000 }];
					}
				} else if (firstFrame && "text" in firstFrame) {
					this.#frames = [{ text: firstFrame.text, durationMs: firstFrame.durationMs }];
				}
			}

			if (this.#disposed) return;
			if (this.#frames.length === 0) throw new Error("media asset is unavailable");
			if ((timeline?.length ?? 0) > 1 && this.#frames.length > 1) {
				this.#scheduler = new MediaPlaybackScheduler(
					this.#frames.map(frame => frame.durationMs),
					{
						autoplay: media.playback.autoplay && this.#options.autoplay,
						loop: media.playback.loop,
						fpsCap: Math.min(media.playback.fpsCap, this.#options.fpsCap),
						reducedMotion: this.#options.reducedMotion,
					},
				);
				this.#scheduler.setVisible(this.#visible, Date.now());
			}
			this.#showFrame(0);
			this.#scheduleTick();
		} catch (error) {
			if (this.#disposed) return;
			this.clear();
			this.addChild(
				new Text(
					theme.fg(
						"warning",
						`Media asset unavailable: ${this.message.media.id} (${
							error instanceof Error ? error.message : String(error)
						})`,
					),
					0,
					0,
				),
			);
			this.ui.requestRender();
		}
	}

	#showFrame(index: number): void {
		const frame = this.#frames[index];
		if (!frame || this.#disposed) return;
		this.clear();
		if ("text" in frame) {
			this.addChild(new Text(frame.text, 0, 0));
		} else {
			this.addChild(
				new Image(
					frame.data,
					frame.mimeType,
					{ fallbackColor: text => theme.fg("toolOutput", text) },
					{
						...resolveImageOptions(),
						filename: this.message.media.alt,
						imageId: this.#imageId,
					},
				),
			);
		}
		if (this.message.media.caption) {
			this.addChild(new Text(theme.fg("muted", this.message.media.caption), 0, 0));
		}
		if (this.message.media.degradation) {
			this.addChild(new Text(theme.fg("warning", this.message.media.degradation), 0, 0));
		}
		if (this.#extraDegradation) {
			this.addChild(new Text(theme.fg("warning", this.#extraDegradation), 0, 0));
		}
		this.ui.requestRender();
	}

	#setVisible(visible: boolean): void {
		this.#visible = visible;
		if (!this.#scheduler || this.#disposed) return;
		this.#scheduler.setVisible(visible, Date.now());
		if (visible) this.#scheduleTick();
		else this.#clearTimer();
	}

	#scheduleTick(): void {
		this.#clearTimer();
		if (!this.#visible || this.#scheduler?.state !== "playing" || this.#disposed) return;
		const delay = Math.ceil(1000 / Math.min(this.message.media.playback.fpsCap, this.#options.fpsCap));
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			if (!this.#scheduler || this.#disposed) return;
			const previous = this.#scheduler.frameIndex;
			const current = this.#scheduler.tick(Date.now());
			if (current !== previous) this.#showFrame(current);
			this.#scheduleTick();
		}, delay);
	}

	#clearTimer(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#clearTimer();
		this.#scheduler?.dispose();
		this.#viewportObserver.dispose();
		const index = activeMediaComponents.indexOf(this);
		if (index >= 0) activeMediaComponents.splice(index, 1);
		if (TERMINAL.imageProtocol === ImageProtocol.Kitty) {
			this.ui.terminal.write(deleteKittyImage(this.#imageId));
		}
	}

	unmount(): void {
		this.dispose();
	}
}
