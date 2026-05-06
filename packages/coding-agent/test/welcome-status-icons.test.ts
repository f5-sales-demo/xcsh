import { beforeAll, describe, expect, it } from "bun:test";
import { WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { ModelStatus, ServiceStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string {
	return component.render(width).map(stripAnsi).join("\n");
}

describe("WelcomeComponent unified emoji status icons", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("connected provider renders ✅", () => {
		const c = new WelcomeComponent("18.7.0", { state: "connected", provider: "anthropic", latencyMs: 42 });
		expect(renderPlain(c)).toContain("✅");
		expect(renderPlain(c)).not.toContain("●");
	});

	it("auth_error provider renders ❌", () => {
		const c = new WelcomeComponent("18.7.0", { state: "auth_error", provider: "anthropic" });
		expect(renderPlain(c)).toContain("❌");
	});

	it("no_provider renders ❌", () => {
		const c = new WelcomeComponent("18.7.0", { state: "no_provider" });
		expect(renderPlain(c)).toContain("❌");
	});

	it("connected service renders ✅", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const svc: ServiceStatus = { name: "F5 XC Context", state: "connected" };
		expect(renderPlain(new WelcomeComponent("18.7.0", ms, [svc]))).toContain("✅");
	});

	it("unauthenticated service renders ⚠️ (not ❌)", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const svc: ServiceStatus = { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context" };
		const out = renderPlain(new WelcomeComponent("18.7.0", ms, [svc]));
		expect(out).toContain("⚠️");
		expect(out).not.toContain("❌");
	});

	it("unavailable service renders ⚠️ (not ❌)", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const svc: ServiceStatus = { name: "GitLab", state: "unavailable", hint: "not installed" };
		const out = renderPlain(new WelcomeComponent("18.7.0", ms, [svc]));
		expect(out).toContain("⚠️");
		expect(out).not.toContain("❌");
	});
});

describe("WelcomeComponent F5 logo halo", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("applies explicit dark-red bg to ▒ halo cells", () => {
		const c = new WelcomeComponent("18.7.0", { state: "connected", provider: "anthropic", latencyMs: 10 });
		const raw = c.render(120).join("\n");
		expect(raw).toContain("\x1b[48;5;88m");
	});
});
