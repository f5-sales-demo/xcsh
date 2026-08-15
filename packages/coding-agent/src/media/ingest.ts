import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InternalUrlRouter } from "../internal-urls";
import type { BlobStore } from "../session/blob-store";
import { decodePoster, decodeRasterFrames, probeMedia } from "./ffmpeg";
import { DEFAULT_MEDIA_MAX_BYTES, downloadMediaUrl } from "./network";
import { sniffMedia } from "./sniff";
import {
	createMediaId,
	type MediaAssetRefV1,
	type MediaDescriptorV1,
	type MediaFrameV1,
	sanitizeMediaProvenance,
	validateMediaDescriptorV1,
} from "./types";

export interface MediaInputFrame {
	text?: string;
	source?: string;
	durationMs: number;
}

export interface DisplayMediaInput {
	source?: string;
	frames?: MediaInputFrame[];
	caption?: string;
	alt?: string;
	autoplay?: boolean;
	loop?: boolean;
	fpsCap?: number;
}

export interface IngestedMedia {
	descriptor: MediaDescriptorV1;
	posterData?: string;
	posterMimeType?: string;
}

export interface MediaIngestorOptions {
	cwd: string;
	blobStore: BlobStore;
	internalRouter?: InternalUrlRouter;
	maxBytes?: number;
	ffmpegPath?: string;
	ffprobePath?: string;
	resolveArtifact?: (source: string) => Promise<string | null>;
	downloadMedia?: typeof downloadMediaUrl;
}

export class MediaIngestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MediaIngestError";
	}
}

interface LoadedSource {
	data: Buffer;
	provenanceSource: string;
	contentType?: string;
}

function asAsset(ref: string, mimeType: string, bytes: number): MediaAssetRefV1 {
	return { ref, mimeType, bytes };
}

function playback(input: DisplayMediaInput): MediaDescriptorV1["playback"] {
	return {
		autoplay: input.autoplay ?? true,
		loop: input.loop ?? false,
		muted: true,
		fpsCap: Math.max(1, Math.min(60, Math.floor(input.fpsCap ?? 12))),
	};
}

export class MediaIngestor {
	readonly #options: Required<Pick<MediaIngestorOptions, "cwd" | "blobStore" | "maxBytes">> &
		Omit<MediaIngestorOptions, "cwd" | "blobStore" | "maxBytes">;

	constructor(options: MediaIngestorOptions) {
		this.#options = { ...options, maxBytes: options.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES };
	}

	async #readFile(resolvedPath: string): Promise<Buffer> {
		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) throw new MediaIngestError("media source must be a regular file");
		if (stat.size > this.#options.maxBytes) {
			throw new MediaIngestError(`media source exceeds ${this.#options.maxBytes} byte limit`);
		}
		const data = await fs.readFile(resolvedPath);
		if (data.byteLength > this.#options.maxBytes) {
			throw new MediaIngestError(`media source exceeds ${this.#options.maxBytes} byte limit`);
		}
		return data;
	}

	async #loadSource(source: string, signal?: AbortSignal): Promise<LoadedSource> {
		signal?.throwIfAborted();
		if (source.startsWith("https://")) {
			try {
				const result = await (this.#options.downloadMedia ?? downloadMediaUrl)(source, {
					maxBytes: this.#options.maxBytes,
					signal,
				});
				return { data: result.data, contentType: result.contentType, provenanceSource: result.finalUrl };
			} catch (error) {
				throw new MediaIngestError(error instanceof Error ? error.message : String(error));
			}
		}
		if (source.startsWith("artifact://")) {
			if (this.#options.internalRouter) {
				const resource = await this.#options.internalRouter.resolve(source);
				const data = resource.sourcePath
					? await this.#readFile(resource.sourcePath)
					: Buffer.from(resource.content, "utf8");
				return { data, contentType: resource.contentType, provenanceSource: source };
			}
			const artifactPath = await this.#options.resolveArtifact?.(source);
			if (!artifactPath) throw new MediaIngestError("artifact media is unavailable in this session");
			return { data: await this.#readFile(artifactPath), provenanceSource: source };
		}
		const resolvedPath = path.isAbsolute(source) ? path.normalize(source) : path.resolve(this.#options.cwd, source);
		return { data: await this.#readFile(resolvedPath), provenanceSource: resolvedPath };
	}

	async #put(data: Buffer, mimeType: string): Promise<MediaAssetRefV1> {
		const stored = await this.#options.blobStore.put(data);
		return asAsset(stored.ref, mimeType, data.byteLength);
	}

	async #ingestTimeline(input: DisplayMediaInput, signal?: AbortSignal): Promise<IngestedMedia> {
		const frames = input.frames ?? [];
		if (frames.length === 0) throw new MediaIngestError("display_media requires a source or at least one frame");
		if (frames.length > 720) throw new MediaIngestError("media timelines are limited to 720 frames");
		const hasText = frames.some(frame => frame.text !== undefined);
		const hasRaster = frames.some(frame => frame.source !== undefined);
		if (hasText === hasRaster) throw new MediaIngestError("timeline frames must be all text or all raster sources");
		const timeline: MediaFrameV1[] = [];
		let posterData: string | undefined;
		let posterMimeType: string | undefined;
		let rasterBytes = 0;
		if (hasText) {
			for (const frame of frames) {
				signal?.throwIfAborted();
				if (typeof frame.text !== "string" || !Number.isInteger(frame.durationMs) || frame.durationMs <= 0) {
					throw new MediaIngestError("text timeline frames require text and a positive integer durationMs");
				}
				timeline.push({ text: frame.text, durationMs: frame.durationMs });
			}
		} else {
			for (const frame of frames) {
				signal?.throwIfAborted();
				if (!frame.source || !Number.isInteger(frame.durationMs) || frame.durationMs <= 0) {
					throw new MediaIngestError("raster timeline frames require source and a positive integer durationMs");
				}
				const loaded = await this.#loadSource(frame.source, signal);
				rasterBytes += loaded.data.byteLength;
				if (rasterBytes > this.#options.maxBytes) {
					throw new MediaIngestError(`raster timeline aggregate exceeds ${this.#options.maxBytes} byte limit`);
				}
				const sniffed = sniffMedia(loaded.data);
				if (sniffed?.kind !== "image") throw new MediaIngestError("raster timeline frames must be static images");
				const asset = await this.#put(loaded.data, sniffed.mimeType);
				timeline.push({ asset, durationMs: frame.durationMs });
				posterData ??= loaded.data.toString("base64");
				posterMimeType ??= sniffed.mimeType;
			}
		}
		const canonical = Buffer.from(JSON.stringify(timeline), "utf8");
		if (canonical.byteLength > this.#options.maxBytes) {
			throw new MediaIngestError(`media timeline descriptor exceeds ${this.#options.maxBytes} byte limit`);
		}
		const hash = new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
		signal?.throwIfAborted();
		const descriptor = validateMediaDescriptorV1({
			version: 1,
			id: createMediaId(hash),
			kind: hasText ? "text-timeline" : "raster-timeline",
			durationMs: timeline.reduce((total, frame) => total + frame.durationMs, 0),
			caption: input.caption,
			alt: input.alt,
			timeline,
			...(!hasText && "asset" in timeline[0]! ? { poster: timeline[0]!.asset } : {}),
			provenance: { sourceType: "timeline", source: `timeline:${hash.slice(0, 24)}` },
			playback: playback(input),
		});
		return { descriptor, posterData, posterMimeType };
	}

	async ingest(input: DisplayMediaInput, signal?: AbortSignal): Promise<IngestedMedia> {
		signal?.throwIfAborted();
		if (!input.source) return this.#ingestTimeline(input, signal);
		if (input.frames) throw new MediaIngestError("display_media accepts either source or frames, not both");
		const loaded = await this.#loadSource(input.source, signal);
		signal?.throwIfAborted();
		const sniffed = sniffMedia(loaded.data);
		if (!sniffed) throw new MediaIngestError("unsupported or corrupt media content");
		if (
			loaded.contentType &&
			loaded.contentType !== "application/octet-stream" &&
			loaded.contentType !== sniffed.mimeType
		) {
			throw new MediaIngestError(
				`media MIME mismatch: server sent ${loaded.contentType}, content is ${sniffed.mimeType}`,
			);
		}
		const original = await this.#put(loaded.data, sniffed.mimeType);
		let poster = sniffed.kind === "image" ? original : undefined;
		let posterData = sniffed.kind === "image" ? loaded.data.toString("base64") : undefined;
		let posterMimeType = sniffed.kind === "image" ? sniffed.mimeType : undefined;
		let degradation: string | undefined;
		let width = sniffed.width;
		let height = sniffed.height;
		let durationMs: number | undefined;
		let timeline: MediaFrameV1[] | undefined;
		if (sniffed.kind !== "image") {
			const [probe, decodedFrames] = await Promise.all([
				probeMedia(loaded.data, this.#options.ffprobePath, 10_000, signal),
				decodeRasterFrames(loaded.data, {
					ffmpegPath: this.#options.ffmpegPath,
					fpsCap: playback(input).fpsCap,
					maxOutputBytes: this.#options.maxBytes,
					signal,
				}),
			]);
			signal?.throwIfAborted();
			width ??= probe?.width;
			height ??= probe?.height;
			durationMs = probe?.durationMs;
			if (decodedFrames?.length) {
				timeline = [];
				for (const frame of decodedFrames) {
					timeline.push({ asset: await this.#put(frame.data, "image/png"), durationMs: frame.durationMs });
				}
				const first = decodedFrames[0]!;
				poster = "asset" in timeline[0]! ? timeline[0]!.asset : undefined;
				posterData = first.data.toString("base64");
				posterMimeType = "image/png";
				durationMs ??= timeline.reduce((total, frame) => total + frame.durationMs, 0);
			} else {
				const decodedPoster = await decodePoster(loaded.data, this.#options.ffmpegPath, 15_000, signal);
				if (decodedPoster) {
					poster = await this.#put(decodedPoster, "image/png");
					posterData = decodedPoster.toString("base64");
					posterMimeType = "image/png";
				}
				degradation =
					"FFmpeg 6+ is unavailable or could not decode bounded animation frames; showing a static poster.";
			}
		}
		const descriptor = validateMediaDescriptorV1({
			version: 1,
			id: createMediaId(original.ref.slice("blob:sha256:".length)),
			kind: sniffed.kind,
			width,
			height,
			durationMs,
			caption: input.caption,
			alt: input.alt,
			original,
			poster,
			timeline,
			provenance: sanitizeMediaProvenance(loaded.provenanceSource),
			playback: playback(input),
			degradation,
		});
		return { descriptor, posterData, posterMimeType };
	}
}
