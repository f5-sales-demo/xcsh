/** TUI renderer for inspect_image — bordered output with themed sections. */
import type { Component } from "@f5-sales-demo/pi-tui";
import { Text } from "@f5-sales-demo/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import { addSection, formatErrorMessage, replaceTabs, shortenPath } from "./render-utils";

const TOOL_TITLE = "Inspect Image";
const MAX_OUTPUT_LINES = 30;

interface InspectImageRenderArgs {
	path?: string;
	question?: string;
}

interface InspectImageRendererDetails {
	model: string;
	imagePath: string;
	mimeType: string;
}

interface InspectImageRendererResult {
	content: Array<{ type: string; text?: string }>;
	details?: InspectImageRendererDetails;
	isError?: boolean;
}

export const inspectImageToolRenderer = {
	renderCall(args: InspectImageRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const rawPath = args.path ?? "";
		const pathDisplay = rawPath ? shortenPath(rawPath) : "…";
		const description = uiTheme.fg("muted", pathDisplay);
		const text = renderStatusLine({ icon: "pending", title: TOOL_TITLE, description }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: InspectImageRendererResult,
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: InspectImageRenderArgs,
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

		if (details?.model) meta.push(uiTheme.fg("dim", details.model));
		if (details?.mimeType) meta.push(uiTheme.fg("dim", details.mimeType));

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text ?? "Unknown error";
			addSection(sections, "Error", [uiTheme.fg("error", errorText)], uiTheme);
		} else {
			if (args?.question) {
				addSection(sections, "Question", [uiTheme.fg("chromeAccent", `  ${args.question}`)], uiTheme);
			}

			const outputText = result.content.find(c => c.type === "text")?.text?.trimEnd() ?? "";
			if (outputText) {
				const outputLines = outputText.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
				addSection(sections, "Analysis", outputLines, uiTheme, MAX_OUTPUT_LINES);
			} else {
				addSection(sections, "Analysis", [uiTheme.fg("dim", "  (no output)")], uiTheme);
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
