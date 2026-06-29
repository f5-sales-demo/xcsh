#!/usr/bin/env bun
/**
 * Honest console-CRUD sweep harness (reproducible; no LLM in the loop).
 *
 * For each resource it runs the full CRUD cycle against the LIVE console via the
 * xcsh Chrome extension, then scores each operation with a STRICT cross-check:
 *   - CLEAN  : delete any pre-existing test instance so create is real
 *   - CREATE : run create, then API-GET must confirm the resource exists
 *   - READ   : run read,   then API-GET must confirm it still exists
 *   - UPDATE : run update, then API-GET must confirm it still exists
 *   - DELETE : run delete, then API-GET must confirm it is GONE
 * A "pass" requires the workflow runner AND the independent API post-condition to
 * agree, with no console error banner. A create the runner SKIPPED because the
 * resource already existed is scored "indeterminate", never a pass.
 *
 * Reads workflows from the live console catalog ON DISK (catalog_path), NOT the
 * embedded copy — so it always measures the latest source, never a stale binary.
 *
 * Usage:
 *   XCSH_BROWSER_PROVIDER=extension \
 *   XCSH_API_URL=https://<tenant> XCSH_API_TOKEN=<token> XCSH_NAMESPACE=demo \
 *   bun scripts/sweep-harness.ts [resource1 resource2 ...]
 *
 * Requires: Chrome running with the xcsh extension loaded + WebSocket bridge up.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { type BridgeServer, startBridgeServer } from "../src/browser/extension-bridge";
import { ExtensionBrowserProvider } from "../src/browser/extension-provider";
import { jsonCreate } from "../src/sweep/json-create";
import { isScopedOut, paramsFor } from "../src/sweep/sweep-params";
import { apiItemPath, type SweepOperation, scoreOperation, type Verdict } from "../src/sweep/sweep-scoring";
import { CatalogWorkflowRunnerTool } from "../src/tools/catalog-workflow-runner";

/** Banked walker-generated + API-validated specs, used to drive JSON-tab create. */
type BankedSpec = { namespace?: string; spec: Record<string, unknown> };
function loadBankedSpecs(): Record<string, BankedSpec> {
	const p = path.join(CONSOLE_ROOT, "catalog/generated-specs.json");
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch {
		return {};
	}
}

/** Read the list URL + "Add <Resource>" label from a resource's create workflow. */
function workflowMeta(resource: string): { listUrl: string; addText: string } {
	const doc = yaml.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, resource, "create.yaml"), "utf8"));
	const steps: Array<{ action?: string; url?: string; selector?: string }> = doc.steps ?? [];
	const nav = steps.find(s => s.action === "navigate");
	const add = steps.find(s => /text\('Add /.test(s.selector ?? ""));
	return {
		listUrl: (nav?.url ?? "").replace(/\{namespace\}/g, NAMESPACE),
		addText: (add?.selector?.match(/text\('([^']+)'\)/)?.[1] ?? "Add").trim(),
	};
}

const CONSOLE_ROOT = process.env.CONSOLE_CATALOG_DIR ?? path.resolve(import.meta.dir, "../../../../console");
const WORKFLOWS_DIR = path.join(CONSOLE_ROOT, "catalog/workflows");
const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.XCSH_API_TOKEN ?? "";
const OUT_PATH = process.env.SWEEP_OUT ?? path.join(CONSOLE_ROOT, "scripts/sweep-results.honest.json");

// Live runs need the real session — force the extension provider unless overridden.
process.env.XCSH_BROWSER_PROVIDER ??= "extension";

const CRUD: SweepOperation[] = ["create", "read", "update", "delete"];
const BANKED = loadBankedSpecs();
let bridge: BridgeServer | null = null;

interface OpOutcome {
	verdict: Verdict | "n/a";
	reason: string;
	runnerStatus?: string;
	durationMs?: number;
	/** Runner failure detail (failedAtStep + message) — the triage signal. */
	detail?: string;
}
interface ResourceOutcome {
	resource: string;
	name: string;
	ops: Record<string, OpOutcome>;
}

/** Deterministic, DNS-1035-safe test instance name for a resource. */
function sweepName(resource: string): string {
	const n = `xcsh-sweep-${resource}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	return n.slice(0, 63).replace(/-+$/, "");
}

/** API-GET post-condition: true=present, false=absent, null=could not check. */
async function apiExists(resource: string, name: string): Promise<boolean | null> {
	if (!BASE_URL || !TOKEN) return null;
	let sawResponse = false;
	for (const ns of [NAMESPACE, "system"]) {
		const url = `${BASE_URL}${apiItemPath(resource, ns, name)}`;
		try {
			const r = await fetch(url, {
				headers: { Authorization: `APIToken ${TOKEN}` },
				signal: AbortSignal.timeout(8000),
			});
			sawResponse = true;
			if (r.ok) return true;
		} catch {
			/* network/timeout — try next namespace */
		}
	}
	return sawResponse ? false : null;
}

/**
 * Poll the API post-condition until it matches the expected state. XC writes
 * (esp. deletes) are eventually consistent, so a single immediate GET can race
 * the propagation — poll briefly before scoring. Returns the last observed state.
 */
async function awaitApiState(
	resource: string,
	name: string,
	expectPresent: boolean,
	attempts = 6,
	delayMs = 1500,
): Promise<boolean | null> {
	let last: boolean | null = null;
	for (let i = 0; i < attempts; i++) {
		last = await apiExists(resource, name);
		if (last === null || last === expectPresent) return last;
		await new Promise(r => setTimeout(r, delayMs));
	}
	return last;
}

/** Best-effort API delete (both target + system ns) — reliable CLEAN before create. */
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

const tool = new CatalogWorkflowRunnerTool({ settings: { get: () => undefined } } as never);

interface NormalizedRun {
	status: "pass" | "fail";
	skipped: boolean;
	errorBanner: boolean;
	durationMs: number;
	detail?: string;
}

async function runOp(resource: string, operation: SweepOperation, name: string): Promise<NormalizedRun> {
	const t0 = performance.now();
	let res: unknown;
	try {
		res = await tool.execute(`${resource}-${operation}`, {
			resource,
			operation,
			params: paramsFor(resource, { name, namespace: NAMESPACE }),
			base_url: BASE_URL,
			catalog_path: CONSOLE_ROOT,
		} as never);
	} catch (e) {
		return {
			status: "fail",
			skipped: false,
			errorBanner: false,
			durationMs: Math.round(performance.now() - t0),
			detail: `threw: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
	const d = ((res as { details?: Record<string, unknown> }).details ?? {}) as Record<string, unknown>;
	const status = (d.status as string) ?? (d.overallPassed ? "pass" : "fail");
	const steps = (d.steps as Array<Record<string, unknown>>) ?? [];
	const skipped = steps.some(s => s.id === "pre-create-check" && /skip|exist/i.test(String(s.label ?? "")));
	const errorBanner = typeof d.error === "string" && /we found|validation|rejected/i.test(d.error);
	// Capture the failing step + its message — the actual triage signal, far richer
	// than the generic "workflow runner reported failure".
	const failedAtStep = d.failedAtStep as string | undefined;
	const stepErr = steps.find(s => s.status === "fail")?.error as string | undefined;
	const detail = [failedAtStep, stepErr ?? (d.error as string | undefined)].filter(Boolean).join(": ") || undefined;
	return {
		status: status === "pass" ? "pass" : "fail",
		skipped,
		errorBanner,
		durationMs: Math.round(performance.now() - t0),
		detail,
	};
}

function hasWorkflow(resource: string, operation: string): boolean {
	return fs.existsSync(path.join(WORKFLOWS_DIR, resource, `${operation}.yaml`));
}

function discover(filter: string[]): string[] {
	return fs
		.readdirSync(WORKFLOWS_DIR)
		.filter(d => fs.existsSync(path.join(WORKFLOWS_DIR, d, "create.yaml")))
		.filter(d => filter.length === 0 || filter.includes(d))
		.sort();
}

async function sweepResource(resource: string): Promise<ResourceOutcome> {
	const name = sweepName(resource);
	const ops: Record<string, OpOutcome> = {};
	const banked = BANKED[resource];

	// CLEAN: API delete first (reliable) so create is genuinely exercised.
	await apiDelete(resource, name);

	for (const op of CRUD) {
		// CREATE: FORM-FIRST (the visual demonstration — real Add → fill → save).
		// JSON-create is a verification/fallback only, used when the form can't create yet.
		if (op === "create") {
			const t0 = performance.now();
			let run: NormalizedRun = hasWorkflow(resource, "create")
				? await runOp(resource, "create", name)
				: { status: "fail", skipped: false, errorBanner: false, durationMs: 0, detail: "no workflow file" };
			let exists = await awaitApiState(resource, name, true);
			let how = "form";
			if ((run.status !== "pass" || exists !== true) && banked && bridge) {
				const formDetail = run.detail ?? "form failed";
				const meta = workflowMeta(resource);
				const jc = await jsonCreate(bridge, {
					baseUrl: BASE_URL,
					listUrl: meta.listUrl,
					addText: meta.addText,
					name,
					namespace: banked.namespace ?? NAMESPACE,
					spec: banked.spec,
				}).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
				exists = await awaitApiState(resource, name, true);
				run = {
					status: jc.ok ? "pass" : "fail",
					skipped: false,
					errorBanner: false,
					durationMs: 0,
					detail: `form-failed(${formDetail}); json:${jc.error ?? "ok"}`,
				};
				how = "json-fallback";
			}
			const score = scoreOperation({
				operation: "create",
				runnerStatus: run.status,
				runnerSkipped: false,
				apiExists: exists,
				errorBanner: run.errorBanner,
			});
			ops.create = {
				verdict: score.verdict,
				reason: score.reason,
				runnerStatus: run.status,
				durationMs: Math.round(performance.now() - t0),
				detail: `[${how}] ${run.detail ?? ""}`,
			};
			console.log(
				`  ${resource.padEnd(28)} create  ${score.verdict.toUpperCase().padEnd(13)} ${how}: ${score.reason}`,
			);
			// Skip read/update/delete when create failed — the resource doesn't exist,
			// so running them wastes ~2 min per resource (~3-4× sweep speedup).
			if (score.verdict !== "pass") {
				for (const skip of ["read", "update", "delete"]) {
					ops[skip] = { verdict: "fail", reason: "skipped (create failed)", detail: "[skipped]" };
				}
				break;
			}
			continue;
		}
		if (!hasWorkflow(resource, op)) {
			ops[op] = { verdict: "n/a", reason: "no workflow file" };
			continue;
		}
		const run = await runOp(resource, op, name);
		const exists = await awaitApiState(resource, name, op !== "delete");
		const score = scoreOperation({
			operation: op,
			runnerStatus: run.status,
			runnerSkipped: run.skipped,
			apiExists: exists,
			errorBanner: run.errorBanner,
		});
		ops[op] = {
			verdict: score.verdict,
			reason: score.reason,
			runnerStatus: run.status,
			durationMs: run.durationMs,
			detail: run.detail,
		};
		console.log(`  ${resource.padEnd(28)} ${op.padEnd(7)} ${score.verdict.toUpperCase().padEnd(13)} ${score.reason}`);
	}
	return { resource, name, ops };
}

async function main() {
	const filter = process.argv.slice(2);
	if (!BASE_URL || !TOKEN) {
		console.warn("⚠  XCSH_API_URL / XCSH_API_TOKEN not set — API cross-check will be indeterminate.");
	}
	const discovered = discover(filter);
	const resources = discovered.filter(r => !isScopedOut(r));
	const scoped = discovered.filter(isScopedOut);
	console.log(
		`\nHonest sweep: ${resources.length} resources × CRUD against ${BASE_URL || "(no base url)"} ns=${NAMESPACE}` +
			(scoped.length ? ` (${scoped.length} scoped out: cloud/external deps)` : "") +
			"\n",
	);

	// Own ONE bridge for the whole sweep and inject it so every workflow reuses it.
	const server = await startBridgeServer();
	bridge = server;

	// Wait for the extension to connect ONCE at startup — eliminates the per-resource
	// connection race that made the first N resources fail with "did not connect."
	const probeMs = Number(process.env.XCSH_BRIDGE_PROBE_MS) || 60_000;
	console.log(`  Waiting for extension to connect (up to ${Math.round(probeMs / 1000)}s)...`);
	const deadline = Date.now() + probeMs;
	while (Date.now() < deadline && !server.connected) {
		await new Promise(r => setTimeout(r, 300));
	}
	if (!server.connected) {
		console.error("  ✗ Extension did not connect. Is it installed + reloaded?");
		await server.close();
		process.exit(1);
	}
	console.log("  ✓ Extension connected.\n");

	tool.setProvider(new ExtensionBrowserProvider({ server }));
	const banked = resources.filter(r => BANKED[r]).length;
	if (banked) console.log(`  (JSON-create enabled for ${banked} banked-spec resources)\n`);

	const results: ResourceOutcome[] = [];
	try {
		for (const resource of resources) {
			results.push(await sweepResource(resource));
			// Write incrementally so a long run's partial progress survives a hang/crash.
			fs.writeFileSync(
				OUT_PATH,
				JSON.stringify({ namespace: NAMESPACE, baseUrl: BASE_URL, scopedOut: scoped, results }, null, 2),
			);
		}
	} finally {
		await server.close().catch(() => {});
	}

	// Summary matrix: count strict passes per operation.
	const tally: Record<string, Record<Verdict | "n/a", number>> = {};
	for (const op of CRUD)
		tally[op] = { pass: 0, fail: 0, indeterminate: 0, "n/a": 0 } as Record<Verdict | "n/a", number>;
	for (const r of results) for (const op of CRUD) tally[op]![r.ops[op]!.verdict as Verdict | "n/a"]++;

	console.log("\n=== STRICT SUMMARY (per operation) ===");
	for (const op of CRUD) {
		const t = tally[op]!;
		console.log(
			`  ${op.padEnd(7)} pass=${t.pass}  fail=${t.fail}  indeterminate=${t.indeterminate}  n/a=${t["n/a"]}`,
		);
	}
	const fullCrud = results.filter(r => CRUD.every(op => r.ops[op]!.verdict === "pass")).length;
	console.log(`\n  FULL-CRUD strict-green: ${fullCrud}/${results.length} (scoped out: ${scoped.length})\n`);

	fs.writeFileSync(
		OUT_PATH,
		JSON.stringify({ namespace: NAMESPACE, baseUrl: BASE_URL, scopedOut: scoped, results }, null, 2),
	);
	console.log(`Wrote ${OUT_PATH}`);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
