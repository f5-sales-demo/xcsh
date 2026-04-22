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

// Unified circle indicators (see #224): welcome and the /profile table both use the
// same 1-cell theme-colored glyph set via formatStatusIcon(). Emoji (✅/❌/⚠️) are
// rejected because they occupy 2 terminal cells and break column alignment.
describe("WelcomeComponent unified status icons (#224)", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("connected provider renders ● (filled circle, not emoji or ✓/✔)", () => {
		const c = new WelcomeComponent("18.5.2", { state: "connected", provider: "anthropic", latencyMs: 42 });
		const out = renderPlain(c);
		expect(out).toContain("●");
		expect(out).not.toContain("✅");
		expect(out).not.toMatch(/[✓✔]\s+anthropic/);
	});

	it("auth_error provider renders ○ (empty circle, not emoji or ✗/✘)", () => {
		const c = new WelcomeComponent("18.5.2", { state: "auth_error", provider: "anthropic" });
		const out = renderPlain(c);
		expect(out).toContain("○");
		expect(out).not.toContain("❌");
		expect(out).not.toMatch(/[✗✘]\s+anthropic/);
	});

	it("no_provider renders ○ (empty circle)", () => {
		const c = new WelcomeComponent("18.5.2", { state: "no_provider" });
		const out = renderPlain(c);
		expect(out).toContain("○");
		expect(out).not.toContain("❌");
	});

	it("profile connected renders ● (matches /profile table)", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const ps: WelcomeProfileStatus = { state: "connected", name: "prod", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, ps);
		const out = renderPlain(c);
		expect(out).toContain("●");
		expect(out).not.toContain("✅");
	});

	it("profile auth_error renders ○", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, { state: "auth_error", name: "prod" });
		const out = renderPlain(c);
		expect(out).toContain("○");
		expect(out).not.toContain("❌");
	});

	it("profile offline renders ⚠ (text-presentation triangle, not ⚠️ emoji)", () => {
		const ms: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 10 };
		const c = new WelcomeComponent("18.5.2", ms, { state: "offline", name: "prod" });
		const out = renderPlain(c);
		expect(out).toContain("⚠");
		// Must not include the VS16 emoji presentation selector (makes it 2-cell on most terminals)
		expect(out).not.toContain("⚠️");
	});

	it("profile no_profile renders ⚠ (warning-level nudge to configure)", () => {
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
