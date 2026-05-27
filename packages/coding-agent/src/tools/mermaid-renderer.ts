/** TUI renderer for the render_mermaid tool — bordered ASCII diagram output. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { RenderMermaidToolDetails } from "./render-mermaid";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "Mermaid";
const MAX_DIAGRAM_LINES = 40;

type MermaidRenderArgs = {
	mermaid?: string;
};

export const mermaidRenderer = {
	renderCall(_args: MermaidRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const text = renderStatusLine(
			{ icon: "pending", title: TOOL_TITLE, description: uiTheme.fg("muted", "rendering diagram") },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: RenderMermaidToolDetails;
			isError?: boolean;
		},
		options: RenderResultOptions,
		uiTheme: Theme,
		_args?: MermaidRenderArgs,
	): Component {
		const isError = result.isError === true;

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];
		const rawText = result.content?.find(c => c.type === "text")?.text ?? "";

		// Strip artifact reference from display
		const artifactIdx = rawText.indexOf("\n\nSaved artifact:");
		const diagramText = artifactIdx >= 0 ? rawText.slice(0, artifactIdx) : rawText;

		const diagramLines = diagramText.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
		addSection(sections, "Diagram", diagramLines, uiTheme, MAX_DIAGRAM_LINES);

		if (result.details?.artifactId) {
			meta.push(uiTheme.fg("dim", `artifact:${result.details.artifactId.slice(0, 8)}`));
		}

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "dim",
				description: uiTheme.fg("muted", "diagram"),
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		const outputBlock = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : "success";
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
