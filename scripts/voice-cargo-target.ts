import { join, resolve } from "node:path";

/** Cargo overrides change the helper location; provenance must never select an old repo build. */
export function voiceHelperPath(repo: string, environment: Record<string, string | undefined>): string {
	return join(resolve(repo, environment.CARGO_TARGET_DIR || "target"), "release", "codex-voice-host");
}
