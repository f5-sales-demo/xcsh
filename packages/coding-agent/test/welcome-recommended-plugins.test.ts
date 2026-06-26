import { beforeAll, describe, expect, it } from "bun:test";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { WelcomeComponent } from "@f5-sales-demo/xcsh/modes/components/welcome";
import type { UnifiedPluginStatus } from "@f5-sales-demo/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { locales } from "../src/locales/index";

registerLocales(locales);

beforeAll(async () => {
	await initTheme();
});

const MODEL_CONNECTED = { state: "connected" as const, provider: "anthropic" };

describe("WelcomeComponent unified plugins section", () => {
	it("renders a single Plugins section", () => {
		const plugins: UnifiedPluginStatus[] = [
			{ name: "Salesforce", state: "connected" },
			{ name: "github", state: "installed" },
			{ name: "platform", state: "not_installed", hint: "run: /plugin setup" },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("Plugins");
		expect(raw).not.toContain("Recommended Plugins");
		expect(raw).toContain("Salesforce");
		expect(raw).toContain("github");
		expect(raw).toContain("platform");
	});

	it("shows /plugin setup hint when some plugins are not installed", () => {
		const plugins: UnifiedPluginStatus[] = [
			{ name: "github", state: "installed" },
			{ name: "platform", state: "not_installed", hint: "run: /plugin setup" },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("/plugin");
	});

	it("does not show /plugin setup hint when all plugins are installed or connected", () => {
		const plugins: UnifiedPluginStatus[] = [
			{ name: "Salesforce", state: "connected" },
			{ name: "github", state: "installed" },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("Plugins");
		expect(raw).not.toContain("/plugin");
	});

	it("does not render plugins section when list is empty", () => {
		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, []);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).not.toContain("Plugins");
	});

	it("setPlugins updates the rendered output", () => {
		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED);
		let lines = component.render(120);
		expect(lines.join("\n")).not.toContain("Plugins");

		component.setPlugins([{ name: "firecrawl", state: "not_installed", hint: "run: /plugin setup" }]);
		lines = component.render(120);
		expect(lines.join("\n")).toContain("Plugins");
		expect(lines.join("\n")).toContain("firecrawl");
	});

	it("renders unauthenticated plugins with warning hint", () => {
		const plugins: UnifiedPluginStatus[] = [
			{ name: "Salesforce", state: "unauthenticated", hint: "run: /salesforce:setup" },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("Salesforce");
		expect(raw).toContain("/salesforce:setup");
	});
});
