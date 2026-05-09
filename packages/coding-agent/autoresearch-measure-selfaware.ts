/**
 * autoresearch-measure-selfaware.ts
 *
 * Measures version self-awareness accuracy across all surfaces:
 * - renderAboutDoc() guidance (anti-patterns + positive patterns)
 * - System prompt template routing (workstation header → version)
 * - Version chain consistency (BUILD_INFO == package.json == workstation)
 *
 * Primary metric: self_awareness_score (0-100, higher is better)
 */

import * as fs from "node:fs";
import { BUILD_INFO } from "./src/internal-urls/build-info.generated";
import { renderAboutDoc, resolveRuntimeBuildInfo } from "./src/internal-urls/build-info-runtime";

// ─── Layer 1: renderAboutDoc() guidance ───

const info = await resolveRuntimeBuildInfo(BUILD_INFO, {
	isCompiled: false,
	gitAvailable: () => false,
	git: async () => "",
	now: () => new Date(),
});

const doc = renderAboutDoc(info, null);
const docLower = doc.toLowerCase();

let score = 100;
let antiPatterns = 0;
let positivePatterns = 0;
const notes: string[] = [];

// AP1: Recommends `xcsh --version` in a positive context (-30)
const versionIdx = doc.indexOf("xcsh --version");
if (versionIdx !== -1) {
	const contextBefore = doc.slice(Math.max(0, versionIdx - 60), versionIdx).toLowerCase();
	const isWarning =
		contextBefore.includes("do not") || contextBefore.includes("never") || contextBefore.includes("don't");
	if (!isWarning) {
		score -= 30;
		antiPatterns++;
		notes.push("AP1: recommends `xcsh --version` (checks installed binary, not running session)");
	}
}

// AP2: "if unsure" about version (-5)
if (docLower.includes("if unsure") && docLower.includes("version")) {
	score -= 5;
	antiPatterns++;
	notes.push("AP2: expresses uncertainty about the embedded version");
}

// AP3: "confirm the user is running" via external command (-5)
if (docLower.includes("confirm the user is running") && doc.includes("xcsh --version")) {
	score -= 5;
	antiPatterns++;
	notes.push("AP3: tells LLM to confirm version via external command");
}

// PP1: BUILD_INFO.version in the doc
if (doc.includes(BUILD_INFO.version)) {
	positivePatterns++;
} else {
	score -= 10;
	notes.push("PP1: BUILD_INFO.version not found in rendered doc");
}

// PP2: Explains version is embedded/intrinsic
if (
	docLower.includes("embedded") ||
	docLower.includes("intrinsic") ||
	docLower.includes("baked") ||
	docLower.includes("build time") ||
	docLower.includes("build-time")
) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP2: does not explain version is embedded/intrinsic");
}

// PP3: Warns about installed vs running discrepancy
if (
	(docLower.includes("installed") || docLower.includes("binary")) &&
	(docLower.includes("running") || docLower.includes("session"))
) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP3: does not distinguish installed binary from running session");
}

// PP4: References the workstation header
if (docLower.includes("workstation")) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP4: does not reference the workstation header");
}

// PP5: Marks version as authoritative
if (docLower.includes("authoritative") || (docLower.includes("source of truth") && docLower.includes("version"))) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP5: does not mark the embedded version as authoritative");
}

// PP6: Warns against xcsh --version
if (docLower.includes("do not run") && doc.includes("xcsh --version")) {
	positivePatterns++;
} else if (doc.includes("xcsh --version") && (docLower.includes("do not") || docLower.includes("never"))) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP6: does not warn against using xcsh --version");
}

// ─── Layer 2: System prompt template routing ───

const template = fs.readFileSync("packages/coding-agent/src/prompts/system/system-prompt.md", "utf-8");
const templateLower = template.toLowerCase();

// PP7: System prompt directs version questions to workstation header (-5 if missing)
const hasVersionRouting =
	(templateLower.includes("version") && templateLower.includes("workstation")) ||
	(templateLower.includes("running version") && templateLower.includes("workstation"));
if (hasVersionRouting) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP7: system prompt does not route version questions to workstation header");
}

// PP8: System prompt xcsh://about description clarifies when to use it vs workstation
const aboutSection = template.slice(template.indexOf("xcsh://about"), template.indexOf("xcsh://about") + 500);
const aboutSectionLower = aboutSection.toLowerCase();
const hasRoutingClarity =
	aboutSectionLower.includes("workstation") ||
	aboutSectionLower.includes("already") ||
	aboutSectionLower.includes("simple version");
if (hasRoutingClarity) {
	positivePatterns++;
} else {
	score -= 5;
	notes.push("PP8: xcsh://about section does not clarify version routing (workstation for version, about for deeper)");
}

// ─── Layer 2b: Capabilities completeness ───

// Extract the capabilities section from the rendered about doc
const capStart = doc.indexOf("## Capabilities");
const capEnd = doc.indexOf("##", capStart + 1);
const capSection = capStart !== -1 ? doc.slice(capStart, capEnd !== -1 ? capEnd : undefined).toLowerCase() : "";

// PP9: Capabilities mention Salesforce/pipeline integration
if (capSection.includes("salesforce") || capSection.includes("pipeline")) {
	positivePatterns++;
} else {
	score -= 4;
	notes.push("PP9: capabilities section omits Salesforce/pipeline integration");
}

// PP10: Capabilities mention F5 XC API integration
if (capSection.includes("f5 xc api") || capSection.includes("xcsh_api") || capSection.includes("api catalog")) {
	positivePatterns++;
} else {
	score -= 4;
	notes.push("PP10: capabilities section omits F5 XC API integration");
}

// PP11: Capabilities mention user/computer profiling or xcsh:// protocols
if (capSection.includes("profil") || capSection.includes("xcsh://")) {
	positivePatterns++;
} else {
	score -= 4;
	notes.push("PP11: capabilities section omits user/computer profiling");
}

// PP12: Capabilities mention SE-specific agents
if (capSection.includes("agent") || capSection.includes("deal") || capSection.includes("subagent")) {
	positivePatterns++;
} else {
	score -= 3;
	notes.push("PP12: capabilities section omits SE-specific agents");
}

// ─── Layer 3: Version chain consistency ───

let versionChainOk = 1;
// Check BUILD_INFO.version vs package.json version
try {
	const pkgJson = JSON.parse(fs.readFileSync("packages/coding-agent/package.json", "utf-8")) as {
		version?: string;
	};
	if (pkgJson.version && pkgJson.version !== BUILD_INFO.version) {
		versionChainOk = 0;
		notes.push(`CHAIN: BUILD_INFO.version (${BUILD_INFO.version}) != package.json (${pkgJson.version})`);
	}
} catch {
	// package.json not found — skip
}

// Clamp score
score = Math.max(0, Math.min(100, score));

// Output structured metrics
console.log(`METRIC self_awareness_score=${score}`);
console.log(`METRIC anti_pattern_count=${antiPatterns}`);
console.log(`METRIC positive_pattern_count=${positivePatterns}`);
console.log(`METRIC version_chain_ok=${versionChainOk}`);
console.log("");
if (notes.length > 0) {
	console.log("Notes:");
	for (const n of notes) {
		console.log(`  - ${n}`);
	}
}
