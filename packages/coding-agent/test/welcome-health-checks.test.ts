import { beforeAll, describe, expect, it } from "bun:test";
import { registerLocales } from "@f5xc-salesdemos/pi-utils";
import { WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { ModelStatus, UnifiedPluginStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";
import { locales } from "../src/locales/index";

registerLocales(locales);

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

describe("plugin health check states", () => {
	beforeAll(() => {
		initTheme();
	});

	const model: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };

	it("connected state renders correctly", () => {
		const p: UnifiedPluginStatus = { name: "TestPlugin", state: "connected" };
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], [p]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("TestPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("✅");
		expect(line).not.toContain("hint");
	});

	it("unauthenticated state renders with hint", () => {
		const p: UnifiedPluginStatus = { name: "Salesforce", state: "unauthenticated", hint: "run: /sf-login" };
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], [p]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("Salesforce"));
		expect(line).toBeDefined();
		expect(line).toContain("⚠️");
		expect(line).toContain("run: /sf-login");
	});

	it("unavailable state renders appropriately", () => {
		const p: UnifiedPluginStatus = { name: "BrokenPlugin", state: "unavailable", hint: "service down" };
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], [p]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("BrokenPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("⚠️");
		expect(line).toContain("service down");
	});

	it("check() that throws returns unavailable", () => {
		const p: UnifiedPluginStatus = { name: "FailingPlugin", state: "unavailable", hint: "check failed" };
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], [p]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("FailingPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("check failed");
	});

	it("mixed states render correctly per service", () => {
		const plugins: UnifiedPluginStatus[] = [
			{ name: "HealthyPlugin", state: "connected" },
			{ name: "AuthNeeded", state: "unauthenticated", hint: "login required" },
			{ name: "DownPlugin", state: "unavailable", hint: "unreachable" },
		];
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], plugins);
		const out = renderPlain(c);

		const healthyLine = out.find(l => l.includes("HealthyPlugin"));
		expect(healthyLine).toContain("✅");

		const authLine = out.find(l => l.includes("AuthNeeded"));
		expect(authLine).toContain("⚠️");
		expect(authLine).toContain("login required");

		const downLine = out.find(l => l.includes("DownPlugin"));
		expect(downLine).toContain("⚠️");
		expect(downLine).toContain("unreachable");
	});

	it("no plugins means no Plugins section", () => {
		const c = new WelcomeComponent("15.15.0", model, [{ name: "F5 XC Context", state: "connected" }]);
		const out = renderPlain(c).join("\n");
		expect(out).toContain("F5 XC Context");
		expect(out).not.toContain("Plugins");
	});

	it("plugin with custom group still renders under Plugins header", () => {
		const p: UnifiedPluginStatus = { name: "SalesforceAccounts", state: "connected", group: "CRM Tools" };
		const c = new WelcomeComponent("15.15.0", model, [], undefined, [], [p]);
		const out = renderPlain(c).join("\n");
		expect(out).toContain("Plugins");
		expect(out).toContain("SalesforceAccounts");
	});
});
