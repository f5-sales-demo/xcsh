#!/usr/bin/env bun
/** Sanitized fixture captures. No credentials or live provider calls. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { providerSelectorFixture } from "../test/helpers/provider-selector-fixture";

const root = resolve(process.argv[2] ?? new URL("../../..", import.meta.url).pathname);
const output = resolve(process.argv[3] ?? "/tmp/xcsh-selector-evidence");
const load = (path: string) => import(pathToFileURL(`${root}/packages/coding-agent/src/${path}`).href);
const { ModelSelectorComponent } = await load("modes/components/model-selector.ts");
const { OAuthSelectorComponent } = await load("modes/components/oauth-selector.ts");
const { getLoginOptions } = await load("modes/controllers/login-options.ts");
const { getThemeByName, setThemeInstance, setSymbolPreset } = await load("modes/theme/theme.ts");
await mkdir(output, { recursive: true });
for (const themeName of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"])
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			setThemeInstance(await getThemeByName(themeName));
			await setSymbolPreset(symbols);
			const fixture = providerSelectorFixture();
			const ui = { terminal: { rows, columns }, requestRender() {} } as unknown as TUI;
			const model = new ModelSelectorComponent(
				ui,
				fixture.active,
				fixture.settings,
				fixture.registry,
				[],
				() => {},
				() => {},
			);
			const provider = new OAuthSelectorComponent(
				"login",
				{ hasAuth: () => false },
				() => {},
				() => {},
				{
					rows: () => rows,
					providers: [
						{
							id: "__add-provider__",
							name: "Add provider…",
							action: "add-provider",
							kind: "local",
							available: true,
						},
					],
					catalogProviders: getLoginOptions(),
				},
			);
			await Bun.sleep(0);
			const captures: Record<string, string[]> = {
				models: model.render(columns),
				providers: provider.render(columns),
			};
			model.handleInput("\r");
			captures.scope = model.render(columns);
			model.handleInput("\r");
			captures.reasoning = model.render(columns);
			for (const [screen, lines] of Object.entries(captures)) {
				const name = `${screen}-${columns}x${rows}-${themeName}-${symbols}`;
				await Bun.write(`${output}/${name}.ansi`, lines.join("\n"));
				await Bun.write(`${output}/${name}.txt`, lines.map(line => Bun.stripANSI(line).trimEnd()).join("\n"));
			}
			model.dispose();
			provider.stopValidation();
		}
console.log("Captured fixture screens for all 16 terminal combinations.");
