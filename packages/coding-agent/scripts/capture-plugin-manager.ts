#!/usr/bin/env bun
/** Sanitized plugin-manager fixture captures. No live marketplaces, plugins, or configuration. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { padding, truncateToWidth, visibleWidth } from "@f5-sales-demo/pi-tui";

const sourceRoot = resolve(process.argv[2] ?? new URL("../../..", import.meta.url).pathname);
const outputRoot = resolve(process.argv[3] ?? "/tmp/xcsh-plugin-manager-evidence");
const stage = process.argv[4] === "before" ? "before" : "after";
const representativeRoot = process.argv[5] ? resolve(process.argv[5]) : undefined;
const load = (path: string) =>
	import(pathToFileURL(`${sourceRoot}/packages/coding-agent/src/${path}`).href) as Promise<Record<string, any>>;

const { registerLocales } = await import("@f5-sales-demo/pi-utils");
const { locales } = await load("locales/index.ts");
const themeModule = await load("modes/theme/theme.ts");
const { getThemeByName, setThemeInstance, setSymbolPreset } = themeModule;
registerLocales(locales);

const fixturePlugins = [
	{
		id: "source-control@test-marketplace",
		name: "source-control",
		displayName: "Source control",
		marketplace: "test-marketplace",
		source: "marketplace",
		version: "2.4.0",
		catalogVersion: "2.4.0",
		description: "Review pull requests and repository state from an explicit project-scoped installation.",
		installed: true,
		enabled: true,
		scope: "project",
		hasUpdate: false,
	},
	{
		id: "source-control@test-marketplace",
		name: "source-control",
		displayName: "Source control",
		marketplace: "test-marketplace",
		source: "marketplace",
		version: "2.3.0",
		catalogVersion: "2.4.0",
		description: "A user-scoped copy retained beneath the project installation.",
		installed: true,
		enabled: false,
		scope: "user",
		shadowedBy: "project",
		hasUpdate: true,
		updateVersion: "2.4.0",
	},
	{
		id: "cloud-observability-toolkit-with-a-long-name@test-marketplace",
		name: "cloud-observability-toolkit-with-a-long-name",
		displayName: "Cloud observability toolkit with a long name",
		marketplace: "test-marketplace",
		source: "marketplace",
		version: "1.8.0",
		catalogVersion: "1.8.0",
		description:
			"Inspect synthetic service telemetry. This deliberately long description verifies wrapped and scrollable details.",
		category: "Operations",
		tags: ["metrics", "traces", "synthetic"],
		author: "Example Maintainers",
		license: "Apache-2.0",
		homepage: "https://example.com/plugins/observability",
		installed: false,
		enabled: false,
		recommended: true,
		hasUpdate: false,
		prerequisites: [
			{
				tool: "examplectl",
				installCmd: "install examplectl",
				detectCmd: "examplectl version",
				authLoginCmd: "examplectl login",
			},
		],
	},
	{
		id: "diagram-tools@test-marketplace",
		name: "diagram-tools",
		displayName: "Diagram tools",
		marketplace: "test-marketplace",
		source: "marketplace",
		version: "1.2.0",
		description: "Render architecture diagrams from sanitized fixtures.",
		installed: false,
		enabled: false,
		recommended: true,
		hasUpdate: false,
	},
];

function state(activeTab: "installed" | "recommended" | "discover" | "updates") {
	const tabs = [
		{ id: "installed", label: "Installed", count: 2 },
		{ id: "recommended", label: "Recommended", count: 2 },
		{ id: "discover", label: "Discover", count: 2 },
		{ id: "updates", label: "Updates", count: 1 },
	];
	const activeTabIndex = tabs.findIndex(tab => tab.id === activeTab);
	const visible = fixturePlugins.filter(plugin => {
		if (activeTab === "installed") return plugin.installed;
		if (activeTab === "recommended") return plugin.recommended && !plugin.installed;
		if (activeTab === "updates") return plugin.hasUpdate;
		return !plugin.installed;
	});
	return {
		tabs,
		activeTabIndex,
		allPlugins: fixturePlugins,
		tabFiltered: visible,
		searchFiltered: visible,
		searchQuery: "",
		selectedIndex: 0,
		scrollOffset: 0,
		notice: null,
		loading: false,
		loadError: null,
	};
}

async function renderBefore(columns: number, rows: number): Promise<Record<string, string[]>> {
	const theme = themeModule.theme;
	const { PluginListPane } = await load("modes/components/plugins/plugin-list-pane.ts");
	const { PluginInspectorPane } = await load("modes/components/plugins/plugin-inspector-pane.ts");
	const current = state("discover");
	const leftWidth = Math.floor(columns * 0.5);
	const rightWidth = columns - leftWidth - 3;
	const left = new PluginListPane(current.searchFiltered, 0, 0, "", Math.max(5, rows - 14), "discover").render(
		leftWidth,
	);
	const right = new PluginInspectorPane(current.searchFiltered[0]).render(rightWidth);
	const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);
	const body = Array.from({ length: Math.min(rows - 8, Math.max(left.length, right.length)) }, (_, index) => {
		const leftLine = truncateToWidth(left[index] ?? "", leftWidth);
		const rightLine = truncateToWidth(right[index] ?? "", rightWidth);
		return `${leftLine}${padding(leftWidth - visibleWidth(leftLine))}${separator}${rightLine}`;
	});
	const border = theme.fg("border", theme.boxSharp.horizontal.repeat(columns));
	return {
		browse: [
			border,
			theme.bold(theme.fg("contentAccent", " xcsh Plugin Center")),
			"  Installed (2)   Recommended (2)   Discover (2)   Updates (1)",
			"",
			...body,
			"",
			theme.fg("dim", "Enter: install  A: install all  Tab: next tab  Ctrl+R: reload  Esc: close"),
			border,
		].slice(0, rows),
	};
}

async function renderAfter(columns: number, rows: number): Promise<Record<string, string[]>> {
	const { PluginDashboard } = await load("modes/components/plugins/plugin-dashboard.ts");
	const make = (tab: "installed" | "recommended" | "discover" | "updates", operations = {}) =>
		PluginDashboard.createForTest(structuredClone(state(tab)), { rows: () => rows, operations });
	const browse = make("discover");
	const screens: Record<string, string[]> = { browse: browse.render(columns) };
	browse.handleInput("\r");
	screens.details = browse.render(columns);
	browse.handleInput("\r");
	screens.installation = browse.render(columns);

	const installed = make("installed");
	installed.handleInput("\r");
	installed.handleInput("\x1b[B");
	installed.handleInput("\x1b[B");
	installed.handleInput("\r");
	screens.removal = installed.render(columns);
	const current = make("installed");
	current.handleInput("\r");
	screens.installed = current.render(columns);
	const update = make("updates");
	update.handleInput("\r");
	screens["update-details"] = update.render(columns);
	update.handleInput("\x1b[B");
	update.handleInput("\x1b[B");
	update.handleInput("\r");
	screens.update = update.render(columns);

	for (const operation of ["install", "upgrade", "remove"] as const) {
		for (const outcome of ["progress", "success", "failure"] as const) {
			const data = structuredClone(
				state(operation === "install" ? "discover" : operation === "upgrade" ? "updates" : "installed"),
			);
			const target = data.searchFiltered[0];
			const dashboard = PluginDashboard.createForTest(data, {
				rows: () => rows,
				operations: {
					load: async () => data.allPlugins,
					[operation]: async () => {
						if (outcome === "progress") await new Promise(() => {});
						if (outcome === "failure") throw new Error("Fixture storage is unavailable");
						if (operation === "install") Object.assign(target, { installed: true, enabled: true, scope: "user" });
						if (operation === "upgrade")
							Object.assign(target, {
								version: target.updateVersion,
								hasUpdate: false,
								updateVersion: undefined,
							});
						if (operation === "remove")
							Object.assign(target, { installed: false, enabled: false, scope: undefined });
					},
				},
			});
			dashboard.handleInput("\r");
			if (operation !== "install") {
				dashboard.handleInput("\x1b[B");
				dashboard.handleInput("\x1b[B");
			}
			dashboard.handleInput("\r");
			dashboard.handleInput("\x1b[B");
			dashboard.handleInput("\r");
			await Bun.sleep(0);
			screens[`${operation}-${outcome}`] = dashboard.render(columns);
		}
	}

	const bulk = make("recommended");
	bulk.handleInput("\x1b[B");
	bulk.handleInput("\x1b[B");
	bulk.handleInput("\r");
	screens.bulk = bulk.render(columns);

	const failure = make("discover", {
		refresh: async () => {
			throw new Error("test marketplace is offline");
		},
	});
	failure.handleInput("\x12");
	await Bun.sleep(0);
	screens.failure = failure.render(columns);
	return screens;
}

function xml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function ansiMarkup(value: string, defaultForeground: string): string {
	let foreground = defaultForeground;
	let background: string | undefined;
	let bold = false;
	let offset = 0;
	const chunks: string[] = [];
	const expression = /\x1b\[([0-9;]*)m/g;
	const emit = (text: string) => {
		if (!text) return;
		const attrs = [
			`foreground="${foreground}"`,
			...(background ? [`background="${background}"`] : []),
			...(bold ? ['weight="bold"'] : []),
		];
		chunks.push(`<span ${attrs.join(" ")}>${xml(text)}</span>`);
	};
	for (const match of value.matchAll(expression)) {
		emit(value.slice(offset, match.index));
		const codes = (match[1] || "0").split(";").map(Number);
		for (let index = 0; index < codes.length; index++) {
			const code = codes[index];
			if (code === 0) {
				foreground = defaultForeground;
				background = undefined;
				bold = false;
			} else if (code === 1) bold = true;
			else if (code === 22) bold = false;
			else if (code === 39) foreground = defaultForeground;
			else if (code === 49) background = undefined;
			else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
				const color = `#${codes
					.slice(index + 2, index + 5)
					.map(channel => channel.toString(16).padStart(2, "0"))
					.join("")}`;
				if (code === 38) foreground = color;
				else background = color;
				index += 4;
			}
		}
		offset = (match.index ?? 0) + match[0].length;
	}
	emit(value.slice(offset));
	return chunks.join("");
}

async function writeCapture(name: string, lines: string[], themeName: string): Promise<void> {
	const directory = `${outputRoot}/${stage}`;
	await mkdir(directory, { recursive: true });
	const ansi = lines.join("\n");
	const plain = lines.map(line => Bun.stripANSI(line).trimEnd()).join("\n");
	await Bun.write(`${directory}/${name}.ansi`, ansi);
	await Bun.write(`${directory}/${name}.txt`, plain);
	const dark = themeName === "xcsh-dark";
	const foreground = dark ? "#d8dee9" : "#2e3440";
	const background = dark ? "#1f2430" : "#f7f7f5";
	const markup = `<span font_family="DejaVu Sans Mono" font_size="12pt">${ansiMarkup(ansi, foreground)}</span>`;
	const markupPath = `${directory}/${name}.pango`;
	await Bun.write(markupPath, markup);
	const process = Bun.spawn(
		[
			"pango-view",
			"--no-display",
			"--markup",
			`--background=${background}`,
			"--margin=14",
			`--output=${directory}/${name}.png`,
			markupPath,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text());
}

for (const themeName of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"] as const)
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			setThemeInstance(await getThemeByName(themeName));
			await setSymbolPreset(symbols);
			const screens = stage === "before" ? await renderBefore(columns, rows) : await renderAfter(columns, rows);
			for (const [screen, lines] of Object.entries(screens)) {
				const name = `${screen}-${columns}x${rows}-${themeName}-${symbols}`;
				if (stage === "after") {
					if (lines.length > rows || lines.some(line => visibleWidth(line) !== Math.min(columns, 100)))
						throw new Error(`Invalid frame dimensions: ${name}`);
					const text = Bun.stripANSI(lines.join("\n"));
					if (!screen.endsWith("progress") && !text.includes("Esc: "))
						throw new Error(`Missing navigation: ${name}`);
					if (
						screen.endsWith("failure") &&
						screen !== "failure" &&
						!text.replace(/[│|]/g, "").replace(/\s+/g, " ").includes("Retry the action")
					)
						throw new Error(`Hidden recovery: ${name}`);
				}
				await writeCapture(name, lines, themeName);
				if (
					representativeRoot &&
					columns === 100 &&
					rows === 32 &&
					themeName === "xcsh-dark" &&
					symbols === "unicode"
				) {
					await mkdir(representativeRoot, { recursive: true });
					for (const extension of ["png", "txt"])
						await Bun.write(
							`${representativeRoot}/${stage}-${screen}.${extension}`,
							Bun.file(`${outputRoot}/${stage}/${name}.${extension}`),
						);
				}
			}
		}

console.log(`Captured ${stage} plugin-manager fixtures for all 16 terminal combinations in ${outputRoot}/${stage}.`);
