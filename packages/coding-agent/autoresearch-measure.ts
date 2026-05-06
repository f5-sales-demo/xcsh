/**
 * autoresearch-measure.ts — Renders the actual system prompt template via the real
 * codepath and measures the exact character overhead of the userProfile hint.
 *
 * Run from repo root: bun packages/coding-agent/autoresearch-measure.ts
 *
 * Measurement: render with profile minus render without profile = exact LLM overhead.
 */
import * as path from "node:path";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { registerCodingAgentPromptHelpers } from "./src/config/prompt-templates";

registerCodingAgentPromptHelpers();

const templatePath = path.resolve(import.meta.dir, "src/prompts/system/system-prompt.md");
const template = await Bun.file(templatePath).text();

// Minimal render context matching the test fixtures
const baseContext = {
	agentsMdSearch: { files: [] },
	appendPrompt: "",
	contextFiles: [],
	cwd: "/tmp/bench",
	date: "2026-05-06",
	dateTime: "2026-05-06",
	environment: [{ label: "OS", value: "Darwin" }],
	skills: [],
	rules: [],
	alwaysApplyRules: [],
	toolInfo: [],
	tools: [],
	repeatToolDescriptions: false,
	intentTracing: false,
	intentField: "",
	mcpDiscoveryMode: false,
	hasMCPDiscoveryServers: false,
	mcpDiscoveryServerSummaries: [],
	eagerTasks: false,
	secretsEnabled: false,
};

// Render WITH profile (fake identity — no PII in source)
const withProfile = prompt.render(template, {
	...baseContext,
	userProfile: {
		name: "Ada Lovelace",
		role: "Mathematician",
		org: "Acme",
	},
});

// Render WITHOUT profile
const withoutProfile = prompt.render(template, baseContext);

// Exact hint overhead: the chars the LLM sees because profile is present
const hintOverheadChars = withProfile.length - withoutProfile.length;

// Extract rendered hint block for display: find "## Primary Human" in the rendered output
// and take everything up to the next blank-line-then-heading or separator boundary
const primaryHumanIdx = withProfile.indexOf("\n## Primary Human\n");
if (primaryHumanIdx === -1) {
	console.error("ERROR: ## Primary Human section not found in rendered output");
	process.exit(1);
}

// Scan forward to find where the hint ends — next \n## heading, or \n═, or \n#\n (standalone #)
const afterHeading = primaryHumanIdx + 1;
let hintEnd = withProfile.length;
const boundaries = ["\n## ", "\n═══", "\n<context>", "\n{{"];
for (const b of boundaries) {
	const idx = withProfile.indexOf(b, afterHeading + 20); // skip the heading itself
	if (idx !== -1 && idx < hintEnd) hintEnd = idx;
}

const hintBlock = withProfile.slice(afterHeading, hintEnd).trimEnd();

console.log("--- RENDERED HINT ---");
console.log(hintBlock);
console.log("--- END ---");
console.log("");
console.log(`METRIC rendered_hint_chars=${hintOverheadChars}`);
console.log(`METRIC total_prompt_with_profile=${withProfile.length}`);
console.log(`METRIC total_prompt_without_profile=${withoutProfile.length}`);
