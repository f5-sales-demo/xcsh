import type { PluginSection, PluginView } from "@f5-sales-demo/pi-agent-core";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { type Component, Markdown, renderTable, visibleWidth, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { renderStructuredRow } from "../../tui/tree-list";
import { getMarkdownTheme, getSymbolTheme, theme } from "../theme/theme";

export interface PresentationResult {
	content: readonly { type: string; text?: string }[];
	details?: unknown;
	isError?: boolean;
}

function valueText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Flatten records into labeled sections without depth, scalar or row truncation. */
export function dataSections(data: unknown, title?: string): PluginSection[] {
	if (Array.isArray(data) && data.every(item => item !== null && typeof item === "object" && !Array.isArray(item))) {
		const keys = [...new Set(data.flatMap(item => Object.keys(item)))];
		if (keys.length) return [{ kind: "table", title, columns: keys.map(key => ({ key })), rows: data }];
	}
	if (data !== null && typeof data === "object" && !Array.isArray(data)) {
		const fields: Record<string, unknown> = {};
		const children: PluginSection[] = [];
		for (const [key, value] of Object.entries(data)) {
			if (value !== null && typeof value === "object")
				children.push(...dataSections(value, title ? `${title}.${key}` : key));
			else fields[key] = value;
		}
		return [...(Object.keys(fields).length ? [{ kind: "fields" as const, title, values: fields }] : []), ...children];
	}
	return [{ kind: "code", title, text: valueText(data) }];
}

export function fallbackResultView(result: PresentationResult): PluginView {
	const sections = result.content
		.filter(block => block.type === "text" && block.text !== undefined)
		.flatMap(block => {
			try {
				return dataSections(JSON.parse(block.text!));
			} catch {
				return [{ kind: "markdown" as const, text: block.text! }];
			}
		});
	if (sections.length === 0) sections.push({ kind: "markdown", text: "(no output)" });
	return { sections };
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
		private view: () => PluginView | undefined,
		private expanded: boolean,
		private complete = false,
		private fallback?: Component,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const view = this.view();
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
					this.expanded || this.complete
						? entries
						: entries.filter(
								([key], index) =>
									index < 6 || /total|count|scope|warning|incomplete|done|hasMore|partial/i.test(key),
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
				const rows = this.expanded || this.complete ? section.rows : section.rows.slice(0, 3);
				lines.push(
					...renderTable(
						section.columns.map(c => c.label ?? c.key),
						rows.map(row => section.columns.map(c => valueText(row[c.key]))),
						width,
						{ symbols: getSymbolTheme().table, bold: text => theme.bold(text) },
						section.columns.map(c => c.align ?? null),
					),
				);
				if (rows.length < section.rows.length)
					lines.push(...wrapped(theme.fg("dim", `${section.rows.length - rows.length} more rows`)));
				if (!section.rows.length) lines.push(...wrapped(theme.fg("dim", "0 rows")));
			} else if (section.kind === "code") {
				lines.push(...wrapped(theme.fg("toolOutput", section.text)));
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
