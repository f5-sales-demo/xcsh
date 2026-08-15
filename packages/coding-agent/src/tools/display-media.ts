import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import type { ImageContent, TextContent } from "@f5-sales-demo/pi-ai";
import { getBlobsDir, prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { type DisplayMediaInput, type IngestedMedia, MediaIngestError, MediaIngestor } from "../media/ingest";
import type { MediaDescriptorV1, MediaMessage } from "../media/types";
import displayMediaDescription from "../prompts/tools/display-media.md" with { type: "text" };
import { BlobStore } from "../session/blob-store";
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

const mediaFrameSchema = Type.Object(
	{
		text: Type.Optional(Type.String()),
		source: Type.Optional(Type.String()),
		durationMs: Type.Integer({ minimum: 1 }),
	},
	{ additionalProperties: false },
);

const displayMediaSchema = Type.Object(
	{
		source: Type.Optional(
			Type.String({
				description: "Local path, artifact:// URL, session/tool artifact, or HTTPS URL",
			}),
		),
		frames: Type.Optional(Type.Array(mediaFrameSchema, { minItems: 1 })),
		caption: Type.Optional(Type.String()),
		alt: Type.Optional(Type.String()),
		autoplay: Type.Optional(Type.Boolean({ default: true })),
		loop: Type.Optional(Type.Boolean({ default: false })),
		fpsCap: Type.Optional(Type.Integer({ minimum: 1, maximum: 60, default: 12 })),
	},
	{ additionalProperties: false },
);

export type DisplayMediaParams = Static<typeof displayMediaSchema>;

export interface DisplayMediaToolDetails {
	descriptor: MediaDescriptorV1;
	displayMethod: "inline" | "poster" | "text";
}

export class DisplayMediaTool implements AgentTool<typeof displayMediaSchema, DisplayMediaToolDetails> {
	readonly name = "display_media";
	readonly label = "DisplayMedia";
	readonly description = prompt.render(displayMediaDescription);
	readonly parameters = displayMediaSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: DisplayMediaParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<DisplayMediaToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<DisplayMediaToolDetails>> {
		if ((params.source ? 1 : 0) + (params.frames ? 1 : 0) !== 1) {
			throw new ToolError("display_media accepts either source or frames, but not both.");
		}
		if (this.session.settings.get("images.blockImages")) {
			throw new ToolError("Media display is disabled by settings (images.blockImages=true).");
		}
		const ingestor = new MediaIngestor({
			cwd: this.session.cwd,
			blobStore: this.session.mediaBlobStore ?? new BlobStore(getBlobsDir()),
			internalRouter: this.session.internalRouter,
		});
		let ingested: IngestedMedia;
		try {
			ingested = await ingestor.ingest(params as DisplayMediaInput, signal);
		} catch (error) {
			if (error instanceof MediaIngestError) throw new ToolError(error.message);
			throw error;
		}

		const message: MediaMessage = { role: "media", media: ingested.descriptor, timestamp: Date.now() };
		this.session.appendMediaMessage?.(message);

		const content: Array<TextContent | ImageContent> = [];
		let displayMethod: DisplayMediaToolDetails["displayMethod"] = "text";
		if (ingested.posterData && ingested.posterMimeType) {
			content.push({ type: "image", data: ingested.posterData, mimeType: ingested.posterMimeType });
			displayMethod = ingested.descriptor.kind === "image" ? "inline" : "poster";
		}
		if (params.caption) content.push({ type: "text", text: params.caption });
		if (ingested.descriptor.degradation) content.push({ type: "text", text: ingested.descriptor.degradation });
		if (content.length === 0) {
			content.push({ type: "text", text: `Media ready: ${ingested.descriptor.id}` });
		}
		return { content, details: { descriptor: ingested.descriptor, displayMethod } };
	}
}

export { displayMediaToolRenderer } from "./display-media-renderer";
