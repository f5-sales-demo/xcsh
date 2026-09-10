#!/usr/bin/env bun
/** Sanitized fixture captures. No credentials or live provider calls. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Container, Input, Text, type TUI } from "@f5-sales-demo/pi-tui";
import { providerSelectorFixture } from "../test/helpers/provider-selector-fixture";

const root = resolve(process.argv[2] ?? new URL("../../..", import.meta.url).pathname);
const output = resolve(process.argv[3] ?? "/tmp/xcsh-selector-evidence");
const load = (path: string) => import(pathToFileURL(`${root}/packages/coding-agent/src/${path}`).href);
const { ModelSelectorComponent } = await load("modes/components/model-selector.ts");
const { OAuthSelectorComponent } = await load("modes/components/oauth-selector.ts");
const { ConnectionChoiceComponent, ConnectionInputComponent } = await load("modes/components/selector-frame.ts");
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
			const management = new OAuthSelectorComponent(
				"login",
				{ hasAuth: () => true },
				() => {},
				() => {},
				{
					rows: () => rows,
					providers: [{ id: "openai-codex", name: "ChatGPT", kind: "oauth", available: true }],
					onChooseModel() {},
					getAccessState: (providerId: string) => ({
						provider: providerId,
						configured: true,
						credentialSource: "stored-oauth",
						status: "connected",
						catalogFreshness: "fresh",
						selectable: true,
					}),
				},
			);
			management.handleInput("\r");
			const connection = new ConnectionChoiceComponent(
				"Connection saved",
				"LiteLLM · Credentials saved; discovery unavailable",
				[
					{ label: "Retry connection", description: "Check this saved connection again." },
					{ label: "Browse models", description: "Choose from this provider's catalog." },
					{ label: "Done", description: "Keep the current model settings." },
				],
				() => {},
				() => {},
				() => rows,
			);
			const authInput = new Input();
			authInput.setMasked(true);
			authInput.setValue("synthetic-secret");
			const authContent = new Container();
			authContent.addChild(new Text("Open sign-in page on another device.", 0, 0));
			const authentication = new ConnectionInputComponent(
				"Sign in to ChatGPT",
				"Paste the redirect URL or authorization code",
				authInput,
				() => rows,
				authContent,
			);
			await Bun.sleep(0);
			const captures: Record<string, string[]> = {
				models: model.render(columns),
				providers: provider.render(columns),
				management: management.render(columns),
				connection: connection.render(columns),
				authentication: authentication.render(columns),
			};
			model.handleInput("\r");
			captures.scope = model.render(columns);
			model.handleInput("\r");
			captures.reasoning = model.render(columns);
			model.handleInput("\x1b");
			model.handleInput("\x1b[B");
			model.handleInput("\x1b[B");
			model.handleInput("\r");
			captures.roles = model.render(columns);
			for (const [screen, lines] of Object.entries(captures)) {
				const name = `${screen}-${columns}x${rows}-${themeName}-${symbols}`;
				await Bun.write(`${output}/${name}.ansi`, lines.join("\n"));
				await Bun.write(`${output}/${name}.txt`, lines.map(line => Bun.stripANSI(line).trimEnd()).join("\n"));
			}
			model.dispose();
			provider.stopValidation();
			management.stopValidation();
		}
console.log("Captured fixture screens for all 16 terminal combinations.");
