import { beforeAll, describe, expect, it } from "bun:test";
import { WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { RecommendedPluginStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

const MODEL_CONNECTED = { state: "connected" as const, provider: "anthropic" };

describe("WelcomeComponent recommended plugins", () => {
	it("renders recommended plugins section when plugins are provided", () => {
		const plugins: RecommendedPluginStatus[] = [
			{ name: "github-ops", installed: true },
			{ name: "platform", installed: false },
			{ name: "brand", installed: true },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("Recommended Plugins");
		expect(raw).toContain("github-ops");
		expect(raw).toContain("platform");
		expect(raw).toContain("brand");
	});

	it("shows /plugin setup hint when some plugins are missing", () => {
		const plugins: RecommendedPluginStatus[] = [
			{ name: "github-ops", installed: true },
			{ name: "platform", installed: false },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("/plugin setup");
	});

	it("does not show /plugin setup hint when all plugins are installed", () => {
		const plugins: RecommendedPluginStatus[] = [
			{ name: "github-ops", installed: true },
			{ name: "platform", installed: true },
		];

		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, plugins);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).toContain("Recommended Plugins");
		expect(raw).not.toContain("/plugin setup");
	});

	it("does not render recommended section when list is empty", () => {
		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED, [], undefined, []);
		const lines = component.render(120);
		const raw = lines.join("\n");

		expect(raw).not.toContain("Recommended Plugins");
	});

	it("setRecommendedPlugins updates the rendered output", () => {
		const component = new WelcomeComponent("19.2.0", MODEL_CONNECTED);
		let lines = component.render(120);
		expect(lines.join("\n")).not.toContain("Recommended Plugins");

		component.setRecommendedPlugins([{ name: "firecrawl", installed: false }]);
		lines = component.render(120);
		expect(lines.join("\n")).toContain("Recommended Plugins");
		expect(lines.join("\n")).toContain("firecrawl");
	});
});
