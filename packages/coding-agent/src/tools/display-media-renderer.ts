import type { Component } from "@f5-sales-demo/pi-tui";
import { Text } from "@f5-sales-demo/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { MediaDescriptorV1 } from "../media/types";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import { addSection, formatErrorMessage, shortenPath } from "./render-utils";

interface DisplayMediaRenderArgs {
	source?: string;
	frames?: unknown[];
	caption?: string;
}

interface DisplayMediaRendererResult {
	content: Array<{ type: string; text?: string }>;
	details?: { descriptor: MediaDescriptorV1; displayMethod: "inline" | "poster" | "text" };
	isError?: boolean;
}

function description(args: DisplayMediaRenderArgs): string {
	if (args.source) return shortenPath(args.source);
	if (args.frames) return `${args.frames.length} timeline frame${args.frames.length === 1 ? "" : "s"}`;
	return "media";
}

export const displayMediaToolRenderer = {
	renderCall(args: DisplayMediaRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		return new Text(
			renderStatusLine(
				{
					icon: "pending",
					title: "Display Media",
					description: uiTheme.fg("muted", description(args)),
				},
				uiTheme,
			),
			0,
			0,
		);
	},

	renderResult(
		result: DisplayMediaRendererResult,
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: DisplayMediaRenderArgs,
	): Component {
		if (result.isError && !result.details) {
			const errorText = result.content?.find(content => content.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}
		const descriptor = result.details?.descriptor;
		const sections: Array<{ label?: string; lines: string[] }> = [];
		for (const block of result.content?.filter(content => content.type === "text") ?? []) {
			if (block.text) addSection(sections, "", [uiTheme.fg("toolOutput", `  ${block.text}`)], uiTheme);
		}
		const meta = descriptor
			? [
					uiTheme.fg("dim", descriptor.kind),
					uiTheme.fg("dim", descriptor.id),
					uiTheme.fg("dim", result.details?.displayMethod ?? "text"),
				]
			: undefined;
		const header = renderStatusLine(
			{
				title: "Display Media",
				titleColor: "contentAccent",
				description: description(args ?? {}),
				meta,
			},
			uiTheme,
		);
		const outputBlock = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				return outputBlock.render(
					{
						header,
						state: options.isPartial ? "pending" : result.isError ? "error" : "success",
						sections,
						width,
						borderColor: F5_TOOL_BORDER_COLOR,
					},
					uiTheme,
				);
			},
			invalidate(): void {
				outputBlock.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
