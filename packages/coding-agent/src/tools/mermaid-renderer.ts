/** TUI renderer for the render_mermaid tool — single F5-framed, themed, colorized diagram. */
import type { Component } from "@f5-sales-demo/pi-tui";
import { Text, visibleWidth } from "@f5-sales-demo/pi-tui";
import { detectDiagramType, type MermaidDiagramType } from "@f5-sales-demo/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { renderMermaidThemed } from "../modes/theme/mermaid-cache";
import type { Theme } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, type OutputBlockOptions, renderStatusLine } from "../tui";
import type { RenderMermaidToolDetails } from "./render-mermaid";
import { formatErrorMessage, replaceTabs } from "./render-utils";

const TOOL_TITLE = "Mermaid";

/** Human-friendly caption for the diagram type, shown in the F5 frame header. */
export function diagramTypeLabel(type: MermaidDiagramType): string {
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

/**
 * Build the F5 output-block options that frame a themed/colored mermaid diagram.
 * Shared by the render_mermaid tool result AND inline ```mermaid markdown blocks, so
 * every mermaid render gets the SAME single F5 frame — and the diagram is clipped
 * (wrapContent: false), never wrapped, so a wide diagram can't reflow or overflow.
 */
export function buildMermaidBlockOptions(
	diagramText: string,
	opts: { width: number; theme: Theme; typeLabel: string; artifactId?: string },
): OutputBlockOptions {
	// Unlabeled section: the header already reads "Mermaid · <type>", so a "Diagram"
	// bar would be redundant. The diagram keeps its own colors; we only normalize tabs.
	const lines = diagramText.split("\n").map(line => replaceTabs(line));
	const meta = opts.artifactId ? [opts.theme.fg("dim", `artifact:${opts.artifactId.slice(0, 8)}`)] : undefined;
	const header = renderStatusLine(
		{ title: TOOL_TITLE, titleColor: "dim", description: opts.theme.fg("muted", opts.typeLabel), meta },
		opts.theme,
	);
	// Size the frame SNUGLY to the diagram (+ one space of padding each side), capped at
	// the available width and kept wide enough for the header caption — so the diagram
	// feels enclosed in a small padded frame instead of spanning the whole terminal
	// (tiny diagram) or clipping against the right border (wide diagram).
	const maxDiagramWidth = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	const desired = Math.max(maxDiagramWidth + 4, visibleWidth(header) + 8);
	const width = Math.min(opts.width, Math.max(1, desired));
	return {
		header,
		state: "success",
		sections: [{ lines }],
		width,
		borderColor: F5_TOOL_BORDER_COLOR,
		wrapContent: false,
	};
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

		// Prefer re-rendering from the original source: themed, per-node-tinted, colored.
		const source = args?.mermaid?.trim();
		const typeLabel = source ? diagramTypeLabel(detectDiagramType(source)) : "diagram";
		const artifactId = result.details?.artifactId;

		const block = new CachedOutputBlock();
		return {
			render(width: number): string[] {
				// Expand the diagram toward the available width (inside the frame), then
				// size the frame snugly around the result.
				const targetWidth = Math.max(20, width - 4);
				const diagramText = (source ? renderMermaidThemed(source, uiTheme, { targetWidth }) : null) ?? plainText;
				return block.render(
					buildMermaidBlockOptions(diagramText, { width, theme: uiTheme, typeLabel, artifactId }),
					uiTheme,
				);
			},
			invalidate() {
				block.invalidate();
			},
		};
	},

	mergeCallAndResult: true,
	inline: true,
};
