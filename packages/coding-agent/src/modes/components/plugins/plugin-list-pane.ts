import type { Component } from "@f5xc-salesdemos/pi-tui";
import { truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { theme } from "../../theme/theme";
import type { DashboardPlugin, PluginTabId } from "./types";

export class PluginListPane implements Component {
	constructor(
		private readonly plugins: DashboardPlugin[],
		private readonly selectedIndex: number,
		private readonly scrollOffset: number,
		private readonly searchQuery: string,
		private readonly maxVisible: number,
		private readonly activeTab: PluginTabId,
	) {}

	render(width: number): string[] {
		const lines: string[] = [];
		const searchPrefix = theme.fg("muted", "Search: ");
		const searchText = this.searchQuery || theme.fg("dim", "type to filter");
		lines.push(`${searchPrefix}${searchText}`);
		lines.push("");

		if (this.plugins.length === 0) {
			const msg =
				this.activeTab === "discover"
					? "No plugins available. Add a marketplace first."
					: this.activeTab === "updates"
						? "All plugins are up to date."
						: "No plugins installed.";
			lines.push(theme.fg("muted", `  ${msg}`));
			return lines;
		}

		const start = this.scrollOffset;
		const end = Math.min(start + this.maxVisible, this.plugins.length);

		for (let i = start; i < end; i++) {
			const plugin = this.plugins[i];
			const selected = i === this.selectedIndex;
			let line = this.#formatPluginLine(plugin);

			if (selected) {
				line = theme.bg("selectedBg", theme.bold(theme.fg("chromeAccent", line)));
			} else if (!plugin.enabled && plugin.installed) {
				line = theme.fg("dim", line);
			}

			lines.push(truncateToWidth(line, width));
		}

		if (this.plugins.length > this.maxVisible) {
			lines.push(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.plugins.length})`));
		}

		return lines;
	}

	#formatPluginLine(plugin: DashboardPlugin): string {
		const parts: string[] = [" "];

		if (plugin.installed) {
			if (plugin.hasUpdate) {
				parts.push(theme.fg("warning", "▲"));
			} else if (plugin.enabled) {
				parts.push(theme.fg("success", theme.status.enabled));
			} else {
				parts.push(theme.fg("dim", theme.status.disabled));
			}
		} else {
			parts.push(theme.fg("dim", "·"));
		}

		parts.push(" ");
		parts.push(plugin.displayName || plugin.name);

		if (plugin.version) {
			parts.push(theme.fg("dim", ` v${plugin.version}`));
		}

		if (plugin.hasUpdate && plugin.updateVersion) {
			parts.push(theme.fg("warning", ` → v${plugin.updateVersion}`));
		}

		if (plugin.scope) {
			parts.push(theme.fg("muted", ` [${plugin.scope}]`));
		}

		if (plugin.shadowedBy) {
			parts.push(theme.fg("dim", " [shadowed]"));
		}

		if (plugin.installed && !plugin.enabled) {
			parts.push(theme.fg("dim", " (disabled)"));
		}

		if (plugin.source === "npm") {
			parts.push(theme.fg("dim", " (npm)"));
		}

		return parts.join("");
	}

	invalidate(): void {}
}
