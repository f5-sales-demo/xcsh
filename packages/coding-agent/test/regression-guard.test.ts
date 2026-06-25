/**
 * Fork-Specific Regression Guard
 *
 * This test file exists to prevent rebase/merge regressions from silently
 * breaking xcsh fork features. Each test locks in a deliberate divergence
 * from upstream (can1357/oh-my-pi) that must be preserved.
 *
 * When adding a new fork feature, add a corresponding test here.
 * When merging from upstream, CI will catch any accidental overwrites.
 *
 * History: v17.0.0 rebase reset ~20 files to upstream, wiping features
 * introduced in PRs #48, #54, #60, #63, #68, #69, #75, #76, #77, #79,
 * #81, #83, #85, #86, #90. This guard prevents that class of regression.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";
import { STATUS_LINE_PRESETS } from "../src/modes/components/status-line/presets";

// ─── Settings Schema Defaults ─────────────────────────────────────────────

describe("fork settings schema defaults (PRs #48, #68, theme commits)", () => {
	it("dark theme defaults to xcsh-dark (not upstream titanium)", () => {
		expect(SETTINGS_SCHEMA["theme.dark"].default).toBe("xcsh-dark");
	});

	it("light theme defaults to xcsh-light (not upstream light)", () => {
		expect(SETTINGS_SCHEMA["theme.light"].default).toBe("xcsh-light");
	});

	// issue #228 — theme.forceSlot (override auto dark/light detection)
	it("theme.forceSlot defaults to 'auto' (backward-compatible; detection chain unchanged)", () => {
		expect(SETTINGS_SCHEMA["theme.forceSlot"].default).toBe("auto");
	});

	it("theme.forceSlot accepts exactly auto | dark | light", () => {
		const def = SETTINGS_SCHEMA["theme.forceSlot"];
		expect(def.type).toBe("enum");
		if (def.type !== "enum") throw new Error("unreachable");
		expect([...def.values].sort()).toEqual(["auto", "dark", "light"]);
	});

	it("symbol preset defaults to nerd (not upstream unicode)", () => {
		expect(SETTINGS_SCHEMA.symbolPreset.default).toBe("nerd");
	});

	it("status line preset defaults to xcsh (not upstream default)", () => {
		expect(SETTINGS_SCHEMA["statusLine.preset"].default).toBe("xcsh");
	});

	it("status line separator defaults to powerline (not upstream powerline-thin)", () => {
		expect(SETTINGS_SCHEMA["statusLine.separator"].default).toBe("powerline");
	});

	// PR #48 — "optimize default settings for modern terminals with Nerd Fonts"
	it("memories enabled by default (PR #48)", () => {
		expect(SETTINGS_SCHEMA["memories.enabled"].default).toBe(true);
	});

	it("STT enabled by default (PR #48)", () => {
		expect(SETTINGS_SCHEMA["stt.enabled"].default).toBe(true);
	});

	it("Mermaid rendering enabled by default (PR #48)", () => {
		expect(SETTINGS_SCHEMA["renderMermaid.enabled"].default).toBe(true);
	});

	it("calculator tool enabled by default (PR #48)", () => {
		expect(SETTINGS_SCHEMA["calc.enabled"].default).toBe(true);
	});

	it("inspect_image enabled by default (PR #48)", () => {
		expect(SETTINGS_SCHEMA["inspect_image.enabled"].default).toBe(true);
	});

	// PR #68 — "powerline defaults, handoff save"
	it("compaction handoff saves to disk by default (PR #68)", () => {
		expect(SETTINGS_SCHEMA["compaction.handoffSaveToDisk"].default).toBe(true);
	});

	// Exa is disabled by default — fork preference over upstream default of true
	it("exa search disabled by default (fork preference)", () => {
		expect(SETTINGS_SCHEMA["exa.enabled"].default).toBe(false);
	});

	it("exa enableSearch disabled by default (fork preference)", () => {
		expect(SETTINGS_SCHEMA["exa.enableSearch"].default).toBe(false);
	});

	it("todo.verbose defaults to false (quiet todo output for humans)", () => {
		expect(SETTINGS_SCHEMA["todo.verbose"].default).toBe(false);
	});

	// statusLine.preset enum must include xcsh
	it("xcsh is a valid statusLine.preset value", () => {
		const presetDef = SETTINGS_SCHEMA["statusLine.preset"];
		expect(presetDef.type).toBe("enum");
		if (presetDef.type === "enum") {
			expect(presetDef.values).toContain("xcsh");
		}
	});
});

// ─── xcsh Status Line Preset ──────────────────────────────────────────────

describe("xcsh status line preset (PRs #76, #81)", () => {
	it("xcsh preset exists in presets registry", () => {
		const presets = STATUS_LINE_PRESETS;
		expect(presets).toHaveProperty("xcsh");
	});

	it("xcsh preset uses powerline separator", () => {
		const presets = STATUS_LINE_PRESETS;
		expect(presets.xcsh.separator).toBe("powerline");
	});

	it("xcsh preset includes context_xcsh in right segments", () => {
		const presets = STATUS_LINE_PRESETS;
		expect(presets.xcsh.rightSegments).toContain("context_xcsh");
	});

	it("xcsh preset includes context_pct in left segments", () => {
		const presets = STATUS_LINE_PRESETS;
		expect(presets.xcsh.leftSegments).toContain("context_pct");
	});
});

// ─── xcsh Theme Files ────────────────────────────────────────────────────

describe("xcsh theme files (theme commit 032e0b8c0)", () => {
	const themeDir = path.join(import.meta.dir, "../src/modes/theme/defaults");

	it("xcsh-dark.json exists", async () => {
		const stat = await fs.stat(path.join(themeDir, "xcsh-dark.json")).catch(() => null);
		expect(stat).not.toBeNull();
	});

	it("xcsh-light.json exists", async () => {
		const stat = await fs.stat(path.join(themeDir, "xcsh-light.json")).catch(() => null);
		expect(stat).not.toBeNull();
	});

	it("xcsh-dark.json is valid JSON with content", async () => {
		const raw = await fs.readFile(path.join(themeDir, "xcsh-dark.json"), "utf8");
		const theme = JSON.parse(raw);
		expect(Object.keys(theme).length).toBeGreaterThan(0);
	});

	it("xcsh-light.json is valid JSON with content", async () => {
		const raw = await fs.readFile(path.join(themeDir, "xcsh-light.json"), "utf8");
		const theme = JSON.parse(raw);
		expect(Object.keys(theme).length).toBeGreaterThan(0);
	});
});

// ─── xcsh-light WCAG AAA contrast pins (PR #207 UAT tuning) ──────────────
// Pin specific hex values that were tuned in the UAT pass so they cannot
// silently regress (e.g. on a future rebase from upstream). Every value
// below was selected for ≥7:1 contrast on white (AAA for normal text) or
// matches xcsh-dark for visual parity.

describe("xcsh-light theme value pins (PR #207)", () => {
	const themeDir = path.join(import.meta.dir, "../src/modes/theme/defaults");

	async function loadLight(): Promise<{ vars: Record<string, string>; colors: Record<string, string> }> {
		const raw = await fs.readFile(path.join(themeDir, "xcsh-light.json"), "utf8");
		return JSON.parse(raw);
	}

	it("border maps to f5Red (parity with xcsh-dark)", async () => {
		const t = await loadLight();
		expect(t.colors.border).toBe("f5Red");
	});

	it("contentAccent is AAA-dark on white", async () => {
		const t = await loadLight();
		expect(t.colors.contentAccent).toBe("#1a2028");
	});

	it("mediumGray var is AAA-dark on white", async () => {
		const t = await loadLight();
		expect(t.vars.mediumGray).toBe("#202020");
	});

	it("dimGray var is AAA-dark on white", async () => {
		const t = await loadLight();
		expect(t.vars.dimGray).toBe("#303030");
	});

	it("warning color is AAA amber on white", async () => {
		const t = await loadLight();
		expect(t.colors.warning).toBe("#8a5f00");
	});

	it("gutterSuccess is AAA cyan on white", async () => {
		const t = await loadLight();
		expect(t.colors.gutterSuccess).toBe("#006699");
	});

	it("gutterWarning is AAA orange on white", async () => {
		const t = await loadLight();
		expect(t.colors.gutterWarning).toBe("#8a4a00");
	});

	it("statusLine block is unified with xcsh-dark (deepCharcoal bar)", async () => {
		const t = await loadLight();
		expect(t.colors.statusLineBg).toBe("#0f1216");
		expect(t.colors.statusLineGitClean).toBe("#00ff88");
		expect(t.colors.statusLineGitDirty).toBe("#ffb347");
		expect(t.colors.statusLinePath).toBe("#e8ecf4");
	});
});

// ─── Secret Masking Integration ───────────────────────────────────────────

describe("bash tool secret masking (PR #77)", () => {
	it("bash.ts imports SECRET_ENV_PATTERNS from secrets module", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/bash.ts"), "utf8");
		expect(src).toContain("SECRET_ENV_PATTERNS");
		expect(src).toContain("SecretObfuscator");
	});

	it("bash.ts has module-level session obfuscator reference", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/bash.ts"), "utf8");
		expect(src).toContain("_sessionObfuscator");
	});

	it("bash.ts creates maskSecrets callback from session obfuscator", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/bash.ts"), "utf8");
		expect(src).toContain("maskSecrets");
		expect(src).toContain("obfuscator");
	});

	it("bash.ts integrates setShellPwd for cwd tracking", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/bash.ts"), "utf8");
		expect(src).toContain("setShellPwd");
	});
});

// ─── MCP Connection Message Suppression ──────────────────────────────────

describe("MCP startup message suppression (fork preference)", () => {
	it("sdk.ts uses logger.debug for MCP connection message (not stderr)", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		// Fork: silent debug logging
		expect(src).toContain('logger.debug("Connecting to MCP servers"');
		// Upstream: visible stderr output — must NOT be present
		expect(src).not.toContain("process.stderr.write");
	});

	it("sdk.ts does not import chalk (no styled stderr output)", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		expect(src).not.toContain("import chalk");
	});
});

// ─── F5 XC Context Auto-Loading ───────────────────────────────────────────

describe("F5 XC context auto-loading at CLI startup (PR #69)", () => {
	it("main.ts imports and calls ContextService at startup", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/main.ts"), "utf8");
		expect(src).toContain("xcsh-context");
		expect(src).toContain("ContextService.init");
		expect(src).toContain("loadActive");
	});

	it("main.ts imports getXCSHConfigDir for context directory", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/main.ts"), "utf8");
		expect(src).toContain("getXCSHConfigDir");
	});

	it("xcsh-context-command.ts does NOT reimplement XDG_CONFIG_HOME derivation", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/services/xcsh-context-command.ts"), "utf8");
		expect(src).not.toContain("XDG_CONFIG_HOME");
	});
});

// ─── ContextService Obfuscator Integration ────────────────────────────────

describe("ContextService obfuscator integration (PR #77)", () => {
	it("sdk.ts collects context-sensitive values for obfuscator", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		expect(src).toContain("getSensitiveContextValues");
	});

	it("sdk.ts registers context-change listener to refresh obfuscator secrets", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		expect(src).toContain("onContextChange");
		expect(src).toContain("addPlainSecrets");
	});

	it("sdk.ts passes additionalValues to obfuscator constructor", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		expect(src).toContain("additionalValues");
	});
});

// ─── LiteLLM Integration ─────────────────────────────────────────────────

describe("LiteLLM integration (PRs #51, #60, #63, #85)", () => {
	it("sdk.ts awaits LiteLLM discovery on first run", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/sdk.ts"), "utf8");
		expect(src).toContain("hasLiteLLMEnv");
		expect(src).toContain("awaitBackgroundRefresh");
		expect(src).toContain("hasUncachedDiscoverableProviders");
	});

	it("model-registry.ts has awaitBackgroundRefresh method", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/model-registry.ts"), "utf8");
		expect(src).toContain("awaitBackgroundRefresh");
		expect(src).toContain("hasUncachedDiscoverableProviders");
	});

	it("model-registry.ts probes LiteLLM config on first refresh", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/model-registry.ts"), "utf8");
		expect(src).toContain("probeAndUpgradeLiteLLMConfig");
		expect(src).toContain("startupHealthCheck");
	});

	it("selector-controller.ts has LiteLLM login handler (PR #85)", async () => {
		const src = await fs.readFile(
			path.join(import.meta.dir, "../src/modes/controllers/selector-controller.ts"),
			"utf8",
		);
		expect(src).toContain("handleLiteLLMLogin");
		expect(src).toContain("loginLiteLLM");
	});

	it("selector-controller.ts integrates GutterBlock unwrapping (PR #86)", async () => {
		const src = await fs.readFile(
			path.join(import.meta.dir, "../src/modes/controllers/selector-controller.ts"),
			"utf8",
		);
		expect(src).toContain("GutterBlock");
	});

	it("selector-controller.ts syncs separator when preset changes (PR #76)", async () => {
		const src = await fs.readFile(
			path.join(import.meta.dir, "../src/modes/controllers/selector-controller.ts"),
			"utf8",
		);
		expect(src).toContain("getPreset");
	});
});

// ─── Upstream PR #721 — Anthropic LiteLLM Passthrough ────────────────────

describe("Anthropic auth litellm passthrough (upstream PR #721)", () => {
	it("anthropic-auth.ts has Tier 6 litellm passthrough", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../ai/src/utils/anthropic-auth.ts"), "utf8");
		expect(src).toContain("LITELLM_BASE_URL");
		expect(src).toContain("LITELLM_API_KEY");
	});

	it("anthropic-auth.ts wraps DB open in try/catch for resilience", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../ai/src/utils/anthropic-auth.ts"), "utf8");
		expect(src).toContain("storeError");
	});

	it("provider chain isAvailable() calls are wrapped in try/catch", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/web/search/provider.ts"), "utf8");
		// Should have multiple try/catch blocks around isAvailable() calls
		const catchCount = (src.match(/} catch \{/g) ?? []).length;
		expect(catchCount).toBeGreaterThanOrEqual(2);
	});
});

// ─── LiteLLM openai-compat discovery schema ───────────────────────────────

describe("LiteLLM openai-compat discovery schema (blocks xcsh startup for proxy users)", () => {
	// When auto-config.ts generates models.yml it writes discovery.type: openai-compat.
	// If the schema removes this literal, every LiteLLM user gets a startup error.
	// This guard caught a regression introduced in the v17 rebase.
	it("model-registry.ts schema includes openai-compat as valid discovery type", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/model-registry.ts"), "utf8");
		expect(src).toContain('Type.Literal("openai-compat")');
	});

	it("model-registry.ts has #discoverOpenAICompatModels method", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/model-registry.ts"), "utf8");
		expect(src).toContain("#discoverOpenAICompatModels");
	});

	it('model-registry.ts switch routes case "openai-compat" to discovery method', async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/model-registry.ts"), "utf8");
		expect(src).toContain('case "openai-compat":');
		expect(src).toContain("return this.#discoverOpenAICompatModels(providerConfig);");
	});

	it("auto-config.ts generates discovery.type: openai-compat (must stay in sync with schema)", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/auto-config.ts"), "utf8");
		// If this fails, the generated models.yml would write a type the schema rejects
		expect(src).toContain("type: openai-compat");
	});
});

// ─── CI verify-npm-install backoff ────────────────────────────────────────

describe("CI verify-npm-install uses version-pinned install with backoff (PR #93)", () => {
	it("ci.yml pins specific version in verify-npm-install step", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../../.github/workflows/ci.yml"), "utf8");
		// Must install @f5xc-salesdemos/xcsh@<version> — specific version, not latest
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal string match against YAML content
		expect(src).toContain('"@f5xc-salesdemos/xcsh@${expected}"');
	});

	it("ci.yml verify step uses EXPECTED_VERSION from github.ref_name", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../../.github/workflows/ci.yml"), "utf8");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal string match against YAML content
		expect(src).toContain("EXPECTED_VERSION: ${{ github.ref_name }}");
	});
});

describe("vim ex-command onUpdate throttle bypass (commit 8f5b630ac)", () => {
	it("vim.ts onKbdStep forces update when engine.inputMode is command or search mode", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/vim.ts"), "utf8");
		// Without these checks, all three prompt input modes throttle at 16ms and drop keystrokes
		expect(src).toContain('engine.inputMode === "command"');
		expect(src).toContain('engine.inputMode === "search-forward"');
		expect(src).toContain('engine.inputMode === "search-backward"');
	});

	it("vim.ts emitUpdate is called with a truthy force flag in prompt input modes", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/tools/vim.ts"), "utf8");
		// forcePrompt bypasses the FRAME_INTERVAL_MS throttle — must be passed to emitUpdate
		expect(src).toContain("const forcePrompt =");
		expect(src).toContain("emitUpdate(forcePrompt)");
	});
});

describe("TUI isMultiplexer late-binding function for test isolation (commit be6d33f98)", () => {
	it("tui.ts defines isMultiplexer as a function not a const", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../tui/src/tui.ts"), "utf8");
		// const isMultiplexer evaluates at import time — tests clearing TMUX/STY/ZELLIJ still see true
		// function isMultiplexer() re-reads process.env on every call, enabling proper test isolation
		expect(src).toContain("function isMultiplexer()");
		expect(src).not.toContain("const isMultiplexer =");
	});

	it("tui.ts calls isMultiplexer() with parentheses at every usage site", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../../tui/src/tui.ts"), "utf8");
		// Every reference must be a call — bare reference re-introduces the eager-evaluation bug
		const allRefs = (src.match(/isMultiplexer/g) ?? []).length;
		const callRefs = (src.match(/isMultiplexer\(\)/g) ?? []).length;
		expect(callRefs).toBe(allRefs);
	});
});

// ─── Provider registration: env var name must not leak as Bearer token ────

describe("Provider registration: env var fallback must not send literal name (PR #104)", () => {
	it("welcome-checks.ts detects unresolved env var names (prevents false connected status)", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/modes/components/welcome-checks.ts"), "utf8");
		expect(src).toContain("Detect unresolved env var names");
	});

	it("autoFixModelsConfig calls readApiKeyLiteral to preserve literal keys", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/auto-config.ts"), "utf8");
		expect(src).toContain("readApiKeyLiteral");
	});

	it("probeAndUpgradeLiteLLMConfig preserves literal keys during upgrade", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/config/auto-config.ts"), "utf8");
		// probeAndUpgradeLiteLLMConfig must use readApiKeyLiteral or apiKeyLiteral
		const probeSection = src.slice(src.indexOf("probeAndUpgradeLiteLLMConfig"));
		expect(probeSection).toContain("apiKeyLiteral");
	});
});

// ─── Statusline CWD Tracking (#118, #120) ─────────────────────────────────

describe("statusline tracks assistant cwd, not global shellPwd (PR #120 regression, #118)", () => {
	it("status-line.ts owns a #cwd field initialized from session.cwd, not a stale global", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/modes/components/status-line.ts"), "utf8");
		// The component must declare #cwd as a typed field (not inline-initialized from a global)
		expect(src).toContain("#cwd: string;");
		// Constructor must initialize #cwd from the session's authoritative cwd
		expect(src).toContain("session.sessionManager?.getCwd() ?? getShellPwd()");
		// #buildSegmentContext must use the instance field, not the global
		expect(src).toContain("cwd: this.#cwd");
	});

	it("status-line.ts exposes setCwd for callers without an event bus", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/modes/components/status-line.ts"), "utf8");
		expect(src).toContain("setCwd(cwd: string): void");
	});

	it("watchCwd captures the cwd:changed event payload into #cwd", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/modes/components/status-line.ts"), "utf8");
		// The handler must read the event value and store it
		expect(src).toContain('eventBus.on("cwd:changed", newCwd =>');
		expect(src).toContain("this.#cwd = newCwd");
	});

	it("command-controller.ts uses setCwd instead of invalidate for cwd changes", async () => {
		const src = await fs.readFile(
			path.join(import.meta.dir, "../src/modes/controllers/command-controller.ts"),
			"utf8",
		);
		expect(src).toContain("this.ctx.statusLine.setCwd(result.newCwd)");
	});

	it("command-controller.ts /move handler syncs shellPwd and statusLine cwd", async () => {
		const src = await fs.readFile(
			path.join(import.meta.dir, "../src/modes/controllers/command-controller.ts"),
			"utf8",
		);
		// /move must sync the global shellPwd so getShellPwd() stays current
		expect(src).toContain("setShellPwd(resolvedPath)");
		// /move must update the statusline's #cwd directly
		expect(src).toContain("this.ctx.statusLine.setCwd(resolvedPath)");
	});

	it("status-line.ts git queries resolve against this.#cwd, not getShellPwd()", async () => {
		const src = await fs.readFile(path.join(import.meta.dir, "../src/modes/components/status-line.ts"), "utf8");
		// All git call sites must use the instance cwd, not the global
		expect(src).toContain("git.repo.resolveSync(this.#cwd)");
		expect(src).toContain("git.head.resolveSync(this.#cwd)");
		expect(src).toContain("git.branch.default(this.#cwd)");
		expect(src).toContain("queryGitStatus(this.#cwd)");
		expect(src).toContain("git.status.summary(this.#cwd)");
		expect(src).toContain(".cwd(this.#cwd)");
	});
});
