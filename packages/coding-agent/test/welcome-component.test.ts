import { beforeAll, describe, expect, it } from "bun:test";
import {
	type ChangelogStatus,
	type UpdateStatus,
	WelcomeComponent,
} from "@f5xc-salesdemos/xcsh/modes/components/welcome";
import type {
	ModelStatus,
	WelcomeContextStatus,
	WelcomeGitLabStatus,
} from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";
import { initTheme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

describe("WelcomeComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("renders connected model", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 142 });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("Model Provider");
		expect(out).toContain("litellm");
		// Unified emoji indicator (iTerm2 + Nerd Fonts)
		expect(out).toContain("✅");
		expect(out).not.toContain("●");
	});

	it("renders no_provider", () => {
		const c = new WelcomeComponent("15.15.0", { state: "no_provider", provider: "litellm" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("No model provider configured");
		expect(out).toContain("/login");
		expect(out).toContain("❌");
		expect(out).not.toContain("○");
	});

	it("renders auth_error", () => {
		const c = new WelcomeComponent("15.15.0", { state: "auth_error", provider: "litellm" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("connection failed");
		expect(out).toContain("/login");
		expect(out).toContain("❌");
	});

	it("hides context when undefined", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 });
		expect(renderPlain(c).join("\n")).not.toContain("F5 XC Context");
	});

	it("shows context when provided", () => {
		const ms: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };
		const ps: WelcomeContextStatus = { state: "connected", name: "production", latencyMs: 42 };
		const c = new WelcomeComponent("15.15.0", ms, ps);
		const out = renderPlain(c).join("\n");
		expect(out).toContain("F5 XC Context");
		expect(out).toContain("production");
		expect(out).toContain("✅");
	});

	it("shows context auth_error with update hint", () => {
		const ms: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };
		const c = new WelcomeComponent("15.15.0", ms, { state: "auth_error", name: "prod" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("token invalid");
		expect(out).toContain("Run /context to update");
		expect(out).toContain("❌");
	});

	it("shows context offline with network hint", () => {
		const ms: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };
		const c = new WelcomeComponent("15.15.0", ms, { state: "offline", name: "prod" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("unreachable");
		expect(out).toContain("Check network, /context");
		expect(out).toContain("⚠️");
	});

	it("shows no_context hint", () => {
		const ms: ModelStatus = { state: "connected", provider: "litellm", latencyMs: 100 };
		const c = new WelcomeComponent("15.15.0", ms, { state: "no_context" });
		const out = renderPlain(c).join("\n");
		expect(out).toContain("No context configured");
		expect(out).toContain("⚠️");
	});

	it("renders version header", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 });
		expect(renderPlain(c).join("\n")).toContain("xcsh v15.15.0");
	});

	it("returns empty for narrow terminal", () => {
		const c = new WelcomeComponent("15.15.0", { state: "connected", provider: "litellm", latencyMs: 100 });
		expect(c.render(3)).toEqual([]);
	});

	describe("content-driven width", () => {
		const connected: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };

		function boxWidth(component: WelcomeComponent, termWidth = 120): number {
			const lines = renderPlain(component, termWidth);
			return lines.length > 0 ? lines[0].length : 0;
		}

		it("box is no wider than the content requires", () => {
			const c = new WelcomeComponent("15.15.0", connected);
			const width = boxWidth(c);
			// Widest right-column line is ~25 chars ("\u2705 anthropic \u2014 connected")
			// Left column is 48-50, plus 3 borders = box should be well under 100
			expect(width).toBeLessThan(100);
		});

		it("no_context state widens box to fit hint text", () => {
			const withoutContext = new WelcomeComponent("15.15.0", connected);
			const withNoContext = new WelcomeComponent("15.15.0", connected, { state: "no_context" });
			// "Run /context create <name> <url> <token>" is wider than "✓ anthropic — connected"
			expect(boxWidth(withNoContext)).toBeGreaterThan(boxWidth(withoutContext));
		});

		it("context auth_error hint is not truncated at 80 columns", () => {
			const c = new WelcomeComponent("15.15.0", connected, { state: "auth_error", name: "prod" });
			const lines = renderPlain(c, 80);
			const hintLine = lines.find(l => l.includes("/context to update"));
			expect(hintLine).toBeDefined();
			expect(hintLine).not.toContain("\u2026");
		});

		it("context offline hint is not truncated at 80 columns", () => {
			const c = new WelcomeComponent("15.15.0", connected, { state: "offline", name: "prod" });
			const lines = renderPlain(c, 80);
			const hintLine = lines.find(l => l.includes("Check network"));
			expect(hintLine).toBeDefined();
			expect(hintLine).not.toContain("\u2026");
		});

		it("no_context hint is not truncated at 100 columns", () => {
			const c = new WelcomeComponent("15.15.0", connected, { state: "no_context" });
			const out = renderPlain(c, 100).join("\n");
			expect(out).toContain("Run /context create <name> <url> <token>");
			expect(out).not.toContain("\u2026");
		});

		it("long context name caps at terminal width", () => {
			const longName = "a]b-c_d".repeat(9); // 63 chars
			const c = new WelcomeComponent("15.15.0", connected, { state: "connected", name: longName, latencyMs: 50 });
			const width = boxWidth(c, 100);
			// Box must not exceed terminal width - 2 (margin)
			expect(width).toBeLessThanOrEqual(98);
			// But should still render (not empty)
			expect(width).toBeGreaterThan(0);
		});
	});

	describe("update and changelog sections", () => {
		const model: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };
		const context: WelcomeContextStatus = { state: "connected", name: "prod", latencyMs: 42 };

		it("renders Update Available section when updateStatus is available", () => {
			const update: UpdateStatus = { available: true, latestVersion: "17.5.0" };
			const c = new WelcomeComponent("17.4.1", model, context, update);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("Update Available");
			expect(out).toContain("17.5.0");
			expect(out).toContain("xcsh update");
		});

		it("hides Update Available section when updateStatus is omitted", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("Update Available");
		});

		it("hides Update Available section when updateStatus.available is false", () => {
			const update: UpdateStatus = { available: false };
			const c = new WelcomeComponent("17.4.1", model, context, update);
			expect(renderPlain(c).join("\n")).not.toContain("Update Available");
		});

		it("renders What's New section when changelogStatus.hasNew is true", () => {
			const changelog: ChangelogStatus = { hasNew: true, version: "17.4.1" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, changelog);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("What's New");
			expect(out).toContain("17.4.1");
			expect(out).toContain("/changelog");
		});

		it("hides What's New section when changelogStatus is omitted", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("What's New");
		});

		it("hides What's New section when changelogStatus.hasNew is false", () => {
			const changelog: ChangelogStatus = { hasNew: false, version: "17.4.1" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, changelog);
			expect(renderPlain(c).join("\n")).not.toContain("What's New");
		});

		it("setUpdateStatus reflects in the next render", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("Update Available");
			c.setUpdateStatus({ available: true, latestVersion: "17.5.0" });
			const out = renderPlain(c).join("\n");
			expect(out).toContain("Update Available");
			expect(out).toContain("17.5.0");
		});

		it("setChangelogStatus reflects in the next render", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("What's New");
			c.setChangelogStatus({ hasNew: true, version: "17.4.1" });
			const out = renderPlain(c).join("\n");
			expect(out).toContain("What's New");
			expect(out).toContain("/changelog");
		});

		it("renders both update and changelog sections together", () => {
			const update: UpdateStatus = { available: true, latestVersion: "17.5.0" };
			const changelog: ChangelogStatus = { hasNew: true, version: "17.4.1" };
			const c = new WelcomeComponent("17.4.1", model, context, update, changelog);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("Update Available");
			expect(out).toContain("What's New");
		});

		it("Update Available hint is not truncated at 80 columns", () => {
			const update: UpdateStatus = { available: true, latestVersion: "17.5.0" };
			const c = new WelcomeComponent("17.4.1", model, context, update);
			const lines = renderPlain(c, 80);
			const hintLine = lines.find(l => l.includes("xcsh update"));
			expect(hintLine).toBeDefined();
			expect(hintLine).not.toContain("\u2026");
		});

		it("What's New hint is not truncated at 80 columns", () => {
			const changelog: ChangelogStatus = { hasNew: true, version: "17.4.1" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, changelog);
			const lines = renderPlain(c, 80);
			const hintLine = lines.find(l => l.includes("/changelog"));
			expect(hintLine).toBeDefined();
			expect(hintLine).not.toContain("\u2026");
		});
	});

	describe("gitlab section", () => {
		const model: ModelStatus = { state: "connected", provider: "anthropic", latencyMs: 100 };
		const context: WelcomeContextStatus = { state: "connected", name: "prod", latencyMs: 42 };

		it("hides gitlab when status is undefined", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("GitLab");
		});

		it("renders connected state with project name", () => {
			const gitlab: WelcomeGitLabStatus = { state: "connected", project: "mygroup/myproject" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, undefined, gitlab);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("GitLab");
			expect(out).toContain("mygroup/myproject");
			expect(out).toContain("\u2705");
		});

		it("renders auth_error with login hint", () => {
			const gitlab: WelcomeGitLabStatus = { state: "auth_error" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, undefined, gitlab);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("GitLab");
			expect(out).toContain("Not authenticated");
			expect(out).toContain("glab auth login");
			expect(out).toContain("\u274C");
		});

		it("renders not_configured with setup hint", () => {
			const gitlab: WelcomeGitLabStatus = { state: "not_configured" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, undefined, gitlab);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("GitLab");
			expect(out).toContain("No project configured");
			expect(out).toContain("glab_setup");
			expect(out).toContain("\u26A0");
		});

		it("renders project_inaccessible with access hint", () => {
			const gitlab: WelcomeGitLabStatus = { state: "project_inaccessible", project: "restricted/repo" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, undefined, gitlab);
			const out = renderPlain(c).join("\n");
			expect(out).toContain("GitLab");
			expect(out).toContain("restricted/repo");
			expect(out).toContain("access denied");
			expect(out).toContain("\u26A0");
		});

		it("setGitLabStatus reflects in next render", () => {
			const c = new WelcomeComponent("17.4.1", model, context);
			expect(renderPlain(c).join("\n")).not.toContain("GitLab");
			c.setGitLabStatus({ state: "connected", project: "group/repo" });
			const out = renderPlain(c).join("\n");
			expect(out).toContain("GitLab");
			expect(out).toContain("group/repo");
		});

		it("gitlab hint is not truncated at 80 columns", () => {
			const gitlab: WelcomeGitLabStatus = { state: "auth_error" };
			const c = new WelcomeComponent("17.4.1", model, context, undefined, undefined, gitlab);
			const lines = renderPlain(c, 80);
			const hintLine = lines.find(l => l.includes("glab auth login"));
			expect(hintLine).toBeDefined();
			expect(hintLine).not.toContain("\u2026");
		});
	});
});
