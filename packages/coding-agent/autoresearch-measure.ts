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

// Render WITH profile AND computer profile (fake data — no PII)
const withComputerProfile = prompt.render(template, {
	...baseContext,
	userProfile: {
		name: "Ada Lovelace",
		role: "Mathematician",
		org: "Acme",
	},
	computerProfile: {
		ramGB: 32,
		cpu: "Test CPU 3000",
		os: "testOS 99.0",
		cores: 8,
		shell: "zsh",
		diskFree: "100GB",
		model: "TestModel/1",
		managed: true,
		admin: false,
		endpointAgentCount: 4,
	},
});

const computerHintOverhead = withComputerProfile.length - withProfile.length;

// Extract rendered computer hint for display
const computerHintIdx = withComputerProfile.indexOf("`xcsh://computer`");
if (computerHintIdx !== -1) {
	// Find the start of the line containing xcsh://computer
	const lineStart = withComputerProfile.lastIndexOf("\n", computerHintIdx) + 1;
	// Find the end of the block (next blank line or section)
	let hintBlockEnd = withComputerProfile.indexOf("\n\n", computerHintIdx);
	if (hintBlockEnd === -1) hintBlockEnd = withComputerProfile.length;
	const computerHintBlock = withComputerProfile.slice(lineStart, hintBlockEnd).trimEnd();

	console.log("");
	console.log("--- RENDERED COMPUTER HINT ---");
	console.log(computerHintBlock);
	console.log("--- END ---");
}

console.log(`METRIC rendered_computer_hint_chars=${computerHintOverhead}`);
console.log(`METRIC total_prompt_with_both=${withComputerProfile.length}`);

// Render WITH all three hints: user + computer + salesforce (fake data — no PII)
const withAllHints = prompt.render(template, {
	...baseContext,
	userProfile: {
		name: "Ada Lovelace",
		role: "Mathematician",
		org: "Acme",
	},
	computerProfile: {
		ramGB: 32,
		cpu: "Test CPU 3000",
		os: "testOS 99.0",
		cores: 8,
		shell: "zsh",
		diskFree: "100GB",
		model: "TestModel/1",
		managed: true,
		admin: false,
		endpointAgentCount: 4,
	},
	salesforceHint: {
		pipelineTotal: "$5.6M",
		dealCount: 42,
		accountCount: 20,
		territories: "AMER Canada, NA FinSvc Red, NA FinSvc Green",
		forecastBreakdown: "Commit $500K + Best $472K + Pipe $1.9M",
		partnerName: "Jane Partner",
		partnerRole: "AE",
	},
});

const salesforceHintOverhead = withAllHints.length - withComputerProfile.length;

// Extract rendered salesforce hint for display
const sfHintIdx = withAllHints.indexOf("`xcsh://salesforce`");
if (sfHintIdx !== -1) {
	const sfLineStart = withAllHints.lastIndexOf("\n", sfHintIdx) + 1;
	let sfHintEnd = withAllHints.indexOf("\n\n", sfHintIdx);
	if (sfHintEnd === -1) sfHintEnd = withAllHints.length;
	const sfHintBlock = withAllHints.slice(sfLineStart, sfHintEnd).trimEnd();

	console.log("");
	console.log("--- RENDERED SALESFORCE HINT ---");
	console.log(sfHintBlock);
	console.log("--- END ---");
}

console.log(`METRIC rendered_salesforce_hint_chars=${salesforceHintOverhead}`);
console.log(`METRIC total_prompt_with_all=${withAllHints.length}`);
console.log(`METRIC total_intelligence_overhead=${withAllHints.length - withoutProfile.length}`);

// Rough token estimation: ~4 chars per token for English technical text (cl100k_base average)
const CHARS_PER_TOKEN = 4;
function estimateTokens(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

console.log("");
console.log("--- TOKEN ESTIMATES (cl100k_base ~4 chars/token) ---");
console.log(`METRIC user_hint_tokens=${estimateTokens(hintOverheadChars)}`);
console.log(`METRIC computer_hint_tokens=${estimateTokens(computerHintOverhead)}`);
console.log(`METRIC sf_hint_tokens=${estimateTokens(salesforceHintOverhead)}`);
console.log(`METRIC total_intelligence_tokens=${estimateTokens(withAllHints.length - withoutProfile.length)}`);
console.log(`METRIC total_prompt_tokens=${estimateTokens(withAllHints.length)}`);
