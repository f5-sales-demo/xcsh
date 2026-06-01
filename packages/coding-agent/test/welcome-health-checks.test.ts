import { beforeAll, describe, expect, it } from "bun:test";
import { WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { ModelStatus, ServiceStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

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
		const svc: ServiceStatus = { name: "TestPlugin", state: "connected", _isPlugin: true };
		const c = new WelcomeComponent("15.15.0", model, [svc]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("TestPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("✅"); // checkmark emoji
		expect(line).not.toContain("hint");
	});

	it("unauthenticated state renders with hint", () => {
		const svc: ServiceStatus = {
			name: "Salesforce",
			state: "unauthenticated",
			hint: "run: /sf-login",
			_isPlugin: true,
		};
		const c = new WelcomeComponent("15.15.0", model, [svc]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("Salesforce"));
		expect(line).toBeDefined();
		expect(line).toContain("⚠️"); // warning emoji
		expect(line).toContain("run: /sf-login");
	});

	it("unavailable state renders appropriately", () => {
		const svc: ServiceStatus = {
			name: "BrokenPlugin",
			state: "unavailable",
			hint: "service down",
			_isPlugin: true,
		};
		const c = new WelcomeComponent("15.15.0", model, [svc]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("BrokenPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("⚠️"); // warning emoji
		expect(line).toContain("service down");
	});

	it("check() that throws returns unavailable", () => {
		// This test simulates what interactive-mode.ts does when check() throws:
		// it catches and creates a ServiceStatus with state: unavailable
		const svc: ServiceStatus = {
			name: "FailingPlugin",
			state: "unavailable",
			hint: "check failed",
			_isPlugin: true,
		};
		const c = new WelcomeComponent("15.15.0", model, [svc]);
		const out = renderPlain(c);
		const line = out.find(l => l.includes("FailingPlugin"));
		expect(line).toBeDefined();
		expect(line).toContain("check failed");
	});

	it("mixed states render correctly per service", () => {
		const connected: ServiceStatus = { name: "HealthyPlugin", state: "connected", _isPlugin: true };
		const unauth: ServiceStatus = {
			name: "AuthNeeded",
			state: "unauthenticated",
			hint: "login required",
			_isPlugin: true,
		};
		const unavail: ServiceStatus = {
			name: "DownPlugin",
			state: "unavailable",
			hint: "unreachable",
			_isPlugin: true,
		};
		const c = new WelcomeComponent("15.15.0", model, [connected, unauth, unavail]);
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
		const coreService: ServiceStatus = { name: "F5 XC Context", state: "connected" };
		const c = new WelcomeComponent("15.15.0", model, [coreService]);
		const out = renderPlain(c).join("\n");
		expect(out).toContain("F5 XC Context");
		expect(out).not.toContain("Plugins");
	});

	it("plugin with custom group renders under that group header", () => {
		const svc: ServiceStatus = {
			name: "SalesforceAccounts",
			state: "connected",
			_isPlugin: true,
			_group: "CRM Tools",
		};
		const c = new WelcomeComponent("15.15.0", model, [svc]);
		const out = renderPlain(c).join("\n");
		expect(out).toContain("CRM Tools");
		expect(out).toContain("SalesforceAccounts");
		expect(out).not.toContain("Plugins");
	});
});
