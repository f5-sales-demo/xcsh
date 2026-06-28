/**
 * Presentation profiles — named bundles of browser-behaviour axes the agent
 * picks per the human's intent. Pure + chrome-free; the runner consumes the
 * resolved axes. See docs/superpowers/specs/2026-06-28-presentation-profiles.md.
 */
export type ProfileName = "fast" | "guided" | "instructor" | "capture";

export interface ResolvedAxes {
	readonly paceMs: number;
	readonly annotations: boolean;
	readonly narration: "none" | "minimal" | "full";
	readonly capture: "off" | "per-step";
	readonly surface: "inherit" | "visible" | "headless";
}

export const PROFILES: Record<ProfileName, ResolvedAxes> = {
	fast: { paceMs: 0, annotations: false, narration: "none", capture: "off", surface: "inherit" },
	guided: { paceMs: 1500, annotations: true, narration: "minimal", capture: "off", surface: "visible" },
	instructor: { paceMs: 2200, annotations: true, narration: "full", capture: "off", surface: "visible" },
	capture: { paceMs: 800, annotations: true, narration: "minimal", capture: "per-step", surface: "headless" },
};

const DEFAULT_PROFILE: ProfileName = "fast";

export function isProfileName(v: unknown): v is ProfileName {
	return typeof v === "string" && Object.hasOwn(PROFILES, v);
}

/** Resolve axes. Precedence: per-run profile > session default > `fast`; then
 * per-axis overrides merge on top. */
export function resolveProfile(
	profile?: string,
	overrides?: Partial<ResolvedAxes>,
	sessionDefault?: string,
): ResolvedAxes {
	const name = isProfileName(profile) ? profile : isProfileName(sessionDefault) ? sessionDefault : DEFAULT_PROFILE;
	return { ...PROFILES[name], ...(overrides ?? {}) };
}
