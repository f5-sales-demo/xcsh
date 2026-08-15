import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import type { ImageContent, TextContent } from "@f5-sales-demo/pi-ai";
import type { IngestedMedia } from "./ingest";
import { MEDIA_TOOL_RESULT_V1, type MediaToolResultV1, validateMediaToolResultV1 } from "./tool-result";
import type { MediaMessage } from "./types";
import { validateMediaDescriptorV1 } from "./types";

export { MEDIA_TOOL_RESULT_V1, type MediaToolResultV1, validateMediaToolResultV1 } from "./tool-result";

export interface MediaPublisherSession {
	appendMediaMessage?: (message: MediaMessage) => void;
}

export interface PublishMediaOptions {
	text?: string[];
	timestamp?: number;
}

/**
 * Canonical publication boundary for all media producers. It validates the durable descriptor,
 * appends exactly one transcript MediaMessage, and returns the standard versioned tool result.
 */
export function publishMedia(
	session: MediaPublisherSession,
	ingested: IngestedMedia,
	options: PublishMediaOptions = {},
): AgentToolResult<MediaToolResultV1> {
	const descriptor = validateMediaDescriptorV1(ingested.descriptor);
	const message: MediaMessage = { role: "media", media: descriptor, timestamp: options.timestamp ?? Date.now() };
	session.appendMediaMessage?.(message);

	const content: Array<TextContent | ImageContent> = [];
	let displayMethod: MediaToolResultV1["displayMethod"] = "text";
	if (ingested.posterData && ingested.posterMimeType) {
		content.push({ type: "image", data: ingested.posterData, mimeType: ingested.posterMimeType });
		displayMethod = descriptor.kind === "image" ? "inline" : "poster";
	}
	for (const value of options.text ?? []) {
		if (value) content.push({ type: "text", text: value });
	}
	if (descriptor.degradation) content.push({ type: "text", text: descriptor.degradation });
	if (content.length === 0) content.push({ type: "text", text: `Media ready: ${descriptor.id}` });

	return {
		content,
		details: validateMediaToolResultV1({ mediaResult: MEDIA_TOOL_RESULT_V1, descriptor, displayMethod }),
	};
}
