/**
 * The skill-source enable flags have TWO homes: the settings schema (what
 * `Settings.getGroup("skills")` hands `createAgentSession`) and `loadSkills`'s own
 * destructuring defaults (what a caller who passes no settings gets). They drifted —
 * the schema said `enableXcshUser: false` while `loadSkills` defaulted it to `true` —
 * so the same flag meant different things depending on the entry point.
 *
 * These tests pin the two together and pin the one value the marketplace depends on:
 * `xcsh plugin install` must actually load the plugin's skills, not just register it.
 */
import { describe, expect, it } from "bun:test";
import { getDefault } from "../src/config/settings-schema";
import { SKILL_SOURCE_DEFAULTS } from "../src/extensibility/skills";

describe("skill source defaults", () => {
	it("does not disable the marketplace provider", () => {
		// `disabledProviders` is the OUTER gate: `filterProviders` (capability/index.ts)
		// drops the whole provider before any skills flag is consulted, and it covers
		// slash commands and hooks too — not just skills. With `xcsh-plugins` listed
		// here, `skills.enableXcshPlugins: true` is dead configuration.
		expect(getDefault("disabledProviders")).not.toContain("xcsh-plugins");
	});

	it("loads marketplace plugin skills by default", () => {
		// `xcsh plugin install <p>` writes to ~/.xcsh/plugins and reports success. With
		// this false the install is a no-op for skills: the plugin is registered, its
		// SKILL.md files are on disk, and no session ever sees them.
		expect(getDefault("skills.enableXcshPlugins")).toBe(true);
	});

	it("keeps foreign-tool skill directories opt-in", () => {
		// These adopt ANOTHER tool's config directory (Claude's, Codex's) rather than
		// xcsh's own install mechanism, so they stay off until the operator asks.
		expect(getDefault("skills.enableCodexUser")).toBe(false);
		expect(getDefault("skills.enableXcshUser")).toBe(false);
		expect(getDefault("skills.enableXcshProject")).toBe(false);
	});

	it("agrees with the settings schema on every source flag", () => {
		// One source of truth. If a flag is added to SkillsSettings without a schema
		// entry (or vice versa), this fails rather than silently defaulting to `false`.
		expect(SKILL_SOURCE_DEFAULTS).toEqual({
			enabled: getDefault("skills.enabled"),
			enableCodexUser: getDefault("skills.enableCodexUser"),
			enableXcshUser: getDefault("skills.enableXcshUser"),
			enableXcshProject: getDefault("skills.enableXcshProject"),
			enableXcshPlugins: getDefault("skills.enableXcshPlugins"),
			enablePiUser: getDefault("skills.enablePiUser"),
			enablePiProject: getDefault("skills.enablePiProject"),
		});
	});
});
