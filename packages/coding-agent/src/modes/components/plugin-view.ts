import type { PluginView } from "@f5-sales-demo/pi-agent-core";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { type Component, Markdown, renderTable, visibleWidth, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { presentation } from "../../extensibility/presentation";
import { renderStructuredRow } from "../../tui/tree-list";
import { getMarkdownTheme, getSymbolTheme, theme } from "../theme/theme";
import { copyableCommand } from "./copyable-command";

export { resultView as fallbackResultView } from "../../extensibility/presentation";
export const dataSections = presentation.data;

function valueText(value: unknown): string {
	if (typeof value === "string") return value || '""';
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/** A render-time guard also catches components that fail after their callback returned. */
export function guardedComponent(factory: () => Component | undefined, fallback: Component): Component {
	return {
		invalidate() {
			fallback.invalidate();
		},
		render(width) {
			try {
				const component = factory();
				const lines = component?.render(width);
				if (lines?.some(line => visibleWidth(sanitizeText(line).trim()) > 0)) return lines;
			} catch {
				/* Output must survive renderer failures. */
			}
			return fallback.render(width);
		},
	};
}

/** Layout is resolved on each render so resize and active-theme changes reflow data. */
export class PluginViewComponent implements Component {
	constructor(
		private view: (width: number) => PluginView | undefined,
		private expanded: boolean,
		private complete = false,
		private fallback?: Component,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const view = this.view(width);
		if (!view || (!view.summary && !view.warnings?.length && !view.sections?.length))
			return this.fallback?.render(width) ?? [];
		const lines: string[] = [];
		const wrapped = (text: string) => wrapTextWithAnsi(text, Math.max(1, width));
		if (view.summary) lines.push(...wrapped(theme.fg("toolTitle", theme.bold(view.summary))));
		for (const warning of view.warnings ?? []) lines.push(...wrapped(theme.fg("warning", warning)));
		for (const section of view.sections ?? []) {
			if (section.title) lines.push(...wrapped(theme.fg("dim", section.title)));
			if (section.kind === "fields") {
				const entries = Object.entries(section.values);
				const shown =
					this.expanded || this.complete || section.previewFields === "all"
						? entries
						: entries.filter(
								([key], index) =>
									index <
										(Number.isFinite(section.previewFields)
											? Math.max(0, Math.floor(section.previewFields as number))
											: 6) || /total|count|scope|warning|incomplete|done|hasMore|partial/i.test(key),
							);
				for (const [key, value] of shown)
					lines.push(
						...renderStructuredRow(
							`${theme.bold(key)}: ${valueText(value)}`,
							`${theme.tree.vertical} `,
							`${theme.tree.vertical} `,
							Math.max(1, width),
						),
					);
				if (shown.length < entries.length)
					lines.push(...wrapped(theme.fg("dim", `${entries.length - shown.length} more fields`)));
			} else if (section.kind === "table") {
				const limit = Number.isFinite(section.previewRows) ? Math.max(1, Math.floor(section.previewRows!)) : 3;
				const rows = this.expanded || this.complete ? section.rows : section.rows.slice(0, limit);
				lines.push(
					...renderTable(
						section.columns.map(c => c.label ?? c.key),
						rows.map(row => section.columns.map(c => valueText(row[c.key]))),
						width,
						{ symbols: getSymbolTheme().table, bold: text => theme.bold(text) },
						section.columns.map(
							c =>
								c.align ??
								(section.rows.some(row => typeof row[c.key] === "number") &&
								section.rows.every(row => row[c.key] == null || typeof row[c.key] === "number")
									? "right"
									: "left"),
						),
						section.columns,
					),
				);
				if (rows.length < section.rows.length)
					lines.push(...wrapped(theme.fg("dim", `${section.rows.length - rows.length} more rows`)));
				if (!section.rows.length) lines.push(...wrapped(theme.fg("dim", "0 rows")));
			} else if (section.kind === "code") {
				lines.push(
					...(section.argv
						? copyableCommand(section.argv, width).map(line => theme.fg("toolOutput", line))
						: wrapped(theme.fg("toolOutput", section.text))),
				);
			} else {
				// Errors and tables retain complete semantic blocks in the collapsed preview.
				const text =
					this.expanded || this.complete || section.text.includes("|")
						? section.text
						: section.text.split("\n\n").slice(0, 2).join("\n\n");
				lines.push(
					...new Markdown(text, 0, 0, getMarkdownTheme(), undefined, {
						tablePreviewRows: this.expanded || this.complete ? undefined : 3,
					}).render(width),
				);
				if (text !== section.text) lines.push(...wrapped(theme.fg("dim", "more content in expanded view")));
			}
		}
		return lines;
	}
}
