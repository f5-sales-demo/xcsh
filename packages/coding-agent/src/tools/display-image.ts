import * as path from "node:path";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import displayImageDescription from "../prompts/tools/display-image.md" with { type: "text" };
import { DisplayMediaTool } from "./display-media";
import type { ToolSession } from "./index";

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

/** Compatibility wrapper for callers that still use the legacy display_image contract. */
export class DisplayImageTool implements AgentTool<typeof displayImageSchema, DisplayImageToolDetails> {
	readonly name = "display_image";
	readonly label = "DisplayImage";
	readonly description = prompt.render(displayImageDescription);
	readonly parameters = displayImageSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		toolCallId: string,
		params: DisplayImageParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<DisplayImageToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<DisplayImageToolDetails>> {
		const result = await new DisplayMediaTool(this.session).execute(
			toolCallId,
			{ source: params.path, caption: params.caption },
			signal,
			undefined,
			context,
		);
		const descriptor = result.details?.descriptor;
		if (!descriptor?.original) throw new Error("display_media did not return an original image asset");
		return {
			content: result.content,
			details: {
				imagePath: path.isAbsolute(params.path)
					? path.normalize(params.path)
					: path.resolve(this.session.cwd, params.path),
				mimeType: descriptor.original.mimeType,
				displayMethod: "inline",
			},
		};
	}
}

export { displayImageToolRenderer } from "./display-image-renderer";
