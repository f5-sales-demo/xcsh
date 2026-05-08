/**
 * autoresearch-e2e-prompt.ts — Exercises the REAL buildSystemPrompt() codepath
 * with real cached data. This is the same function that bun dev calls on every turn.
 *
 * Unlike autoresearch-measure.ts (fake data, template only) or
 * autoresearch-measure-live.ts (real data, template only), this calls
 * buildSystemPrompt() from system-prompt.ts — the actual export that
 * sdk.ts → rebuildSystemPrompt() uses in production.
 *
 * Run: bun packages/coding-agent/autoresearch-e2e-prompt.ts
 */

import { registerCodingAgentPromptHelpers } from "./src/config/prompt-templates";
import { buildComputerHint, type ComputerHint, loadComputerProfile } from "./src/internal-urls/computer-profile";
import {
	buildSalesforceHint,
	loadSalesforceContext,
	type SalesforceHint,
} from "./src/internal-urls/salesforce-context";
import { loadProfile, type UserProfile } from "./src/internal-urls/user-profile";
import { buildSystemPrompt } from "./src/system-prompt";

registerCodingAgentPromptHelpers();

const t0 = performance.now();

// --- Load real cached data (same path as sdk.ts rebuildSystemPrompt) ---
const profile: UserProfile = await loadProfile().catch(() => ({}) as UserProfile);
let userProfile: { name: string; role: string; org: string } | undefined;
if (profile.givenName || profile.familyName) {
	const name = [profile.givenName, profile.familyName].filter(Boolean).join(" ");
	if (name) {
		userProfile = {
			name,
			role: profile.jobTitle ?? "",
			org: profile.worksFor?.name ?? "",
		};
	}
}

let computerProfile: ComputerHint | undefined;
try {
	const cp = await loadComputerProfile();
	computerProfile = buildComputerHint(cp) ?? undefined;
} catch {
	// No computer profile
}

let salesforceHint: SalesforceHint | undefined;
try {
	const sfCtx = await loadSalesforceContext();
	salesforceHint = buildSalesforceHint(sfCtx, profile) ?? undefined;
} catch {
	// No SF context
}

const loadMs = performance.now() - t0;

// --- Build actual system prompt via the real codepath ---
const t1 = performance.now();
const systemPrompt = await buildSystemPrompt({
	cwd: process.cwd(),
	userProfile,
	computerProfile,
	salesforceHint,
});
const buildMs = performance.now() - t1;

console.log("=== E2E SYSTEM PROMPT VERIFICATION ===\n");
console.log(`Cache load:  ${loadMs.toFixed(0)}ms`);
console.log(`Prompt build: ${buildMs.toFixed(0)}ms`);
console.log(`Prompt size:  ${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);
console.log("");

// --- Verify hint blocks are present in the ACTUAL output ---
const checks: Array<[string, boolean, string]> = [
	["User hint", systemPrompt.includes("## Primary Human"), ""],
	["User name", !!userProfile && systemPrompt.includes(userProfile.name), userProfile?.name ?? "N/A"],
	["Computer hint", systemPrompt.includes("xcsh://computer"), ""],
	["Admin status", systemPrompt.includes("not admin") || systemPrompt.includes("Admin"), ""],
	["Security agents", systemPrompt.includes("agents"), ""],
	["SF hint", systemPrompt.includes("xcsh://salesforce"), ""],
	[
		"Forecast data",
		systemPrompt.includes("Commit") || systemPrompt.includes("Best") || systemPrompt.includes("Pipe"),
		"",
	],
	[
		"Partner",
		systemPrompt.includes("AE:") ||
			systemPrompt.includes("SE:") ||
			systemPrompt.includes("CSM:") ||
			systemPrompt.includes("Partner:"),
		"",
	],
];

let failures = 0;
console.log("--- HINT PRESENCE IN REAL SYSTEM PROMPT ---");
for (const [label, ok, detail] of checks) {
	const status = ok ? "PASS" : "FAIL";
	if (!ok) failures++;
	const extra = detail ? ` (${detail})` : "";
	console.log(`  ${status}: ${label}${extra}`);
}

// --- Extract and display actual hint lines ---
console.log("\n--- ACTUAL HINT LINES (from built system prompt) ---");
for (const line of systemPrompt.split("\n")) {
	if (line.includes("## Primary Human")) {
		// Print this line and the next 2
		const idx = systemPrompt.indexOf(line);
		const block = systemPrompt.slice(idx, systemPrompt.indexOf("\n\n", idx + 1));
		console.log(block.trim());
		console.log("");
	}
	if (line.includes("xcsh://computer")) {
		console.log(line.trim());
		console.log("");
	}
	if (line.includes("xcsh://salesforce")) {
		console.log(line.trim());
		console.log("");
	}
}

// --- Verdict ---
console.log("--- VERDICT ---");
if (failures > 0) {
	console.log(`FAIL: ${failures} hint check(s) missing from the real system prompt`);
	process.exit(1);
} else {
	console.log("PASS: All hints present in the real buildSystemPrompt() output");
}
