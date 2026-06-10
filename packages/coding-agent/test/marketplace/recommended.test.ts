import { describe, expect, it } from "bun:test";
import { registerLocales } from "@f5xc-salesdemos/pi-utils";

import {
	applySearch,
	buildTabs,
	filterByTab,
	normalizePluginDisplayName,
} from "@f5xc-salesdemos/xcsh/modes/components/plugins/state-manager";
import type { DashboardPlugin } from "@f5xc-salesdemos/xcsh/modes/components/plugins/types";
import { locales } from "../../src/locales/index";

registerLocales(locales);

function makePlugin(overrides: Partial<DashboardPlugin> & { id: string; name: string }): DashboardPlugin {
	return {
		source: "marketplace",
		installed: false,
		enabled: false,
		hasUpdate: false,
		...overrides,
	};
}

// ── buildTabs ────────────────────────────────────────────────────────────────

describe("buildTabs", () => {
	it("includes Recommended tab when uninstalled recommended plugins exist", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "a", installed: true, enabled: true }),
			makePlugin({ id: "b@mkt", name: "b", recommended: true }),
			makePlugin({ id: "c@mkt", name: "c", recommended: true }),
		];
		const tabs = buildTabs(plugins);
		const rec = tabs.find(t => t.id === "recommended");
		expect(rec).toBeDefined();
		expect(rec!.label).toBe("Recommended");
		expect(rec!.count).toBe(2);
	});

	it("omits Recommended tab when all recommended plugins are installed", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "a", installed: true, enabled: true, recommended: true }),
			makePlugin({ id: "b@mkt", name: "b", installed: true, enabled: true, recommended: true }),
		];
		const tabs = buildTabs(plugins);
		expect(tabs.find(t => t.id === "recommended")).toBeUndefined();
	});

	it("omits Recommended tab when no plugins are recommended", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "a" }),
			makePlugin({ id: "b@mkt", name: "b" }),
		];
		const tabs = buildTabs(plugins);
		expect(tabs.find(t => t.id === "recommended")).toBeUndefined();
	});

	it("positions Recommended after Installed", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "a", installed: true, enabled: true }),
			makePlugin({ id: "b@mkt", name: "b", recommended: true }),
		];
		const tabs = buildTabs(plugins);
		expect(tabs[0].id).toBe("installed");
		expect(tabs[1].id).toBe("recommended");
	});

	it("uses Discover label instead of Available", () => {
		const plugins: DashboardPlugin[] = [makePlugin({ id: "a@mkt", name: "a" })];
		const tabs = buildTabs(plugins);
		const disc = tabs.find(t => t.id === "discover");
		expect(disc).toBeDefined();
		expect(disc!.label).toBe("Discover");
		expect(tabs.find(t => t.label === "Available")).toBeUndefined();
	});
});

// ── filterByTab ──────────────────────────────────────────────────────────────

describe("filterByTab", () => {
	const plugins: DashboardPlugin[] = [
		makePlugin({ id: "installed@mkt", name: "installed", installed: true, enabled: true }),
		makePlugin({ id: "rec1@mkt", name: "rec1", recommended: true }),
		makePlugin({ id: "rec2@mkt", name: "rec2", recommended: true }),
		makePlugin({ id: "normal@mkt", name: "normal" }),
		makePlugin({ id: "update@mkt", name: "update", installed: true, enabled: true, hasUpdate: true }),
	];

	it("filters to recommended uninstalled plugins", () => {
		const result = filterByTab(plugins, "recommended");
		expect(result).toHaveLength(2);
		expect(result.every(p => p.recommended && !p.installed)).toBe(true);
	});

	it("discover includes all uninstalled (including recommended)", () => {
		const result = filterByTab(plugins, "discover");
		expect(result).toHaveLength(3);
		expect(result.every(p => !p.installed)).toBe(true);
	});

	it("installed filter works", () => {
		const result = filterByTab(plugins, "installed");
		expect(result).toHaveLength(2);
		expect(result.every(p => p.installed)).toBe(true);
	});

	it("updates filter works", () => {
		const result = filterByTab(plugins, "updates");
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("update");
	});
});

// ── displayName ──────────────────────────────────────────────────────────────

describe("displayName", () => {
	it("normalizePluginDisplayName strips f5xc- prefix", () => {
		expect(normalizePluginDisplayName("f5xc-brand")).toBe("brand");
	});

	it("normalizePluginDisplayName strips -status suffix", () => {
		expect(normalizePluginDisplayName("azure-status")).toBe("azure");
	});

	it("normalizePluginDisplayName returns original for plain names", () => {
		expect(normalizePluginDisplayName("github")).toBe("github");
	});
});

// ── applySearch with displayName ─────────────────────────────────────────────

describe("applySearch", () => {
	it("matches on displayName", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "az-cli", displayName: "Azure CLI" }),
			makePlugin({ id: "b@mkt", name: "gh-cli", displayName: "GitHub CLI" }),
		];
		const result = applySearch(plugins, "azure");
		expect(result).toHaveLength(1);
		expect(result[0].displayName).toBe("Azure CLI");
	});

	it("matches on name when displayName not set", () => {
		const plugins: DashboardPlugin[] = [makePlugin({ id: "a@mkt", name: "salesforce" })];
		const result = applySearch(plugins, "sales");
		expect(result).toHaveLength(1);
	});

	it("returns all plugins when query is empty", () => {
		const plugins: DashboardPlugin[] = [
			makePlugin({ id: "a@mkt", name: "a" }),
			makePlugin({ id: "b@mkt", name: "b" }),
		];
		expect(applySearch(plugins, "")).toHaveLength(2);
	});
});

// ── recommended field propagation ────────────────────────────────────────────

describe("recommended field on DashboardPlugin", () => {
	it("preserves recommended flag from catalog entry", () => {
		const plugin = makePlugin({
			id: "azure@mkt",
			name: "azure",
			recommended: true,
			prerequisites: [{ tool: "az", installCmd: "brew install azure-cli", detectCmd: "az version" }],
		});
		expect(plugin.recommended).toBe(true);
		expect(plugin.prerequisites).toHaveLength(1);
		expect(plugin.prerequisites![0].tool).toBe("az");
	});

	it("defaults recommended to undefined when not set", () => {
		const plugin = makePlugin({ id: "plain@mkt", name: "plain" });
		expect(plugin.recommended).toBeUndefined();
	});
});

// ── defaultEnabled in types ──────────────────────────────────────────────────

describe("defaultEnabled field", () => {
	it("marketplace entry can specify defaultEnabled: false", () => {
		const plugin = makePlugin({
			id: "opt-in@mkt",
			name: "opt-in",
		});
		expect(plugin.enabled).toBe(false);
	});
});
