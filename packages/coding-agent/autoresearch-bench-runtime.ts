/**
 * autoresearch-bench-runtime.ts — Measures ACTUAL execution time of intelligence
 * gathering functions. NOT template chars — real wall-clock subprocess performance.
 *
 * Run: bun packages/coding-agent/autoresearch-bench-runtime.ts
 */
import { collectInstant, seedComputerProfile } from "./src/internal-urls/computer-profile";
import { loadSalesforceContext, seedSalesforceContext } from "./src/internal-urls/salesforce-context";
import { loadProfile } from "./src/internal-urls/user-profile";

const fmt = (ms: number) => `${ms.toFixed(0)}ms`;

console.log("=== RUNTIME BENCHMARK: Intelligence Gathering ===\n");

// --- 1. collectInstant() — sync os module calls ---
const t0 = performance.now();
const instantData = collectInstant();
const instantMs = performance.now() - t0;
console.log(`collectInstant():        ${fmt(instantMs)}`);
console.log(
	`  platform=${instantData.platform} arch=${instantData.architecture} ram=${instantData.totalMemoryGB}GB cpu=${instantData.cpuModel}`,
);

// --- 2. seedComputerProfile() — full collection with subprocesses ---
const t1 = performance.now();
const computerProfile = await seedComputerProfile();
const computerMs = performance.now() - t1;
console.log(`\nseedComputerProfile():   ${fmt(computerMs)}`);
console.log(
	`  machineModel=${computerProfile.machineModel} cores=${computerProfile.cpuPhysicalCores}/${computerProfile.cpuLogicalCores}`,
);
console.log(
	`  management.isManaged=${computerProfile.management?.isManaged} mdmVendor=${computerProfile.management?.mdmVendor}`,
);
console.log(
	`  security.sipEnabled=${computerProfile.security?.sipEnabled} fileVault=${computerProfile.security?.fileVaultEnabled} admin=${computerProfile.security?.isAdmin}`,
);
console.log(`  endpointAgents=${computerProfile.endpointAgents?.length ?? 0}`);
console.log(
	`  installedTools=${computerProfile.installedTools?.length ?? 0} (${computerProfile.installedTools?.join(", ")})`,
);
console.log(`  diskFree=${computerProfile.diskFree}`);

// --- 3. loadProfile() — file read for userId ---
const t2 = performance.now();
const profile = await loadProfile();
const profileMs = performance.now() - t2;
console.log(`\nloadProfile():           ${fmt(profileMs)}`);
console.log(`  salesforceId=${profile.identifiers?.salesforceId ? "present" : "missing"}`);

// --- 4. seedSalesforceContext() — 8 parallel SOQL probes ---
const t3 = performance.now();
const sfContext = await seedSalesforceContext();
const sfMs = performance.now() - t3;
console.log(`\nseedSalesforceContext():  ${fmt(sfMs)}`);
if (sfContext) {
	console.log(`  userId=${sfContext.userId ? "present" : "missing"} username=${sfContext.username}`);
	console.log(`  territories=${sfContext.territories?.length ?? 0}`);
	console.log(`  activeAccounts=${sfContext.activeAccounts?.length ?? 0}`);
	console.log(`  productSegmentations=${sfContext.productSegmentations?.length ?? 0}`);
	console.log(`  forecastCategories=${sfContext.forecastCategories?.length ?? 0}`);
	console.log(`  stages=${sfContext.stages?.length ?? 0}`);
	console.log(`  team=${sfContext.team?.length ?? 0}`);
	console.log(
		`  pipelineTotal=$${((sfContext.pipelineSummary?.total ?? 0) / 1_000_000).toFixed(1)}M (${sfContext.pipelineSummary?.dealCount ?? 0} deals)`,
	);
	console.log(
		`  customFields: trueAcv=${sfContext.customFields?.trueAcv} territory=${sfContext.customFields?.territory}`,
	);
} else {
	console.log("  SKIPPED (sf CLI not available or no salesforceId)");
}

// --- 5. loadSalesforceContext() — cache read (what startup actually does) ---
const t4 = performance.now();
const _cachedSf = await loadSalesforceContext();
const cacheReadMs = performance.now() - t4;
console.log(`\nloadSalesforceContext():  ${fmt(cacheReadMs)} (cache read — this is what startup costs)`);

// --- 6. loadComputerProfile() — cache read ---
const { loadComputerProfile } = await import("./src/internal-urls/computer-profile");
const t5 = performance.now();
const _cachedComputer = await loadComputerProfile();
const computerCacheMs = performance.now() - t5;
console.log(`loadComputerProfile():   ${fmt(computerCacheMs)} (cache read — this is what startup costs)`);

// --- Summary ---
const totalBackground = computerMs + sfMs;
const totalStartup = profileMs + cacheReadMs + computerCacheMs;
console.log("\n=== SUMMARY ===");
console.log(`  Background seed total:  ${fmt(totalBackground)} (runs fire-and-forget, does NOT block startup)`);
console.log(`    seedComputerProfile:  ${fmt(computerMs)}`);
console.log(`    seedSalesforceContext: ${fmt(sfMs)}`);
console.log(`  Startup cache reads:    ${fmt(totalStartup)} (this IS on the critical path)`);
console.log(`    loadProfile:          ${fmt(profileMs)}`);
console.log(`    loadComputerProfile:  ${fmt(computerCacheMs)}`);
console.log(`    loadSalesforceContext: ${fmt(cacheReadMs)}`);
console.log(`  collectInstant (sync):  ${fmt(instantMs)}`);
