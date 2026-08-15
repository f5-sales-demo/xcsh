export type MediaKind = "image" | "video" | "animation" | "raster-timeline" | "text-timeline";

export interface MediaAssetRefV1 {
	ref: string;
	mimeType: string;
	bytes: number;
}

export interface MediaTextFrameV1 {
	text: string;
	durationMs: number;
}

export interface MediaRasterFrameV1 {
	asset: MediaAssetRefV1;
	durationMs: number;
}

export type MediaFrameV1 = MediaTextFrameV1 | MediaRasterFrameV1;

export interface MediaProvenanceV1 {
	sourceType: "path" | "artifact" | "url" | "timeline" | "tool";
	source: string;
}

export interface MediaPlaybackV1 {
	autoplay: boolean;
	loop: boolean;
	muted: true;
	fpsCap: number;
}

export interface MediaDescriptorV1 {
	version: 1;
	id: string;
	kind: MediaKind;
	width?: number;
	height?: number;
	durationMs?: number;
	caption?: string;
	alt?: string;
	original?: MediaAssetRefV1;
	poster?: MediaAssetRefV1;
	timeline?: MediaFrameV1[];
	provenance: MediaProvenanceV1;
	playback: MediaPlaybackV1;
	degradation?: string;
}

export interface MediaMessage {
	role: "media";
	media: MediaDescriptorV1;
	timestamp: number;
}

const BLOB_REF_RE = /^blob:sha256:[a-f0-9]{64}$/u;
const MEDIA_ID_RE = /^media_[a-f0-9]{24}$/u;
const MIME_RE = /^(?:image\/(?:png|jpeg|gif|webp)|video\/mp4|text\/plain)$/u;

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
	if (!Number.isInteger(value) || Number(value) <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
}

function validateAsset(value: unknown, field: string): asserts value is MediaAssetRefV1 {
	if (!value || typeof value !== "object") throw new Error(`${field} must be an asset reference`);
	const asset = value as Partial<MediaAssetRefV1>;
	if (typeof asset.ref !== "string" || !BLOB_REF_RE.test(asset.ref)) {
		throw new Error(`${field}.ref must be a SHA-256 blob reference`);
	}
	if (typeof asset.mimeType !== "string" || !MIME_RE.test(asset.mimeType)) {
		throw new Error(`${field}.mimeType is unsupported`);
	}
	assertPositiveInteger(asset.bytes, `${field}.bytes`);
}

export function createMediaId(sha256: string): string {
	if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error("media hash must be 64 lowercase hexadecimal characters");
	return `media_${sha256.slice(0, 24)}`;
}

export function sanitizeMediaProvenance(source: string): MediaProvenanceV1 {
	if (source.startsWith("https://")) {
		const url = new URL(source);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return { sourceType: "url", source: url.toString() };
	}
	if (source.startsWith("artifact://")) {
		return { sourceType: "artifact", source: source.split(/[?#]/u, 1)[0] ?? source };
	}
	return { sourceType: "path", source: source.replace(/[\u0000-\u001f\u007f]/gu, "") };
}

export function validateMediaDescriptorV1(value: unknown): MediaDescriptorV1 {
	if (!value || typeof value !== "object") throw new Error("media descriptor must be an object");
	const descriptor = value as Partial<MediaDescriptorV1>;
	if (descriptor.version !== 1) throw new Error("unsupported media descriptor version");
	if (typeof descriptor.id !== "string" || !MEDIA_ID_RE.test(descriptor.id)) throw new Error("invalid media id");
	if (!["image", "video", "animation", "raster-timeline", "text-timeline"].includes(String(descriptor.kind))) {
		throw new Error("invalid media kind");
	}
	if (!descriptor.original && !descriptor.poster && !descriptor.timeline) {
		throw new Error("media descriptor requires an original, poster, or timeline");
	}
	if (descriptor.original) validateAsset(descriptor.original, "original");
	if (descriptor.poster) validateAsset(descriptor.poster, "poster");
	if (descriptor.width !== undefined) assertPositiveInteger(descriptor.width, "width");
	if (descriptor.height !== undefined) assertPositiveInteger(descriptor.height, "height");
	if (descriptor.durationMs !== undefined) assertPositiveInteger(descriptor.durationMs, "durationMs");
	if (!descriptor.provenance || typeof descriptor.provenance.source !== "string") {
		throw new Error("media provenance is required");
	}
	if (descriptor.playback?.muted !== true) throw new Error("media playback must be muted");
	if (typeof descriptor.playback.autoplay !== "boolean" || typeof descriptor.playback.loop !== "boolean") {
		throw new Error("media playback flags are required");
	}
	if (
		!Number.isFinite(descriptor.playback.fpsCap) ||
		descriptor.playback.fpsCap < 1 ||
		descriptor.playback.fpsCap > 60
	) {
		throw new Error("fpsCap must be between 1 and 60");
	}
	if (descriptor.timeline) {
		if (descriptor.timeline.length === 0) throw new Error("timeline must contain at least one frame");
		for (const [index, frame] of descriptor.timeline.entries()) {
			assertPositiveInteger(frame.durationMs, `timeline[${index}].durationMs`);
			if ("asset" in frame) validateAsset(frame.asset, `timeline[${index}].asset`);
			else if (typeof frame.text !== "string") throw new Error(`timeline[${index}].text must be a string`);
		}
	}
	return descriptor as MediaDescriptorV1;
}
