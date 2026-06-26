/** TUI renderer for the browser (puppeteer) tool — lightweight action-aware display. */
import type { Component } from "@f5-sales-demo/pi-tui";
import { Text } from "@f5-sales-demo/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { CachedOutputBlock, F5_TOOL_BORDER_COLOR, renderStatusLine } from "../tui";
import type { BrowserToolDetails } from "./browser";
import { addSection, formatErrorMessage, replaceTabs, shortenPath } from "./render-utils";

const TOOL_TITLE = "Browser";
const MAX_CONTENT_LINES = 30;

type BrowserRenderArgs = {
	action?: string;
	url?: string;
	selector?: string;
	text?: string;
};

const ACTION_COLORS: Partial<Record<string, ThemeColor>> = {
	open: "muted",
	goto: "muted",
	close: "dim",
	click: "chromeAccent",
	click_id: "chromeAccent",
	type: "chromeAccent",
	type_id: "chromeAccent",
	fill: "chromeAccent",
	fill_id: "chromeAccent",
	press: "chromeAccent",
	scroll: "muted",
	drag: "chromeAccent",
	wait_for_selector: "dim",
	evaluate: "contentAccent",
	get_text: "contentAccent",
	get_html: "contentAccent",
	get_attribute: "contentAccent",
	extract_readable: "contentAccent",
	screenshot: "warning",
	observe: "accent",
};

export const browserRenderer = {
	renderCall(args: BrowserRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const action = args.action ?? "browse";
		const description = args.url
			? uiTheme.fg("muted", args.url)
			: args.selector
				? uiTheme.fg("dim", args.selector)
				: undefined;
		const badgeColor = ACTION_COLORS[action] ?? "muted";
		const text = renderStatusLine(
			{ icon: "pending", title: TOOL_TITLE, badge: { label: action, color: badgeColor }, description },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: BrowserToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: BrowserRenderArgs,
	): Component {
		const details = result.details;
		const isError = result.isError === true;

		if (isError && !details) {
			const errorText = result.content?.find(c => c.type === "text")?.text;
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const action = details?.action ?? args?.action ?? "browse";
		const badgeColor = ACTION_COLORS[action] ?? "muted";
		const sections: Array<{ label?: string; lines: string[] }> = [];
		const meta: string[] = [];

		if (isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text ?? "Unknown error";
			addSection(sections, "Error", [uiTheme.fg("error", errorText)], uiTheme);
		} else {
			if (details?.url)
				meta.push(uiTheme.fg("dim", details.url.length > 50 ? `${details.url.slice(0, 47)}…` : details.url));

			if (details?.screenshotPath) {
				addSection(
					sections,
					"Screenshot",
					[uiTheme.fg("toolOutput", `  ${shortenPath(details.screenshotPath)}`)],
					uiTheme,
				);
			}

			if (details?.viewport) {
				meta.push(uiTheme.fg("dim", `${details.viewport.width}×${details.viewport.height}`));
			}

			const textContent = result.content?.find(c => c.type === "text")?.text;
			if (textContent) {
				const contentLines = textContent.split("\n").map(line => replaceTabs(uiTheme.fg("toolOutput", line)));
				addSection(sections, "Result", contentLines, uiTheme, MAX_CONTENT_LINES);
			}
		}

		const header = renderStatusLine(
			{
				title: TOOL_TITLE,
				titleColor: "contentAccent",
				badge: { label: action, color: isError ? "error" : badgeColor },
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
