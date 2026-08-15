import * as path from "node:path";
import type { MarkdownMediaOptions, ResolvedMarkdownMedia } from "@f5-sales-demo/pi-tui";
import type { SessionEntry, SessionManager } from "../session/session-manager";
import { type DisplayMediaInput, MediaIngestor } from "./ingest";
import type { MediaDescriptorV1, MediaMessage } from "./types";
import { sanitizeMediaProvenance } from "./types";

function provenanceKey(source: string, cwd: string): string {
	if (source.startsWith("https://") || source.startsWith("artifact://")) {
		return sanitizeMediaProvenance(source).source;
	}
	const resolved = path.isAbsolute(source) ? path.normalize(source) : path.resolve(cwd, source);
	return sanitizeMediaProvenance(resolved).source;
}

function findPersistedDescriptor(entries: SessionEntry[], source: string, cwd: string): MediaDescriptorV1 | undefined {
	const key = provenanceKey(source, cwd);
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (
			entry?.type === "message" &&
			entry.message.role === "media" &&
			entry.message.media.provenance.source === key
		) {
			return entry.message.media;
		}
	}
	return undefined;
}

async function resolveDescriptorAsset(
	manager: SessionManager,
	descriptor: MediaDescriptorV1,
	alt: string,
): Promise<ResolvedMarkdownMedia | null> {
	const first = descriptor.timeline?.[0];
	const asset =
		descriptor.poster ??
		(descriptor.kind === "image" ? descriptor.original : undefined) ??
		(first && "asset" in first ? first.asset : undefined);
	if (!asset) return null;
	const hash = asset.ref.startsWith("blob:sha256:") ? asset.ref.slice("blob:sha256:".length) : "";
	const data = hash ? await manager.getBlobStore().get(hash) : null;
	if (!data) return null;
	return {
		id: descriptor.id,
		data: data.toString("base64"),
		mimeType: asset.mimeType,
		filename: alt || descriptor.alt,
	};
}

export function createMarkdownMediaOptions(manager: SessionManager, onInvalidate: () => void): MarkdownMediaOptions {
	return {
		onInvalidate,
		resolve: async request => {
			const persisted = findPersistedDescriptor(manager.getEntries(), request.source, manager.getCwd());
			if (persisted) {
				const restored = await resolveDescriptorAsset(manager, persisted, request.alt);
				if (restored) return restored;
			}
			const ingestor = new MediaIngestor({
				cwd: manager.getCwd(),
				blobStore: manager.getBlobStore(),
				resolveArtifact: async source => {
					const id = new URL(source).hostname;
					return await manager.getArtifactPath(id);
				},
			});
			const ingested = await ingestor.ingest({
				source: request.source,
				alt: request.alt,
			} satisfies DisplayMediaInput);
			const message: MediaMessage = { role: "media", media: ingested.descriptor, timestamp: Date.now() };
			manager.appendMessage(message);
			const resolved = await resolveDescriptorAsset(manager, ingested.descriptor, request.alt);
			if (!resolved) throw new Error(ingested.descriptor.degradation ?? "media has no displayable poster");
			return resolved;
		},
	};
}
