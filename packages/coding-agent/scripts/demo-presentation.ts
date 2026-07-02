#!/usr/bin/env bun
/**
 * Live demo: drive console form-creates with the INSTRUCTOR presentation profile
 * so a human watcher sees the agent's "human-like browsing" — fingerprint-before-
 * click + highlight overlays, slow watchable pacing (2.2s/step), and full per-step
 * narration. Built for showing the automation to an audience.
 *
 * Usage:
 *   XCSH_BROWSER_PROVIDER=extension XCSH_API_URL=… XCSH_API_TOKEN=… XCSH_NAMESPACE=demo \
 *   bun scripts/demo-presentation.ts [resource1 resource2 …]
 *   (defaults to: health-check origin-pool)
 */
import * as path from "node:path";
import { startBridgeServer } from "../src/browser/extension-bridge";
import { ExtensionBrowserProvider } from "../src/browser/extension-provider";
import { paramsFor } from "../src/sweep/sweep-params";
import { apiItemPath } from "../src/sweep/sweep-scoring";
import { CatalogWorkflowRunnerTool } from "../src/tools/catalog-workflow-runner";

const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.XCSH_API_TOKEN ?? "";
const CONSOLE_ROOT = path.resolve(import.meta.dir, "../../../../console");
const PROFILE = (process.env.XCSH_PRESENTATION ?? "instructor") as "guided" | "instructor";

process.env.XCSH_BROWSER_PROVIDER ??= "extension";

const RESOURCES = process.argv.slice(2).length ? process.argv.slice(2) : ["health-check", "origin-pool"];

function sweepName(resource: string): string {
	return `demo-${resource}`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.slice(0, 63);
}

async function apiDelete(resource: string, name: string): Promise<void> {
	if (!BASE_URL || !TOKEN) return;
	for (const ns of [NAMESPACE, "system"]) {
		await fetch(`${BASE_URL}${apiItemPath(resource, ns, name)}`, {
			method: "DELETE",
			headers: { Authorization: `APIToken ${TOKEN}` },
			signal: AbortSignal.timeout(8000),
		}).catch(() => {});
	}
}

async function apiExists(resource: string, name: string): Promise<boolean> {
	if (!BASE_URL || !TOKEN) return false;
	for (const ns of [NAMESPACE, "system"]) {
		try {
			const r = await fetch(`${BASE_URL}${apiItemPath(resource, ns, name)}`, {
				headers: { Authorization: `APIToken ${TOKEN}` },
				signal: AbortSignal.timeout(8000),
			});
			if (r.ok) return true;
		} catch {
			/* try next */
		}
	}
	return false;
}

async function main() {
	console.log(`\n🎬 xcsh automation demo — profile: ${PROFILE} (fingerprint-before-click, highlights, narration)\n`);
	const server = await startBridgeServer();
	const tool = new CatalogWorkflowRunnerTool({ settings: { get: () => undefined } } as never);

	console.log("  Waiting for the extension to connect (open Chrome with xcsh loaded)…");
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline && !server.connected) await new Promise(r => setTimeout(r, 300));
	if (!server.connected) {
		console.error("  ✗ Extension did not connect.");
		await server.close();
		process.exit(1);
	}
	console.log("  ✓ Extension connected.\n");
	tool.setProvider(new ExtensionBrowserProvider({ server }));

	for (const resource of RESOURCES) {
		const name = sweepName(resource);
		console.log(`\n▶ Creating ${resource} as "${name}" …`);
		await apiDelete(resource, name); // clean so the create is real
		await new Promise(r => setTimeout(r, 1500));
		try {
			await tool.execute(`${resource}-create`, {
				resource,
				operation: "create",
				params: paramsFor(resource, { name, namespace: NAMESPACE }),
				base_url: BASE_URL,
				catalog_path: CONSOLE_ROOT,
				presentation: PROFILE,
			} as never);
		} catch (e) {
			console.error(`  ✗ ${resource}: ${e instanceof Error ? e.message : String(e)}`);
		}
		const ok = await apiExists(resource, name);
		console.log(`  ${ok ? "✅" : "❌"} ${resource} ${ok ? "created (API-confirmed)" : "not created"}`);
	}

	console.log("\n🎬 Demo complete.\n");
	await server.close();
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
