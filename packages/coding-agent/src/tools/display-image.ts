import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import type { ImageContent, TextContent } from "@f5-sales-demo/pi-ai";
import { TERMINAL } from "@f5-sales-demo/pi-tui/terminal-capabilities";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import displayImageDescription from "../prompts/tools/display-image.md" with { type: "text" };
import {
	ImageInputTooLargeError,
	type LoadedImageInput,
	loadImageInput,
	MAX_IMAGE_INPUT_BYTES,
} from "../utils/image-loading";
import { openImageExternal } from "../utils/image-viewer";
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

const displayImageSchema = Type.Object(
	{
		path: Type.String({ description: "Filesystem path to an image file" }),
		caption: Type.Optional(Type.String({ description: "Caption text shown below the image" })),
	},
	{ additionalProperties: false },
);

export type DisplayImageParams = Static<typeof displayImageSchema>;

export interface DisplayImageToolDetails {
	imagePath: string;
	mimeType: string;
	displayMethod: "inline" | "external";
}

export class DisplayImageTool implements AgentTool<typeof displayImageSchema, DisplayImageToolDetails> {
	readonly name = "display_image";
	readonly label = "DisplayImage";
	readonly description: string;
	readonly parameters = displayImageSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(displayImageDescription);
	}

	async execute(
		_toolCallId: string,
		params: DisplayImageParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<DisplayImageToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<DisplayImageToolDetails>> {
		if (this.session.settings.get("images.blockImages")) {
			throw new ToolError("Image display is disabled by settings (images.blockImages=true).");
		}

		let imageInput: LoadedImageInput | null;
		try {
			imageInput = await loadImageInput({
				path: params.path,
				cwd: this.session.cwd,
				autoResize: this.session.settings.get("images.autoResize"),
				maxBytes: MAX_IMAGE_INPUT_BYTES,
			});
		} catch (error) {
			if (error instanceof ImageInputTooLargeError) {
				throw new ToolError(error.message);
			}
			throw error;
		}

		if (!imageInput) {
			throw new ToolError("display_image only supports PNG, JPEG, GIF, and WEBP files detected by file content.");
		}

		const content: (TextContent | ImageContent)[] = [];
		let displayMethod: "inline" | "external";

		if (TERMINAL.imageProtocol) {
			content.push({ type: "image", data: imageInput.data, mimeType: imageInput.mimeType });
			displayMethod = "inline";
		} else {
			const opened = await openImageExternal(imageInput.resolvedPath);
			const msg = opened
				? `Opened ${imageInput.resolvedPath} in system image viewer.`
				: `Could not open ${imageInput.resolvedPath} — no inline image protocol and external viewer failed.`;
			content.push({ type: "text", text: msg });
			displayMethod = "external";
		}

		if (params.caption) {
			content.push({ type: "text", text: params.caption });
		}

		return {
			content,
			details: {
				imagePath: imageInput.resolvedPath,
				mimeType: imageInput.mimeType,
				displayMethod,
			},
		};
	}
}

export { displayImageToolRenderer } from "./display-image-renderer";
