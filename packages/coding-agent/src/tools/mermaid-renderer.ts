/** TUI renderer for the render_mermaid tool — stand-alone, themed, colorized diagram. */
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { Ellipsis, Text, truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { detectDiagramType, type MermaidDiagramType } from "@f5xc-salesdemos/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { renderMermaidThemed } from "../modes/theme/mermaid-cache";
import type { Theme } from "../modes/theme/theme";
import { renderStatusLine } from "../tui";
import type { RenderMermaidToolDetails } from "./render-mermaid";
import { formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "Mermaid";

/** Human-friendly caption for the diagram type, shown in the stand-alone caption line. */
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
		_options: RenderResultOptions,
		uiTheme: Theme,
		args?: MermaidRenderArgs,
	): Component {
		if (result.isError === true) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const rawText = result.content?.find(c => c.type === "text")?.text ?? "";

		// Strip artifact reference from the plain result text (fallback path).
		const artifactIdx = rawText.indexOf("\n\nSaved artifact:");
		const plainText = artifactIdx >= 0 ? rawText.slice(0, artifactIdx) : rawText;

		// Prefer re-rendering from the original source: this yields the themed,
		// per-role-colored, node-tinted diagram. Fall back to the plain result text.
		const source = args?.mermaid?.trim();
		const diagramText = (source ? renderMermaidThemed(source, uiTheme) : null) ?? plainText;
		const typeLabel = source ? diagramTypeLabel(detectDiagramType(source)) : "diagram";
		const diagramLines = diagramText.split("\n").map(line => replaceTabs(line));

		// Stand-alone: a single dim caption, then the diagram with NO enclosing frame.
		// The diagram already carries its own boxes/subgraph frames — wrapping it in the
		// F5 output block would nest two frames (and clip the inner one into a partial box).
		const sep = uiTheme.fg("dim", uiTheme.sep.dot);
		const artifactId = result.details?.artifactId;
		const caption =
			uiTheme.fg("dim", "mermaid") +
			sep +
			uiTheme.fg("muted", typeLabel) +
			(artifactId ? sep + uiTheme.fg("dim", `artifact:${artifactId.slice(0, 8)}`) : "");

		return {
			render(width: number): string[] {
				// Clip (don't wrap) each line to the width so a wide diagram never reflows
				// (which would shatter its grid); the full diagram remains in the artifact.
				const clip = Math.max(0, width);
				const body = diagramLines.map(line => truncateToWidth(line.trimEnd(), clip, Ellipsis.Omit));
				return [caption, "", ...body];
			},
			invalidate() {},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
