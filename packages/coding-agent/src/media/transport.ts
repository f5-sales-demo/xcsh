import type { BlobStore } from "../session/blob-store";
import { parseBlobRef } from "../session/blob-store";
import { validateMediaToolResultV1 } from "./tool-result";
import type { MediaAssetRefV1, MediaDescriptorV1 } from "./types";
import { sanitizeMediaProvenance, validateMediaDescriptorV1 } from "./types";

export const MEDIA_ASSET_CHUNK_MAX_BYTES = 256 * 1024;

export interface MediaAssetReadRequest {
	ref: string;
	offset?: number;
	length?: number;
}

export interface MediaAssetChunk {
	ref: string;
	mimeType: string;
	offset: number;
	nextOffset: number;
	eof: boolean;
	bytes: number;
	data: string;
}

/** Return the descriptor shape shared by RPC, browser/Office, and ACP without leaking local paths. */
export function projectMediaDescriptorForTransport(descriptor: MediaDescriptorV1): MediaDescriptorV1 {
	const projected = structuredClone(validateMediaDescriptorV1(descriptor));
	if (projected.provenance.sourceType === "url" && projected.provenance.source.startsWith("https://")) {
		try {
			projected.provenance = sanitizeMediaProvenance(projected.provenance.source);
		} catch {
			projected.provenance = { sourceType: "tool", source: "display_media" };
		}
	} else if (projected.provenance.sourceType !== "tool") {
		projected.provenance = { sourceType: "tool", source: "display_media" };
	}
	return projected;
}

/** Enumerate all descriptor assets once, in deterministic playback order. */
export function listMediaAssets(descriptor: MediaDescriptorV1): MediaAssetRefV1[] {
	const result: MediaAssetRefV1[] = [];
	const seen = new Set<string>();
	const add = (asset: MediaAssetRefV1 | undefined) => {
		if (!asset || seen.has(asset.ref)) return;
		seen.add(asset.ref);
		result.push(asset);
	};
	add(descriptor.original);
	add(descriptor.poster);
	for (const frame of descriptor.timeline ?? []) {
		if ("asset" in frame) add(frame.asset);
	}
	return result;
}

export function listMediaDescriptors(entries: readonly unknown[]): MediaDescriptorV1[] {
	const descriptors: MediaDescriptorV1[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: unknown; message?: { role?: unknown; media?: unknown } };
		if (candidate.type !== "message" || candidate.message?.role !== "media") continue;
		try {
			descriptors.push(validateMediaDescriptorV1(candidate.message.media));
		} catch {
			// A malformed persisted message must not make every otherwise-valid media asset unavailable.
		}
	}
	return descriptors;
}

export function extractMediaDescriptorFromToolResult(result: unknown): MediaDescriptorV1 | undefined {
	if (!result || typeof result !== "object") return undefined;
	const details = (result as { details?: unknown }).details;
	if (!details || typeof details !== "object") return undefined;
	try {
		return validateMediaToolResultV1(details).descriptor;
	} catch {
		return undefined;
	}
}

export async function readMediaAssetChunk(
	store: BlobStore,
	descriptors: readonly MediaDescriptorV1[],
	request: MediaAssetReadRequest,
): Promise<MediaAssetChunk> {
	if (!request || typeof request.ref !== "string") throw new Error("media asset ref is required");
	const hash = parseBlobRef(request.ref);
	if (!hash || !/^[a-f0-9]{64}$/u.test(hash)) throw new Error("invalid media asset ref");

	let asset: MediaAssetRefV1 | undefined;
	for (const descriptor of descriptors) {
		asset = listMediaAssets(descriptor).find(candidate => candidate.ref === request.ref);
		if (asset) break;
	}
	if (!asset) throw new Error("unknown media asset");

	const offset = request.offset ?? 0;
	if (!Number.isSafeInteger(offset) || offset < 0)
		throw new Error("media asset offset must be a non-negative integer");
	const requestedLength = request.length ?? MEDIA_ASSET_CHUNK_MAX_BYTES;
	if (!Number.isSafeInteger(requestedLength) || requestedLength <= 0) {
		throw new Error("media asset length must be a positive integer");
	}
	const length = Math.min(requestedLength, MEDIA_ASSET_CHUNK_MAX_BYTES);

	const data = await store.get(hash);
	if (!data) throw new Error("media asset blob is missing");
	if (data.byteLength !== asset.bytes) throw new Error("media asset size mismatch");
	if (offset > data.byteLength) throw new Error("media asset offset exceeds its size");

	const end = Math.min(offset + length, data.byteLength);
	const chunk = data.subarray(offset, end);
	return {
		ref: request.ref,
		mimeType: asset.mimeType,
		offset,
		nextOffset: end,
		eof: end >= data.byteLength,
		bytes: chunk.byteLength,
		data: chunk.toString("base64"),
	};
}
