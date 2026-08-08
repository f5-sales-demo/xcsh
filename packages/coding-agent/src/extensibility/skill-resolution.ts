import type { Skill } from "./skills";

export interface SkillMatchResult {
	skill: Skill;
	relativePath: string;
	suffix?: string;
}

/** Known plugin alias mappings for backwards compatibility (e.g. collapsed/renamed plugins) */
const PLUGIN_ALIASES: Record<string, string> = {
	"github-ops": "github",
	"f5xc-github-ops": "github",
};

/**
 * Match a raw skill path (from URL host + pathname) against registered skills.
 * Handles:
 * - Exact namespaced matches: "github:workflow-lifecycle"
 * - Slash-formatted namespaced matches: "github/workflow-lifecycle"
 * - Redundant SKILL.md paths: "github/workflow-lifecycle/SKILL.md" -> relativePath = ""
 * - Plugin aliases: "github-ops:workflow-lifecycle" -> "github:workflow-lifecycle"
 * - Colon-delimited line range suffixes: "github:workflow-lifecycle:1-10"
 * - Relative files: "github:workflow-lifecycle/scripts/run.sh"
 */
export function resolveSkillFromPath(
	rawHost: string,
	rawPathname: string,
	skills: readonly Skill[],
): SkillMatchResult | null {
	const rawCombined = rawHost + (rawPathname ? rawPathname : "");
	if (!rawCombined) return null;

	// Build key variants for each registered skill
	// Sorted by key length descending so longer skill names match first
	interface KeyEntry {
		key: string;
		skill: Skill;
	}
	const keyEntries: KeyEntry[] = [];

	for (const skill of skills) {
		const canonical = skill.name;
		keyEntries.push({ key: canonical, skill });

		// Slash version: "github:workflow-lifecycle" -> "github/workflow-lifecycle"
		if (canonical.includes(":")) {
			keyEntries.push({ key: canonical.replace(":", "/"), skill });
		}

		// Alias versions (e.g. github-ops -> github)
		for (const [alias, target] of Object.entries(PLUGIN_ALIASES)) {
			if (canonical.startsWith(`${target}:`)) {
				const aliasColon = canonical.replace(`${target}:`, `${alias}:`);
				const aliasSlash = canonical.replace(`${target}:`, `${alias}/`);
				keyEntries.push({ key: aliasColon, skill });
				keyEntries.push({ key: aliasSlash, skill });
			}
		}
	}

	// Sort key entries by length descending
	keyEntries.sort((a, b) => b.key.length - a.key.length);

	for (const entry of keyEntries) {
		if (rawCombined === entry.key) {
			return { skill: entry.skill, relativePath: "" };
		}

		if (rawCombined.startsWith(`${entry.key}/`) || rawCombined.startsWith(`${entry.key}:`)) {
			const sep = rawCombined[entry.key.length];
			let remainder = rawCombined.slice(entry.key.length + 1);

			if (sep === ":") {
				// Line range or colon suffix
				return { skill: entry.skill, relativePath: "", suffix: remainder };
			}

			// Sep is '/'
			if (remainder === "SKILL.md" || remainder === "SKILL.MD") {
				remainder = "";
			}
			return { skill: entry.skill, relativePath: remainder };
		}
	}

	return null;
}
