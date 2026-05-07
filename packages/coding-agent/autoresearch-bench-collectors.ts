/**
 * autoresearch-bench-collectors.ts — Isolates timing of each individual collector
 * inside seedComputerProfile() to find the bottleneck.
 *
 * Run: bun packages/coding-agent/autoresearch-bench-collectors.ts
 */

import { $which } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";

const fmt = (ms: number) => `${ms.toFixed(0)}ms`;

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const t = performance.now();
	const result = await fn();
	const elapsed = performance.now() - t;
	const status = elapsed > 5000 ? "SLOW" : elapsed > 1000 ? "WARN" : "OK";
	console.log(`  [${status}] ${label}: ${fmt(elapsed)}`);
	return result;
}

console.log("=== COLLECTOR ISOLATION BENCHMARK ===\n");

console.log("--- Darwin platform probes ---");
await time("sysctl hw.model", () => $`sysctl -n hw.model`.quiet().nothrow());
await time("sysctl hw.physicalcpu", () => $`sysctl -n hw.physicalcpu`.quiet().nothrow());
await time("sw_vers -productVersion", () => $`sw_vers -productVersion`.quiet().nothrow());

console.log("\n--- Disk ---");
await time("df -P /", () => $`df -P /`.quiet().nothrow());

console.log("\n--- Management ---");
await time("profiles status -type enrollment", () => $`profiles status -type enrollment`.quiet().nothrow());
await time("jamf version", () => $`jamf version`.quiet().nothrow());
await time("/usr/libexec/mdmclient DumpManagementStatus", () =>
	$`/usr/libexec/mdmclient DumpManagementStatus`.quiet().nothrow(),
);

console.log("\n--- Security ---");
await time("csrutil status", () => $`csrutil status`.quiet().nothrow());
await time("fdesetup status", () => $`fdesetup status`.quiet().nothrow());
await time("spctl --status", () => $`spctl --status`.quiet().nothrow());
await time("socketfilterfw --getglobalstate", () =>
	$`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`.quiet().nothrow(),
);
await time("id -Gn", () => $`id -Gn`.quiet().nothrow());

console.log("\n--- Endpoint agents ---");
await time("systemextensionsctl list", () => $`systemextensionsctl list`.quiet().nothrow());

console.log("\n--- Installed tools ($which) ---");
const tools = [
	"git",
	"docker",
	"kubectl",
	"terraform",
	"python3",
	"node",
	"go",
	"rustc",
	"java",
	"az",
	"gcloud",
	"aws",
	"sf",
	"gh",
	"glab",
];
const t0 = performance.now();
for (const tool of tools) {
	$which(tool);
}
console.log(
	`  [${performance.now() - t0 > 1000 ? "SLOW" : "OK"}] $which x${tools.length}: ${fmt(performance.now() - t0)}`,
);

console.log("\n--- Salesforce probes ---");
await time("sf org display --json", () => $`sf org display --json`.quiet().nothrow());
await time("sf sobject describe --sobject Opportunity --json", () =>
	$`sf sobject describe --sobject Opportunity --json`.quiet().nothrow(),
);
await time("sf data query (pipeline summary)", () =>
	$`sf data query --query "SELECT ForecastCategoryName, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE UserId = '001FAKEUSERID00001') AND IsClosed = false GROUP BY ForecastCategoryName" --json`
		.quiet()
		.nothrow(),
);

console.log("\n--- Parallel timing ---");
const tPar = performance.now();
await Promise.all([
	$`sysctl -n hw.model`.quiet().nothrow(),
	$`sysctl -n hw.physicalcpu`.quiet().nothrow(),
	$`sw_vers -productVersion`.quiet().nothrow(),
	$`df -P /`.quiet().nothrow(),
	$`csrutil status`.quiet().nothrow(),
	$`fdesetup status`.quiet().nothrow(),
	$`spctl --status`.quiet().nothrow(),
	$`id -Gn`.quiet().nothrow(),
]);
console.log(
	`  [${performance.now() - tPar > 1000 ? "SLOW" : "OK"}] 8 probes in parallel: ${fmt(performance.now() - tPar)}`,
);
