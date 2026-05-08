/**
 * autoresearch-measure-live.ts — Renders the system prompt with REAL cached data
 * from ~/.xcsh/ instead of fake fixtures. Shows exactly what the LLM sees.
 *
 * Run: bun packages/coding-agent/autoresearch-measure-live.ts
 */
import * as path from "node:path";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { registerCodingAgentPromptHelpers } from "./src/config/prompt-templates";
import { buildComputerHint, loadComputerProfile } from "./src/internal-urls/computer-profile";
import { buildSalesforceHint, loadSalesforceContext } from "./src/internal-urls/salesforce-context";
import { loadProfile } from "./src/internal-urls/user-profile";

registerCodingAgentPromptHelpers();

const templatePath = path.resolve(import.meta.dir, "src/prompts/system/system-prompt.md");
const template = await Bun.file(templatePath).text();

// Load REAL cached data
const profile = await loadProfile();
const computerProfile = await loadComputerProfile();
const sfContext = await loadSalesforceContext();

// Build hints from real data
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

const computerHint = buildComputerHint(computerProfile) ?? undefined;
const salesforceHint = buildSalesforceHint(sfContext) ?? undefined;

// Base context (minimal — just enough for template to render)
const baseContext = {
	agentsMdSearch: { files: [] },
	appendPrompt: "",
	contextFiles: [],
	cwd: process.cwd(),
	date: new Date().toISOString().slice(0, 10),
	dateTime: new Date().toISOString().slice(0, 10),
	environment: [{ label: "OS", value: process.platform }],
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

// Render with real data
const rendered = prompt.render(template, {
	...baseContext,
	userProfile,
	computerProfile: computerHint,
	salesforceHint,
});

const withoutHints = prompt.render(template, baseContext);
const totalOverhead = rendered.length - withoutHints.length;

console.log("=== LIVE SYSTEM PROMPT MEASUREMENT (real cache data) ===\n");

// Show what the LLM actually sees for each hint
let cumulativeBase = withoutHints.length;

if (userProfile) {
	const withUser = prompt.render(template, { ...baseContext, userProfile });
	const userOverhead = withUser.length - withoutHints.length;
	cumulativeBase = withUser.length;
	console.log(`User hint:       ${userOverhead} chars (~${Math.ceil(userOverhead / 4)} tokens)`);
	console.log(`  Name: ${userProfile.name}, Role: ${userProfile.role}, Org: ${userProfile.org}`);
}

if (computerHint) {
	const withComputer = prompt.render(template, { ...baseContext, userProfile, computerProfile: computerHint });
	const computerOverhead = withComputer.length - cumulativeBase;
	cumulativeBase = withComputer.length;
	console.log(`Computer hint:   ${computerOverhead} chars (~${Math.ceil(computerOverhead / 4)} tokens)`);
	console.log(
		`  ${computerHint.ramGB}GB RAM, ${computerHint.cpu}, ${computerHint.os}, managed=${computerHint.managed}, admin=${computerHint.admin}`,
	);
}

if (salesforceHint) {
	const sfOverhead = rendered.length - cumulativeBase;
	console.log(`Salesforce hint: ${sfOverhead} chars (~${Math.ceil(sfOverhead / 4)} tokens)`);
	console.log(
		`  ${salesforceHint.dealCount} deals, ${salesforceHint.pipelineTotal} pipeline, ${salesforceHint.accountCount} accounts`,
	);
	if (salesforceHint.territories) console.log(`  Territories: ${salesforceHint.territories}`);
	if (salesforceHint.forecastBreakdown) console.log(`  Forecast: ${salesforceHint.forecastBreakdown}`);
	if (salesforceHint.partnerName)
		console.log(`  Partner: ${salesforceHint.partnerName} (${salesforceHint.partnerRole})`);
}

console.log("");
console.log(`METRIC live_total_prompt_chars=${rendered.length}`);
console.log(`METRIC live_total_overhead_chars=${totalOverhead}`);
console.log(`METRIC live_total_overhead_tokens=~${Math.ceil(totalOverhead / 4)}`);
console.log(`METRIC live_total_prompt_tokens=~${Math.ceil(rendered.length / 4)}`);

// Verify hints are actually present in rendered output
const checks = [
	["## Primary Human", rendered.includes("## Primary Human")],
	["xcsh://computer", rendered.includes("xcsh://computer")],
	["xcsh://salesforce", rendered.includes("xcsh://salesforce")],
] as const;

console.log("\n--- HINT PRESENCE CHECKS ---");
for (const [label, ok] of checks) {
	console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}`);
}
