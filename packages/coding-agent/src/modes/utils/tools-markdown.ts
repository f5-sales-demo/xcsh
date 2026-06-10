import { t } from "@f5xc-salesdemos/pi-utils";
import type { Tool } from "../../tools";

export interface ToolsMarkdownBindings {
	tools: ReadonlyArray<Pick<Tool, "description" | "name">>;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/\|/g, "\\|")
		.replace(/\r?\n+/g, " ")
		.trim();
}

export function buildToolsMarkdown(bindings: ToolsMarkdownBindings): string {
	if (bindings.tools.length === 0) {
		return t("tools.emptyState");
	}

	return [
		`| ${t("tools.tableHeaderTool")} | ${t("tools.tableHeaderDescription")} |`,
		"|------|-------------|",
		...bindings.tools.map(tool => {
			const description = escapeTableCell(tool.description) || t("tools.noDescription");
			return `| \`${tool.name}\` | ${description} |`;
		}),
	].join("\n");
}
