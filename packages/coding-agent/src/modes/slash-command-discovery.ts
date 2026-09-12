import * as path from "node:path";
import type { SlashCommand } from "@f5-sales-demo/pi-tui";

export type SlashCommandBehavior = "execution" | "prompt expansion";
export type SlashCommandScope = "native" | "session" | "project" | "user" | "path";

export interface SlashCommandDiscoveryCandidate extends SlashCommand {
	discovery: {
		behavior: SlashCommandBehavior;
		provenance: string;
		scope: SlashCommandScope;
		/** Human-readable identities already shadowed within this source. */
		shadowed?: string[];
	};
}

function describeIdentity(candidate: SlashCommandDiscoveryCandidate): string {
	return `${candidate.discovery.provenance} (${candidate.discovery.scope} ${candidate.discovery.behavior})`;
}

function describeCandidate(candidate: SlashCommandDiscoveryCandidate, shadowed: readonly string[]): string {
	const base = candidate.description?.trim();
	const metadata = `${candidate.discovery.behavior === "execution" ? "Execution" : "Prompt expansion"} · ${candidate.discovery.scope} scope`;
	const shadowing = shadowed.length > 0 ? ` · shadows ${shadowed.join(", ")}` : "";
	return `${metadata}${shadowing} · ${candidate.discovery.provenance}${base ? ` · ${base}` : ""}`;
}

/**
 * Resolve the same precedence the runtime uses and retain the losing identities
 * in the visible winner. Autocomplete therefore has one unambiguous row per
 * command name instead of several identical labels with different behavior.
 */
export function resolveSlashCommandDiscovery(candidates: readonly SlashCommandDiscoveryCandidate[]): SlashCommand[] {
	const winners = new Map<string, { candidate: SlashCommandDiscoveryCandidate; shadowed: string[] }>();

	for (const candidate of candidates) {
		const winner = winners.get(candidate.name);
		if (!winner) {
			winners.set(candidate.name, {
				candidate,
				shadowed: [...(candidate.discovery.shadowed ?? [])],
			});
			continue;
		}
		winner.shadowed.push(describeIdentity(candidate), ...(candidate.discovery.shadowed ?? []));
	}

	return [...winners.values()].map(({ candidate, shadowed }) => ({
		name: candidate.name,
		description: describeCandidate(candidate, shadowed),
		...(candidate.getArgumentCompletions ? { getArgumentCompletions: candidate.getArgumentCompletions } : {}),
		...(candidate.getInlineHint ? { getInlineHint: candidate.getInlineHint } : {}),
	}));
}

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/** Infer extension scope without changing the first- or third-party plugin API. */
export function inferSlashCommandScope(sourcePath: string, cwd: string, home: string): SlashCommandScope {
	if (/^(?:bundled|native):/.test(sourcePath)) return "native";
	if (!path.isAbsolute(sourcePath)) return "path";
	if (isInside(cwd, sourcePath)) return "project";
	if (isInside(home, sourcePath)) return "user";
	return "path";
}
