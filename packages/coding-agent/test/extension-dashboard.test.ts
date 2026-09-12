import { beforeAll, expect, test, vi } from "bun:test";
import { Settings } from "../src/config/settings";
import {
	ExtensionDashboard,
	type ExtensionDashboardDependencies,
} from "../src/modes/components/extensions/extension-dashboard";
import { type Extension, makeQualifiedExtensionId } from "../src/modes/components/extensions/types";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function item(name: string, provider: string, path = `/fixture/${provider}/${name}`): Extension {
	return {
		id: `skill:${name}`,
		kind: "skill",
		name,
		displayName: name,
		description: `Synthetic ${name} capability`,
		path,
		source: { provider, providerName: provider.toUpperCase(), level: "project" },
		state: "active",
		raw: { revision: 1 },
	};
}

function dependencies(load: ExtensionDashboardDependencies["loadExtensions"]): ExtensionDashboardDependencies {
	let disabledProviders: string[] = [];
	return {
		loadExtensions: load,
		providers: () => [
			{ id: "first", displayName: "First", enabled: !disabledProviders.includes("first") },
			{ id: "second", displayName: "Second", enabled: !disabledProviders.includes("second") },
		],
		getDisabledProviders: () => [...disabledProviders],
		setDisabledProviders: ids => {
			disabledProviders = [...ids];
		},
	};
}

test("extension rows inspect before a Cancel-first scope-qualified persistent change", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const flush = vi.spyOn(store, "flush");
	const first = item("duplicate", "first");
	const second = item("duplicate", "second");
	const dashboard = await ExtensionDashboard.create(
		"/fixture",
		store,
		24,
		dependencies(async (_cwd, disabled) =>
			[first, second].map(extension => ({
				...extension,
				state: disabled.includes(
					makeQualifiedExtensionId(extension.kind, extension.name, extension.source, extension.path),
				)
					? "disabled"
					: "active",
				disabledReason: undefined,
			})),
		),
	);
	const initial = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(initial).toContain("first/project");
	expect(initial).toContain("second/project");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Extension details");
	expect(set).not.toHaveBeenCalled();
	dashboard.handleInput("\r");
	const review = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(review).toContain("Review disable extension");
	expect(review).toContain('Target: extension:["skill","duplicate","first","project","/fixture/first/duplicate"]');
	expect(set).not.toHaveBeenCalled();
	dashboard.handleInput("\r");
	expect(set).not.toHaveBeenCalled();
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Extension details");
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	for (let i = 0; i < 100 && !flush.mock.calls.length; i++) await Bun.sleep(1);
	const saved = store.get("disabledExtensions");
	expect(saved).toEqual([makeQualifiedExtensionId(first.kind, first.name, first.source, first.path)]);
	expect(saved).not.toContain(second.id);
});

test("tabs retain independent editable searches and Ctrl+C never acts as Back", async () => {
	const dashboard = await ExtensionDashboard.create(
		"/fixture",
		Settings.isolated(),
		24,
		dependencies(async () => [item("alpha", "first"), item("beta", "second")]),
	);
	dashboard.handleInput("\t");
	dashboard.handleInput("alpha");
	dashboard.handleInput("\t");
	dashboard.handleInput("beta");
	dashboard.handleInput("\x1b[Z");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Search: > alpha");
	dashboard.handleInput("\x03");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Extension control center");
	dashboard.handleInput("\x1b");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).not.toContain("Search: > alpha");
});

test("changed source metadata renews review without writing", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const target = item("alpha", "first");
	let changed = false;
	const dashboard = await ExtensionDashboard.create(
		"/fixture",
		store,
		24,
		dependencies(async () => [{ ...target, raw: { revision: changed ? 2 : 1 } }]),
	);
	dashboard.handleInput("\r");
	dashboard.handleInput("\r");
	changed = true;
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	for (let i = 0; i < 100 && !Bun.stripANSI(dashboard.render(100).join("\n")).includes("proposal changed"); i++)
		await Bun.sleep(1);
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("proposal changed");
	expect(set).not.toHaveBeenCalled();
});

test("manual refresh keeps cached state, ignores stale completion, and reports failure", async () => {
	const pending: Array<PromiseWithResolvers<Extension[]>> = [];
	let initial = true;
	const deps = dependencies(async () => {
		if (initial) {
			initial = false;
			return [item("initial", "first")];
		}
		const resolver = Promise.withResolvers<Extension[]>();
		pending.push(resolver);
		return resolver.promise;
	});
	const dashboard = await ExtensionDashboard.create("/fixture", Settings.isolated(), 24, deps);
	dashboard.handleInput("\x12");
	dashboard.handleInput("\x12");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("initial");
	pending[1]!.resolve([item("newest", "second")]);
	await Bun.sleep(0);
	pending[0]!.resolve([item("stale", "first")]);
	await Bun.sleep(0);
	const refreshed = Bun.stripANSI(dashboard.render(80).join("\n"));
	expect(refreshed).toContain("newest");
	expect(refreshed).not.toContain("stale");
	dashboard.handleInput("\x12");
	pending[2]!.reject(new Error("fixture offline"));
	await Bun.sleep(0);
	const failed = Bun.stripANSI(dashboard.render(80).join("\n"));
	expect(failed).toContain("newest");
	expect(failed).toContain("Refresh failed: fixture offline");
});

test("mouse wheel selects and a second row click opens details without mutation", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const dashboard = await ExtensionDashboard.create(
		"/fixture",
		store,
		24,
		dependencies(async () => [item("alpha", "first"), item("beta", "first")]),
	);
	dashboard.routeMouse({ wheel: 1, leftClick: false, release: false } as never, 0);
	const lines = dashboard.render(80).map(Bun.stripANSI);
	const row = lines.findIndex(line => line.includes("beta") && line.includes("skill"));
	expect(row).toBeGreaterThan(0);
	const click = { wheel: null, leftClick: true, release: false } as never;
	dashboard.routeMouse(click, row);
	dashboard.routeMouse(click, row);
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Extension details");
	expect(set).not.toHaveBeenCalled();
});

test("provider state is reached through a named detail action and reviewed before save", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const dashboard = await ExtensionDashboard.create(
		"/fixture",
		store,
		24,
		dependencies(async () => [item("alpha", "first")]),
	);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Provider details");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Target: provider:first");
	expect(set).not.toHaveBeenCalled();
});

test("confirmed provider state flushes once before applying runtime discovery state", async () => {
	const store = Settings.isolated();
	const flush = vi.spyOn(store, "flush");
	let disabledProviders: string[] = [];
	const deps: ExtensionDashboardDependencies = {
		loadExtensions: async () => [item("alpha", "first")],
		providers: () => [{ id: "first", displayName: "First", enabled: !disabledProviders.includes("first") }],
		getDisabledProviders: () => [...disabledProviders],
		setDisabledProviders: ids => {
			disabledProviders = [...ids];
		},
	};
	const dashboard = await ExtensionDashboard.create("/fixture", store, 24, deps);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	for (let attempt = 0; attempt < 100 && disabledProviders.length === 0; attempt++) await Bun.sleep(1);
	expect(disabledProviders).toEqual(["first"]);
	expect(store.get("disabledProviders")).toEqual(["first"]);
	expect(flush).toHaveBeenCalledTimes(1);
});
