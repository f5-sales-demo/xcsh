import { beforeAll, describe, expect, it } from "bun:test";
import { type UpdateStatus, WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { ModelStatus, ServiceStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

const ctxConnected: ServiceStatus = { name: "F5 XC Context", state: "connected" };
const ctxNoContext: ServiceStatus = { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context create" };
const ctxAuthError: ServiceStatus = { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context" };
const ctxOffline: ServiceStatus = { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context" };
const gitlabConnected: ServiceStatus = { name: "GitLab", state: "connected" };
const gitlabUnauth: ServiceStatus = { name: "GitLab", state: "unauthenticated", hint: "run: glab auth login" };
const gitlabUnavailable: ServiceStatus = { name: "GitLab", state: "unavailable", hint: "not installed" };

describe("WelcomeComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("renders connected model", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 142 });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("Model Provider");
		expect(out).toContain("litellm");
		expect(out).toContain("✅");
		expect(out).not.toContain("●");
	});

	it("renders no_provider", () => {
		const c = new WelcomeComponent("15.15.0", { state: "no_provider", provider: "litellm" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("No model provider configured");
		expect(out).toContain("/login");
		expect(out).toContain("❌");
	});

	it("renders auth_error", () => {
		const c = new WelcomeComponent("15.15.0", { state: "auth_error", provider: "litellm" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("connection failed");
		expect(out).toContain("/login");
		expect(out).toContain("❌");
	});

	it("renders version header", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 });
		expect(renderPlain(c).join("\n")).toContain("xcsh v15.15.0");
	});

	it("returns empty for narrow terminal", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 });
		expect(c.render(3)).toEqual([]);
	});

	it("no services renders no service lines", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 }, []);
		const out = renderPlain(c).join("\n");
		expect(out).not.toContain("F5 XC Context");
		expect(out).not.toContain("GitLab");
	});

	describe("service line rendering", () => {
		const model: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };

		it("connected service shows ✅ and name on one line", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxConnected]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("F5 XC Context"));
			expect(line).toBeDefined();
			expect(line).toContain("✅");
			const lines = out.filter(l => l.includes("F5 XC Context"));
			expect(lines.length).toBe(1);
		});

		it("unauthenticated service shows ⚠️ and inline hint on one line", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxAuthError]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("F5 XC Context"));
			expect(line).toBeDefined();
			expect(line).toContain("⚠️");
			expect(line).toContain("run: /context");
			const lines = out.filter(l => l.includes("F5 XC Context"));
			expect(lines.length).toBe(1);
		});

		it("no_context shows ⚠️ and /context create hint on one line", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxNoContext]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("F5 XC Context"));
			expect(line).toBeDefined();
			expect(line).toContain("⚠️");
			expect(line).toContain("/context create");
		});

		it("offline shows ⚠️ and /context hint on one line", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxOffline]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("F5 XC Context"));
			expect(line).toBeDefined();
			expect(line).toContain("⚠️");
			expect(line).toContain("run: /context");
		});

		it("unavailable service shows ⚠️ and 'not installed' on one line", () => {
			const c = new WelcomeComponent("15.15.0", model, [gitlabUnavailable]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("GitLab"));
			expect(line).toBeDefined();
			expect(line).toContain("⚠️");
			expect(line).toContain("not installed");
			const lines = out.filter(l => l.includes("GitLab"));
			expect(lines.length).toBe(1);
		});

		it("GitLab unauthenticated shows ⚠️ and glab auth login hint", () => {
			const c = new WelcomeComponent("15.15.0", model, [gitlabUnauth]);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("GitLab"));
			expect(line).toBeDefined();
			expect(line).toContain("⚠️");
			expect(line).toContain("glab auth login");
		});

		it("renders multiple services in order", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxConnected, gitlabConnected, gitlabUnauth]);
			const out = renderPlain(c);
			const ctxIdx = out.findIndex(l => l.includes("F5 XC Context"));
			const glIdx = out.findIndex(l => l.includes("GitLab"));
			expect(ctxIdx).toBeLessThan(glIdx);
		});

		it("setServices reflects in the next render", () => {
			const c = new WelcomeComponent("15.15.0", model, []);
			expect(renderPlain(c).join("\n")).not.toContain("GitLab");
			c.setServices([gitlabConnected]);
			expect(renderPlain(c).join("\n")).toContain("GitLab");
		});
	});

	describe("update section", () => {
		const model: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };

		it("renders update line when available", () => {
			const update: UpdateStatus = { available: true, latestVersion: "17.5.0" };
			const c = new WelcomeComponent("17.4.1", model, [], update);
			const out = renderPlain(c);
			const line = out.find(l => l.includes("17.5.0"));
			expect(line).toBeDefined();
			expect(line).toContain("xcsh update");
			const lines = out.filter(l => l.includes("xcsh update"));
			expect(lines.length).toBe(1);
		});

		it("hides update section when updateStatus is omitted", () => {
			const c = new WelcomeComponent("17.4.1", model, []);
			expect(renderPlain(c).join("\n")).not.toContain("xcsh update");
		});

		it("hides update section when available is false", () => {
			const c = new WelcomeComponent("17.4.1", model, [], { available: false });
			expect(renderPlain(c).join("\n")).not.toContain("xcsh update");
		});

		it("setUpdateStatus reflects in the next render", () => {
			const c = new WelcomeComponent("17.4.1", model, []);
			expect(renderPlain(c).join("\n")).not.toContain("xcsh update");
			c.setUpdateStatus({ available: true, latestVersion: "17.5.0" });
			const out = renderPlain(c).join("\n");
			expect(out).toContain("xcsh update");
			expect(out).toContain("17.5.0");
		});

		it("update hint is not truncated at 80 columns", () => {
			const update: UpdateStatus = { available: true, latestVersion: "17.5.0" };
			const c = new WelcomeComponent("17.4.1", model, [], update);
			const lines = renderPlain(c, 80);
			const line = lines.find(l => l.includes("xcsh update"));
			expect(line).toBeDefined();
			expect(line).not.toContain("…");
		});
	});

	describe("What's New — removed", () => {
		const model: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };

		it("What's New is never shown", () => {
			const c = new WelcomeComponent("17.4.1", model, []);
			expect(renderPlain(c).join("\n")).not.toContain("What's New");
		});

		it("changelog section does not appear even with update present", () => {
			const c = new WelcomeComponent("17.4.1", model, [], { available: true, latestVersion: "17.5.0" });
			expect(renderPlain(c).join("\n")).not.toContain("What's New");
			expect(renderPlain(c).join("\n")).not.toContain("/changelog");
		});
	});

	describe("content-driven width", () => {
		const connected: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };

		function boxWidth(component: WelcomeComponent, termWidth = 120): number {
			const lines = renderPlain(component, termWidth);
			return lines.length > 0 ? lines[0].length : 0;
		}

		it("box is no wider than the content requires", () => {
			const c = new WelcomeComponent("15.15.0", connected, []);
			const width = boxWidth(c);
			expect(width).toBeLessThan(100);
		});

		it("service with long hint widens box to fit", () => {
			const noServices = new WelcomeComponent("15.15.0", connected, []);
			const withHint = new WelcomeComponent("15.15.0", connected, [ctxNoContext]);
			expect(boxWidth(withHint)).toBeGreaterThanOrEqual(boxWidth(noServices));
		});

		it("service hint is not truncated at 80 columns", () => {
			const c = new WelcomeComponent("15.15.0", connected, [ctxNoContext], undefined);
			const lines = renderPlain(c, 80);
			const line = lines.find(l => l.includes("/context create"));
			expect(line).toBeDefined();
			expect(line).not.toContain("…");
		});

		it("box does not exceed terminal width", () => {
			const c = new WelcomeComponent("15.15.0", connected, [ctxNoContext]);
			const width = boxWidth(c, 100);
			expect(width).toBeLessThanOrEqual(98);
			expect(width).toBeGreaterThan(0);
		});
	});

	describe("service grouping", () => {
		const model: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };

		it("renders core services without header", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxConnected]);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("F5 XC Context");
			expect(out).not.toContain("Plugins");
		});

		it("renders unified plugins under Plugins header", () => {
			const c = new WelcomeComponent(
				"15.15.0",
				model,
				[ctxConnected],
				undefined,
				[],
				[{ name: "Salesforce", state: "connected" }],
			);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("F5 XC Context");
			expect(out).toContain("Plugins");
			expect(out).toContain("Salesforce");
		});

		it("hides Plugins header when no plugins", () => {
			const c = new WelcomeComponent("15.15.0", model, [ctxConnected, gitlabConnected]);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("F5 XC Context");
			expect(out).toContain("GitLab");
			expect(out).not.toContain("Plugins");
		});

		it("renders all plugins in single Plugins section", () => {
			const c = new WelcomeComponent(
				"15.15.0",
				model,
				[ctxConnected],
				undefined,
				[],
				[
					{ name: "Salesforce", state: "connected" },
					{ name: "Azure", state: "connected" },
				],
			);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("Plugins");
			expect(out).toContain("Salesforce");
			expect(out).toContain("Azure");
			expect(out).not.toContain("Recommended");
		});

		it("defaults to Plugins header for unified section", () => {
			const c = new WelcomeComponent(
				"15.15.0",
				model,
				[],
				undefined,
				[],
				[{ name: "MyPlugin", state: "connected" }],
			);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("Plugins");
			expect(out).toContain("MyPlugin");
		});
	});
});
