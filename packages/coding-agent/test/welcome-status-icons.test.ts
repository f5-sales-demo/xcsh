import { beforeAll, describe, expect, it } from "bun:test";
import { WelcomeComponent } from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type { ModelStatus, WelcomeProfileStatus } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string {
	return component.render(width).map(stripAnsi).join("\n");
}

describe("WelcomeComponent emoji status icons (PR #207 follow-up)", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("connected provider renders ✅ (not plain ✓/✔)", () => {
		const c = new WelcomeComponent("18.5.2", { state: "connected", provider: "anthropic", latencyMs: 42 });
		const out = renderPlain(c);
		expect(out).toContain("✅");
		expect(out).not.toMatch(/[✓✔]\s+anthropic/);
	});

	it("auth_error provider renders ❌ (not plain ✗/✘)", () => {
		const c = new WelcomeComponent("18.5.2", { state: "auth_error", provider: "anthropic" });
		const out = renderPlain(c);
		expect(out).toContain("❌");
		expect(out).not.toMatch(/[✗✘]\s+anthropic/);
	});

	it("no_provider renders ❌", () => {
		const c = new WelcomeComponent("18.5.2", { state: "no_provider" });
		const out = renderPlain(c);
		expect(out).toContain("❌");
	});

	it("profile connected renders ✅", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const ps: WelcomeProfileStatus = { state: "connected", name: "prod", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, ps);
		expect(renderPlain(c)).toContain("✅");
	});

	it("profile auth_error renders ❌", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, { state: "auth_error", name: "prod" });
		expect(renderPlain(c)).toContain("❌");
	});

	it("profile offline renders ⚠️", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, { state: "offline", name: "prod" });
		expect(renderPlain(c)).toContain("⚠");
	});

	it("profile no_profile renders ⚠️ (configuration required)", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, { state: "no_profile" });
		const out = renderPlain(c);
		expect(out).toContain("⚠");
		expect(out).toContain("No profile configured");
	});
});

describe("WelcomeComponent F5 logo halo", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("applies explicit dark-red bg to ▒ halo cells so the shadow doesn't wash out on light terminals", () => {
		const c = new WelcomeComponent("18.5.2", { state: "connected", provider: "anthropic", latencyMs: 10 });
		// Render keeps ANSI escapes
		const raw = c.render(120).join("\n");
		// The shadow bg is emitted as ANSI 256 color 88 (dark red) whenever a ▒ halo cell is painted.
		// We assert that the bg escape appears somewhere in the logo rendering.
		expect(raw).toContain("\x1b[48;5;88m");
	});
});
