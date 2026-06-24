/** TUI renderer for the render_mermaid tool — bordered, themed, colorized diagram output. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Text } from "@f5xc-salesdemos/pi-tui";
import { detectDiagramType, type MermaidDiagramType } from "@f5xc-salesdemos/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { renderMermaidThemed } from "../modes/theme/mermaid-cache";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { RenderMermaidToolDetails } from "./render-mermaid";
import { addSection, formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "Mermaid";
const MAX_DIAGRAM_LINES = 40;

/** Human-friendly caption for the diagram-type badge in the block header. */
function diagramTypeLabel(type: MermaidDiagramType): string {
	switch (type) {
		case "flowchart":
			return "flowchart";
		case "sequence":
			return "sequence diagram";
		case "class":
			return "class diagram";
		case "er":
			return "ER diagram";
		case "state":
			return "state diagram";
		case "xychart":
			return "xychart";
		default:
			return "diagram";
	}
}

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
		args?: MermaidRenderArgs,
	): Component {
		const isError = result.isError === true;

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];
		const rawText = result.content?.find(c => c.type === "text")?.text ?? "";

		// Strip artifact reference from the plain result text (fallback path).
		const artifactIdx = rawText.indexOf("\n\nSaved artifact:");
		const plainText = artifactIdx >= 0 ? rawText.slice(0, artifactIdx) : rawText;

		// Prefer re-rendering from the original source: this yields the themed,
		// per-role-colored, node-tinted diagram. Fall back to the plain result text.
		const source = args?.mermaid?.trim();
		const diagramText = (source ? renderMermaidThemed(source, uiTheme) : null) ?? plainText;
		const caption = source ? diagramTypeLabel(detectDiagramType(source)) : "diagram";

		// Keep the diagram's own colors — do NOT recolor each line a flat tool color.
		const diagramLines = diagramText.split("\n").map(line => replaceTabs(line));
		addSection(sections, "Diagram", diagramLines, uiTheme, MAX_DIAGRAM_LINES);

		if (result.details?.artifactId) {
			meta.push(uiTheme.fg("dim", `artifact:${result.details.artifactId.slice(0, 8)}`));
		}

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "dim",
				description: uiTheme.fg("muted", caption),
				meta: meta.length > 0 ? meta : undefined,
			},
			uiTheme,
		);

		const outputBlock = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				const state = options.isPartial ? "pending" : "success";
				return outputBlock.render(
					// Clip, don't wrap: a diagram is a fixed grid — word-wrapping reflows it
					// and breaks alignment. Wide diagrams are truncated to the block width.
					{ header, state, sections, width, borderColor: F5_TOOL_BORDER_COLOR, wrapContent: false },
					uiTheme,
				);
			},
			invalidate() {
				outputBlock.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
