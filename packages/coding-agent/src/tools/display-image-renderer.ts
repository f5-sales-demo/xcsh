import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import { addSection, formatErrorMessage, shortenPath } from "./render-utils";

const TOOL_TITLE = "Display Image";

interface DisplayImageRenderArgs {
	path?: string;
	caption?: string;
}

interface DisplayImageRendererDetails {
	imagePath: string;
	mimeType: string;
	displayMethod: "inline" | "external";
}

interface DisplayImageRendererResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: DisplayImageRendererDetails;
	isError?: boolean;
}

export const displayImageToolRenderer = {
	renderCall(args: DisplayImageRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const rawPath = args.path ?? "";
		const pathDisplay = rawPath ? shortenPath(rawPath) : "...";
		const description = uiTheme.fg("muted", pathDisplay);
		const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: DisplayImageRendererResult,
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: DisplayImageRenderArgs,
	): Component {
		const details = result.details;
		const isError = result.isError === true;

		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const rawPath = details?.imagePath ?? args?.path ?? "";
		const pathDisplay = rawPath ? shortenPath(rawPath) : "image";
		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];

		if (details?.mimeType) meta.push(uiTheme.fg("dim", details.mimeType));
		if (details?.displayMethod === "external") meta.push(uiTheme.fg("dim", "external viewer"));

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text ?? "Unknown error";
			addSection(sections, "Error", [uiTheme.fg("error", errorText)], uiTheme);
		} else {
			const textContent = result.content?.filter(c => c.type === "text");
			if (textContent?.length) {
				for (const block of textContent) {
					if (block.text) {
						addSection(sections, "", [uiTheme.fg("toolOutput", `  ${block.text}`)], uiTheme);
					}
				}
			}
		}

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "contentAccent",
				description: pathDisplay,
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		const outputBlock = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : isError ? "error" : "success";
				return outputBlock.render({ header, state, sections, width, borderColor: F5_TOOL_BORDER_COLOR }, uiTheme);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
