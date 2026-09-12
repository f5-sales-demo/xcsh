import { beforeAll, describe, expect, it, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../src/locales/index";
import { PluginDashboard } from "../src/modes/components/plugins/plugin-dashboard";
import type {
	DashboardPlugin,
	PluginDashboardOperations,
	PluginDashboardState,
} from "../src/modes/components/plugins/types";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => {
	registerLocales(locales);
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	await setSymbolPreset("unicode");
});

function plugin(overrides: Partial<DashboardPlugin> & { id: string; name: string }): DashboardPlugin {
	return {
		source: "marketplace",
		marketplace: "catalog",
		installed: false,
		enabled: false,
		hasUpdate: false,
		...overrides,
	};
}

function state(items: DashboardPlugin[], activeTab: "installed" | "recommended" | "discover" | "updates" = "discover") {
	const tabs = [
		{ id: "installed" as const, label: "Installed", count: items.filter(item => item.installed).length },
		{
			id: "recommended" as const,
			label: "Recommended",
			count: items.filter(item => item.recommended && !item.installed).length,
		},
		{ id: "discover" as const, label: "Discover", count: items.filter(item => !item.installed).length },
		{ id: "updates" as const, label: "Updates", count: items.filter(item => item.hasUpdate).length },
	];
	const activeTabIndex = tabs.findIndex(tab => tab.id === activeTab);
	const visible = items.filter(item => {
		if (activeTab === "installed") return item.installed;
		if (activeTab === "recommended") return item.recommended && !item.installed;
		if (activeTab === "updates") return item.hasUpdate;
		return !item.installed;
	});
	return {
		tabs,
		activeTabIndex,
		allPlugins: items,
		tabFiltered: visible,
		searchFiltered: visible,
		searchQuery: "",
		selectedIndex: 0,
		scrollOffset: 0,
		notice: null,
		loading: false,
		loadError: null,
	} satisfies PluginDashboardState;
}

function create(
	items: DashboardPlugin[],
	activeTab: "installed" | "recommended" | "discover" | "updates" = "discover",
	operations: Partial<PluginDashboardOperations> = {},
	rows = 24,
) {
	return PluginDashboard.createForTest(state(items, activeTab), { rows: () => rows, operations });
}

function text(dashboard: PluginDashboard, columns = 100): string {
	return Bun.stripANSI(dashboard.render(columns).join("\n"));
}

describe("PluginDashboard interaction contract", () => {
	it("uses Escape for back and only advertises paging when details overflow", () => {
		let rows = 40;
		const dashboard = PluginDashboard.createForTest(
			state([plugin({ id: "alpha@catalog", name: "alpha", description: "Long description. ".repeat(100) })]),
			{ rows: () => rows },
		);
		const close = vi.fn();
		dashboard.onClose = close;
		dashboard.handleInput("\r");
		expect(text(dashboard)).not.toContain("PgUp/PgDn");
		expect(text(dashboard)).not.toContain("Enter:");
		expect(text(dashboard)).not.toContain("Up/Down:");
		dashboard.handleInput("\x03");
		expect(text(dashboard)).toContain("Plugin details");
		expect(close).not.toHaveBeenCalled();
		rows = 20;
		expect(text(dashboard, 60)).toContain("PgUp/PgDn: more details");
		dashboard.handleInput("\x1b");
		expect(text(dashboard)).toContain("Plugin manager");
		dashboard.handleInput("\x03");
		expect(close).not.toHaveBeenCalled();
		dashboard.handleInput("\x1b");
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("uses the shared input for spaces, Unicode, paste, and normal editing", () => {
		const dashboard = create([
			plugin({ id: "cloud-tools@catalog", name: "cloud-tools", displayName: "Cloud 工具 suite" }),
		]);
		dashboard.handleInput("cloud ");
		dashboard.handleInput("\x1b[200~工具\x1b[201~");
		expect(text(dashboard)).toContain("cloud 工具");
		dashboard.handleInput("\x1b[D");
		dashboard.handleInput("\x7f");
		expect(text(dashboard)).toContain("cloud 具");
	});

	it("opens details on Enter without immediately mutating the plugin", () => {
		const install = vi.fn(async () => {});
		const dashboard = create([plugin({ id: "alpha@catalog", name: "alpha" })], "discover", { install });
		dashboard.handleInput("\r");
		expect(install).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("Plugin details");
		expect(text(dashboard)).toContain("Review installation");
	});

	it("starts destructive removal confirmation on Cancel", () => {
		const remove = vi.fn(async () => {});
		const dashboard = create(
			[plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "project" })],
			"installed",
			{ remove },
		);
		dashboard.handleInput("\r");
		for (let i = 0; i < 2; i++) dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("Remove alpha?");
		expect(text(dashboard)).toContain("Cancel removal");
		dashboard.handleInput("\r");
		expect(remove).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("Plugin details");
	});

	it("offers only persistent state actions and invokes the matching manager operation", async () => {
		const setEnabled = vi.fn(async () => {});
		const dashboard = create(
			[plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "user" })],
			"installed",
			{ setEnabled },
		);
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("Disable plugin");
		dashboard.handleInput("\r");
		expect(setEnabled).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("Enabled → Disabled");
		dashboard.handleInput("\r"); // Initially selected Cancel returns to details.
		expect(setEnabled).not.toHaveBeenCalled();
		dashboard.handleInput("\r");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(setEnabled).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha@catalog", scope: "user" }), false);
	});

	it("rejects an enabled-state review when the installed version changes before confirmation", async () => {
		const item = plugin({
			id: "alpha@catalog",
			name: "alpha",
			installed: true,
			enabled: true,
			scope: "user",
			version: "1.0",
		});
		const setEnabled = vi.fn(async () => {});
		const dashboard = create([item], "installed", { setEnabled, load: async () => [{ ...item, version: "2.0" }] });
		dashboard.handleInput("\r");
		dashboard.handleInput("\r");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(setEnabled).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("changed");
		expect(text(dashboard)).toContain("Plugin details");
	});

	it("revalidates installation, update, and removal reviews before mutation", async () => {
		const available = plugin({ id: "alpha@catalog", name: "alpha", catalogVersion: "1.0.0" });
		const install = vi.fn(async () => {});
		const installer = create([available], "discover", {
			install,
			load: async () => [{ ...available, catalogVersion: "2.0.0" }],
		});
		installer.handleInput("\r");
		installer.handleInput("\r");
		installer.handleInput("\x1b[B");
		installer.handleInput("\r");
		await Bun.sleep(0);
		expect(install).not.toHaveBeenCalled();
		expect(text(installer)).toContain("changed");

		const installed = plugin({
			id: "alpha@catalog",
			name: "alpha",
			installed: true,
			enabled: true,
			scope: "user",
			version: "1.0.0",
			hasUpdate: true,
			updateVersion: "2.0.0",
		});
		const upgrade = vi.fn(async () => {});
		const updater = create([installed], "updates", {
			upgrade,
			load: async () => [{ ...installed, updateVersion: "3.0.0" }],
		});
		updater.handleInput("\r");
		updater.handleInput("\x1b[B");
		updater.handleInput("\x1b[B");
		updater.handleInput("\r");
		updater.handleInput("\x1b[B");
		updater.handleInput("\r");
		await Bun.sleep(0);
		expect(upgrade).not.toHaveBeenCalled();
		expect(text(updater)).toContain("changed");

		const remove = vi.fn(async () => {});
		const remover = create([installed], "installed", {
			remove,
			load: async () => [{ ...installed, version: "1.1.0" }],
		});
		remover.handleInput("\r");
		remover.handleInput("\x1b[B");
		remover.handleInput("\x1b[B");
		remover.handleInput("\x1b[B");
		remover.handleInput("\r");
		remover.handleInput("\x1b[B");
		remover.handleInput("\r");
		await Bun.sleep(0);
		expect(remove).not.toHaveBeenCalled();
		expect(text(remover)).toContain("changed");
	});

	it("revalidates recommended bulk targets and hides unavailable project scope", async () => {
		const recommended = plugin({ id: "alpha@catalog", name: "alpha", recommended: true, catalogVersion: "1.0.0" });
		const installRecommended = vi.fn(async () => ({
			installed: 1,
			failed: 0,
			total: 1,
			authenticationNeeded: [],
		}));
		const dashboard = PluginDashboard.createForTest(state([recommended], "recommended"), {
			projectScopeAvailable: false,
			operations: {
				installRecommended,
				load: async () => [{ ...recommended, catalogVersion: "2.0.0" }],
			},
		});
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(installRecommended).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("changed");

		const installer = PluginDashboard.createForTest(state([recommended], "discover"), {
			projectScopeAvailable: false,
		});
		installer.handleInput("\r");
		installer.handleInput("\r");
		expect(text(installer)).toContain("Project scope is unavailable");
		expect(text(installer)).not.toContain("Install in project scope");
	});

	it("retains a source, identifier, and scope-qualified selection through refresh", async () => {
		const user = plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "user" });
		const project = plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "project" });
		const dashboard = create([user, project], "installed", {
			refresh: async () => [plugin({ ...project, version: "2.0.0" }), plugin({ ...user, version: "2.0.0" })],
		});
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\x12");
		await Bun.sleep(0);
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("Scope: project");
	});

	it("retains the selected scoped installation while the terminal resizes", () => {
		const user = plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "user" });
		const project = plugin({ id: "alpha@catalog", name: "alpha", installed: true, enabled: true, scope: "project" });
		const dashboard = create([user, project], "installed");
		dashboard.handleInput("\x1b[B");
		expect(text(dashboard, 60)).toContain("project scope");
		expect(text(dashboard, 140)).toContain("project");
		dashboard.handleInput("\r");
		expect(text(dashboard, 80)).toContain("Scope: project");
	});

	it("keeps navigation and Retry visible after refresh failure", async () => {
		const dashboard = create([plugin({ id: "alpha@catalog", name: "alpha" })], "discover", {
			refresh: async () => {
				throw new Error("catalog unavailable");
			},
		});
		dashboard.handleInput("\x12");
		await Bun.sleep(0);
		const rendered = text(dashboard);
		expect(rendered).toContain("catalog unavailable");
		expect(rendered).toContain("Ctrl+R: retry");
		expect(rendered).toContain("Installed (0)");
	});

	it("prevents a duplicate operation while the first one is pending", async () => {
		let finish!: () => void;
		const install = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
		const dashboard = create([plugin({ id: "alpha@catalog", name: "alpha" })], "discover", { install });
		const close = vi.fn();
		dashboard.onClose = close;
		dashboard.handleInput("\r");
		dashboard.handleInput("\r");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(install).toHaveBeenCalledTimes(1);
		expect(text(dashboard)).toContain("Installation in progress");
		dashboard.handleInput("\x03");
		expect(close).not.toHaveBeenCalled();
		expect(text(dashboard)).toContain("Installation in progress");
		finish();
		await Bun.sleep(0);
	});

	it("ignores stale refresh completions", async () => {
		let finishFirst!: (items: DashboardPlugin[]) => void;
		let finishSecond!: (items: DashboardPlugin[]) => void;
		let calls = 0;
		const dashboard = create([plugin({ id: "alpha@catalog", name: "alpha", displayName: "Initial" })], "discover", {
			refresh: () =>
				new Promise(resolve => {
					calls++;
					if (calls === 1) finishFirst = resolve;
					else finishSecond = resolve;
				}),
		});
		dashboard.handleInput("\x12");
		dashboard.handleInput("\x12");
		finishSecond([plugin({ id: "alpha@catalog", name: "alpha", displayName: "Newest" })]);
		await Bun.sleep(0);
		finishFirst([plugin({ id: "alpha@catalog", name: "alpha", displayName: "Stale" })]);
		await Bun.sleep(0);
		expect(text(dashboard)).toContain("Newest");
		expect(text(dashboard)).not.toContain("Stale");
	});

	it("keeps a failed update review available for retry and retains the updated target", async () => {
		const item = plugin({
			id: "alpha@catalog",
			name: "alpha",
			installed: true,
			enabled: false,
			scope: "user",
			version: "1.0.0",
			hasUpdate: true,
			updateVersion: "2.0.0",
		});
		let attempts = 0;
		const dashboard = create([item], "updates", {
			upgrade: async () => {
				if (++attempts === 1) throw new Error("offline");
				Object.assign(item, { version: "2.0.0", hasUpdate: false, updateVersion: undefined });
			},
			load: async () => [item],
		});
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("Status: Disabled");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		expect(attempts).toBe(0);
		expect(text(dashboard)).toContain("Installed version: 1.0.0 → 2.0.0");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(text(dashboard)).toContain("Review update");
		expect(text(dashboard)).toContain("offline");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		expect(attempts).toBe(2);
		expect(text(dashboard)).toContain("Shown in Installed");
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("Installed version: 2.0.0");
		expect(text(dashboard)).not.toContain("Upgrade plugin");
	});

	it("reports prerequisite and partial bulk-operation outcomes", async () => {
		const dashboard = create(
			[
				plugin({
					id: "alpha@catalog",
					name: "alpha",
					recommended: true,
					prerequisites: [
						{ tool: "examplectl", installCmd: "install examplectl", detectCmd: "examplectl version" },
					],
				}),
				plugin({ id: "beta@catalog", name: "beta", recommended: true }),
			],
			"recommended",
			{
				installRecommended: async () => ({
					installed: 1,
					failed: 1,
					total: 2,
					authenticationNeeded: ["examplectl: examplectl login"],
				}),
			},
		);
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		expect(text(dashboard)).toContain("examplectl (install examplectl)");
		dashboard.handleInput("\x1b[B");
		dashboard.handleInput("\r");
		await Bun.sleep(0);
		const rendered = text(dashboard);
		expect(rendered).toContain("Installed 1 of 2 recommended plugins");
		expect(rendered).toContain("1 failed");
		expect(rendered).toContain("Authentication still needed");
	});

	it("keeps long detail metadata reachable at narrow widths", () => {
		const dashboard = create(
			[
				plugin({
					id: "long-name@catalog",
					name: "long-name",
					version: "1.0.0",
					catalogVersion: "2.0.0",
					description: "A long description that belongs in scrollable details.",
					author: "Example Maintainers",
				}),
			],
			"discover",
			{},
			20,
		);
		dashboard.handleInput("\r");
		expect(text(dashboard, 60)).toContain("Review installation");
		dashboard.handleInput("\x1b[6~");
		dashboard.handleInput("\x1b[6~");
		expect(text(dashboard, 60)).toContain("Description:");
	});

	it("renders bounded equal-width rows with visible controls across the required matrix", async () => {
		for (const themeName of ["xcsh-dark", "xcsh-light"])
			for (const symbols of ["unicode", "ascii"] as const)
				for (const [columns, rows] of [
					[60, 20],
					[80, 24],
					[100, 32],
					[140, 40],
				]) {
					setThemeInstance((await getThemeByName(themeName))!);
					await setSymbolPreset(symbols);
					const dashboard = create(
						[
							plugin({ id: "long@catalog", name: "a-very-long-plugin-name", recommended: true }),
							plugin({
								id: "installed@catalog",
								name: "installed",
								installed: true,
								enabled: false,
								scope: "project",
							}),
						],
						"discover",
						{},
						rows,
					);
					for (const screen of ["browse", "details", "installation"] as const) {
						const lines = dashboard.render(columns);
						expect(lines.length).toBeLessThanOrEqual(rows);
						expect(lines.every(line => visibleWidth(line) === Math.min(columns, 100))).toBe(true);
						const rendered = Bun.stripANSI(lines.join("\n"));
						if (screen === "browse") expect(rendered).toContain("Ctrl+R: refresh");
						else if (screen === "details") expect(rendered).toContain("Review installation");
						else expect(rendered).toContain("Cancel installation");
						dashboard.handleInput("\r");
					}
				}
	});
});
