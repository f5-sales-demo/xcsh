import type { Component } from "@f5xc-salesdemos/pi-tui";
import { replaceTabs, truncateToWidth, wrapTextWithAnsi } from "@f5xc-salesdemos/pi-tui";
import { theme } from "../../theme/theme";
import type { DashboardPlugin } from "./types";

export class PluginInspectorPane implements Component {
	constructor(private readonly plugin: DashboardPlugin | null) {}

	render(width: number): string[] {
		if (!this.plugin) {
			return [theme.fg("muted", "Select a plugin"), theme.fg("dim", "to view details")];
		}

		const lines: string[] = [];
		const p = this.plugin;

		lines.push(theme.bold(theme.fg("contentAccent", replaceTabs(p.name))));
		lines.push("");

		lines.push(`${theme.fg("muted", "Source:")} ${p.source}`);

		if (p.marketplace) {
			lines.push(`${theme.fg("muted", "Marketplace:")} ${replaceTabs(p.marketplace)}`);
		}

		if (p.installed) {
			const statusIcon = p.enabled
				? theme.fg("success", `${theme.status.enabled} Enabled`)
				: theme.fg("dim", `${theme.status.disabled} Disabled`);
			lines.push(`${theme.fg("muted", "Status:")} ${statusIcon}`);
		} else {
			lines.push(`${theme.fg("muted", "Status:")} ${theme.fg("dim", "Not installed")}`);
		}

		if (p.scope) {
			lines.push(`${theme.fg("muted", "Scope:")} ${p.scope}`);
		}

		if (p.version) {
			lines.push(`${theme.fg("muted", "Version:")} ${p.version}`);
		}

		if (p.hasUpdate && p.updateVersion) {
			lines.push(`${theme.fg("muted", "Update:")} ${theme.fg("warning", `v${p.updateVersion} available`)}`);
		}

		if (p.shadowedBy) {
			lines.push(`${theme.fg("muted", "Shadowed:")} ${theme.fg("warning", `by ${p.shadowedBy} scope`)}`);
		}

		if (p.description) {
			lines.push("");
			lines.push(theme.fg("muted", "Description:"));
			for (const wrapped of wrapTextWithAnsi(replaceTabs(p.description), Math.max(10, width - 2))) {
				lines.push(truncateToWidth(`  ${wrapped}`, width));
			}
		}

		if (p.author) {
			lines.push("");
			lines.push(`${theme.fg("muted", "Author:")} ${replaceTabs(p.author)}`);
		}

		if (p.license) {
			lines.push(`${theme.fg("muted", "License:")} ${replaceTabs(p.license)}`);
		}

		if (p.homepage) {
			lines.push(`${theme.fg("muted", "Homepage:")} ${replaceTabs(p.homepage)}`);
		}

		if (p.category) {
			lines.push(`${theme.fg("muted", "Category:")} ${replaceTabs(p.category)}`);
		}

		if (p.tags && p.tags.length > 0) {
			lines.push(`${theme.fg("muted", "Tags:")} ${p.tags.map(t => replaceTabs(t)).join(", ")}`);
		}

		return lines;
	}

	invalidate(): void {}
}
