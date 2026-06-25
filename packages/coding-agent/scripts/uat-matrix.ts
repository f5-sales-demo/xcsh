#!/usr/bin/env bun
/**
 * F5 XC Console Agent — comprehensive UAT MATRIX.
 *
 * Feeds natural-language prompts to `xcsh --print` and verifies outcomes across
 * four modalities. The console modality runs OBSERVABLY in the human's Chrome
 * (F5-red indicator + per-step delay) and is verified by API GET; json/hcl/i18n
 * run headless. Reuses the autoresearch corpora; additive (no autoresearch
 * framework edits).
 *
 *   bun scripts/uat-matrix.ts [--modalities console,json,hcl,i18n]
 *        [--observable|--no-observable] [--delay-ms 1500] [--limit N]
 *        [--filter <regex over phrase ids>] [--no-cleanup] [--cleanup-only]
 *        [--dry-run] [--self-test-api] [--strict-nl] [--report-dir <dir>]
 *
 * Env: XCSH_API_URL, XCSH_API_TOKEN, XCSH_USERNAME, XCSH_CONSOLE_PASSWORD, XCSH_NAMESPACE=demo,
 *      XCSH_BIN=xcsh
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type BridgeServer, startBridgeServer } from "../src/browser/extension-bridge";
import {
	apiDelete,
	apiGet,
	type ConsolePhrase,
	type CrudPhrase,
	type I18nPhrase,
	type MatrixConfig,
	runConsole,
	runHcl,
	runI18n,
	runJson,
	type TfPhrase,
	terraformAvailable,
} from "./uat-matrix-modalities";
import { type Cell, type Modality, type ReportContext, summarize, writeReport } from "./uat-matrix-report";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const LOCALES = ["en", "ja", "ko", "zh-cn", "fr", "de", "es", "pt-br", "it", "ar", "hi", "th"];
// Cleanup order: parents before children so dependants release.
const DEMO_CLEANUP_PATHS = [
	"http_loadbalancers",
	"tcp_loadbalancers",
	"app_firewalls",
	"service_policys",
	"origin_pools",
	"healthchecks",
];
const AR_CLEANUP_PATHS = [
	"http_loadbalancers",
	"tcp_loadbalancers",
	"app_firewalls",
	"service_policys",
	"origin_pools",
	"healthchecks",
	"api_definitions",
	"api_discoverys",
	"policers",
	"rate_limiters",
	"waf_exclusion_policys",
	"user_identifications",
	"malicious_user_mitigations",
	"sensitive_data_policys",
	"protocol_inspections",
	"network_policys",
	"virtual_sites",
	"forward_proxy_policys",
	"global_log_receivers",
	"alert_receivers",
	"enhanced_firewall_policys",
];

interface Args {
	modalities: Set<Modality>;
	observable: boolean;
	delayMs: number;
	limit?: number;
	filter?: RegExp;
	noCleanup: boolean;
	cleanupOnly: boolean;
	dryRun: boolean;
	selfTestApi: boolean;
	strictNl: boolean;
	reportDir: string;
}

function parseArgs(): Args {
	const a = process.argv.slice(2);
	const get = (flag: string) => {
		const i = a.indexOf(flag);
		return i >= 0 ? a[i + 1] : undefined;
	};
	const has = (flag: string) => a.includes(flag);
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	return {
		modalities: new Set((get("--modalities")?.split(",") ?? ["console", "json", "hcl", "i18n"]) as Modality[]),
		observable: !has("--no-observable"),
		delayMs: Number(get("--delay-ms") ?? 1500),
		limit: get("--limit") ? Number(get("--limit")) : undefined,
		filter: get("--filter") ? new RegExp(get("--filter")!) : undefined,
		noCleanup: has("--no-cleanup"),
		cleanupOnly: has("--cleanup-only"),
		dryRun: has("--dry-run"),
		selfTestApi: has("--self-test-api"),
		strictNl: has("--strict-nl"),
		reportDir: get("--report-dir") ?? path.join(REPO_ROOT, "uat-matrix", "reports", ts),
	};
}

function loadYaml<T>(rel: string): T {
	return parseYaml(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")) as T;
}

function applyLimitFilter<T>(items: T[], args: Args, idOf: (t: T) => string): T[] {
	let out = items;
	if (args.filter) out = out.filter(t => args.filter!.test(idOf(t)));
	if (args.limit) out = out.slice(0, args.limit);
	return out;
}

function cfgFromEnv(args: Args): MatrixConfig {
	return {
		xcshBin: process.env.XCSH_BIN ?? "xcsh",
		apiUrl: process.env.XCSH_API_URL ?? "https://nferreira.staging.volterra.us",
		apiToken: process.env.XCSH_API_TOKEN ?? "",
		consoleNamespace: process.env.XCSH_NAMESPACE ?? "demo",
		tenant: (process.env.XCSH_API_URL ?? "https://nferreira.staging.volterra.us")
			.replace(/^https?:\/\//, "")
			.split(".")[0]!,
		observable: args.observable,
		delayMs: args.delayMs,
		reportDir: args.reportDir,
		strictNl: args.strictNl,
		cellTimeoutMs: 240_000,
	};
}

async function ensureExtensionConnectedAndLogin(cfg: MatrixConfig): Promise<void> {
	console.log("[console] starting bridge probe (extension must be loaded + xcsh chrome setup done)...");
	const server: BridgeServer = await startBridgeServer();
	try {
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline && !server.connected) {
			await new Promise(r => setTimeout(r, 2000));
			process.stdout.write(".");
		}
		console.log("");
		if (!server.connected) {
			throw new Error(
				"Extension did not connect within 60s — load dist/ in Chrome and run `xcsh chrome setup`. Refusing to fall back to CDP for a watch-live run.",
			);
		}
		console.log("[console] extension connected ✅");
		const XCSH_USERNAME = process.env.XCSH_USERNAME;
		const XCSH_CONSOLE_PASSWORD = process.env.XCSH_CONSOLE_PASSWORD;
		if (XCSH_USERNAME && XCSH_CONSOLE_PASSWORD) {
			const route = `${cfg.apiUrl}/web/workspaces/web-app-and-api-protection/namespaces/${cfg.consoleNamespace}/manage/load_balancers/http_loadbalancers`;
			console.log("[console] establishing session via login tool...");
			const r = await server.request(
				"login",
				{ email: XCSH_USERNAME, password: XCSH_CONSOLE_PASSWORD, consoleUrl: route },
				160_000,
			);
			if (r.is_error || !(r.content as any)?.loggedIn)
				throw new Error(`login failed: ${JSON.stringify(r.content).slice(0, 160)}`);
			console.log("[console] logged in ✅ (session persists across xcsh runs)");
		} else {
			console.log("[console] no XCSH_USERNAME/XCSH_CONSOLE_PASSWORD — relying on an existing Chrome session");
		}
	} finally {
		// Release the socket so each `xcsh --print` can own it (the extension reconnects via its alarm).
		await server.close();
	}
}

async function listNames(ns: string, apiPath: string, prefix: string, cfg: MatrixConfig): Promise<string[]> {
	try {
		const r = await fetch(`${cfg.apiUrl}/api/config/namespaces/${ns}/${apiPath}`, {
			headers: { Authorization: `APIToken ${cfg.apiToken}` },
		});
		if (!r.ok) return [];
		const d: any = await r.json();
		const items: any[] = d.items ?? d.objects ?? [];
		return items.map(i => i.name ?? i.metadata?.name ?? "").filter((n: string) => n.startsWith(prefix));
	} catch {
		return [];
	}
}

async function cleanup(cfg: MatrixConfig): Promise<void> {
	console.log("\n[cleanup] deleting uat-* (demo) and ar-test-* (r-mordasiewicz) resources, parents first...");
	for (const ap of DEMO_CLEANUP_PATHS) {
		for (const name of await listNames(cfg.consoleNamespace, ap, "uat-", cfg)) {
			const code = await apiDelete(`/api/config/namespaces/${cfg.consoleNamespace}/${ap}/${name}`, cfg);
			console.log(`  demo/${ap}/${name} → ${code}`);
		}
	}
	for (const ap of AR_CLEANUP_PATHS) {
		for (const name of await listNames("r-mordasiewicz", ap, "ar-test-", cfg)) {
			await apiDelete(`/api/config/namespaces/r-mordasiewicz/${ap}/${name}`, cfg);
		}
	}
	console.log("[cleanup] done");
}

async function main() {
	const args = parseArgs();
	const cfg = cfgFromEnv(args);
	const cells: Cell[] = [];
	const startedAt = new Date().toISOString();

	if (args.cleanupOnly) {
		if (!cfg.apiToken) throw new Error("XCSH_API_TOKEN required for cleanup");
		await cleanup(cfg);
		return;
	}

	// --- Dry run: parse corpora, print the planned matrix, validate triggers ---
	if (args.dryRun) {
		const consolePhrases = loadYaml<{ phrases: ConsolePhrase[] }>("uat-matrix/console-phrases.yaml").phrases ?? [];
		const triggerRe =
			/(in|open|using|through) the (f5 xc )?(web )?console|using chrome|in the f5 xc ui|walk me through|show me in/i;
		let bad = 0;
		console.log(`\n[dry-run] ${consolePhrases.length} console phrases:`);
		for (const p of consolePhrases) {
			const hasTrigger = triggerRe.test(p.phrase);
			const knownCleanup = (p.cleanup ?? []).every(c => /^[a-z_]+\/[a-z0-9-]+$/.test(c));
			if (!hasTrigger || !knownCleanup) bad++;
			console.log(
				`  ${hasTrigger ? "✅" : "⚠️ NO-TRIGGER"} ${p.id} [${p.operation}/${p.console_resource}] nested=${(p.nested ?? []).length}`,
			);
		}
		console.log(
			`\n[dry-run] json=${loadYaml<{ phrases: CrudPhrase[] }>("autoresearch-crud-phrases.yaml").phrases.length} hcl=${loadYaml<{ phrases: TfPhrase[] }>("terraform-phrases.yaml").phrases.length} i18n=${loadYaml<{ phrases: I18nPhrase[] }>("autoresearch-i18n-phrases.yaml").phrases.length}×${LOCALES.length}`,
		);
		console.log(
			bad === 0
				? "[dry-run] all console phrases have a router trigger + valid cleanup ✅"
				: `[dry-run] ${bad} console phrases need attention ⚠️`,
		);
		process.exit(bad === 0 ? 0 : 1);
	}

	// --- API self-test ---
	if (args.selfTestApi) {
		if (!cfg.apiToken) throw new Error("XCSH_API_TOKEN required");
		const present = await apiGet(`/api/config/namespaces/${cfg.consoleNamespace}/healthchecks`, cfg);
		const absent = await apiGet(
			`/api/config/namespaces/${cfg.consoleNamespace}/healthchecks/uat-definitely-absent-xyz`,
			cfg,
		);
		console.log(`[self-test] list healthchecks → ${present} (expect 200); absent resource → ${absent} (expect 404)`);
		process.exit(present === "200" && absent === "404" ? 0 : 1);
	}

	if (!cfg.apiToken) throw new Error("XCSH_API_TOKEN required for verification");

	// --- Console FIRST (human watching) ---
	if (args.modalities.has("console")) {
		await ensureExtensionConnectedAndLogin(cfg);
		const phrases = applyLimitFilter(
			loadYaml<{ phrases: ConsolePhrase[] }>("uat-matrix/console-phrases.yaml").phrases,
			args,
			p => p.id,
		);
		console.log(`\n[console] running ${phrases.length} phrases observably (watch Chrome)...`);
		for (const p of phrases) {
			console.log(`\n  ▶ ${p.id}: ${p.phrase.slice(0, 80)}...`);
			const c = await runConsole(p, cfg);
			cells.push(c);
			console.log(`    ${c.status === "PASS" ? "✅" : "❌"} ${c.status}: ${c.detail}`);
		}
	}

	// --- JSON ---
	if (args.modalities.has("json")) {
		const phrases = applyLimitFilter(
			loadYaml<{ phrases: CrudPhrase[] }>("autoresearch-crud-phrases.yaml").phrases,
			args,
			p => `J-${p.resource}-${p.operation}`,
		);
		console.log(`\n[json] running ${phrases.length} phrases...`);
		for (const p of phrases) {
			const c = await runJson(p, cfg);
			cells.push(c);
			console.log(`  ${c.status === "PASS" ? "✅" : c.status === "SKIP" ? "⏭" : "❌"} ${c.id}: ${c.detail}`);
		}
	}

	// --- HCL ---
	if (args.modalities.has("hcl")) {
		const tfOk = await terraformAvailable();
		const phrases = applyLimitFilter(
			loadYaml<{ phrases: TfPhrase[] }>("terraform-phrases.yaml").phrases,
			args,
			p => `H-${p.expect_resource ?? p.operation}-${p.operation}`,
		);
		console.log(
			`\n[hcl] running ${phrases.length} phrases (terraform ${tfOk ? "available" : "NOT found — keyword presence only"})...`,
		);
		for (const p of phrases) {
			const c = await runHcl(p, cfg, tfOk);
			cells.push(c);
			console.log(`  ${c.status === "PASS" ? "✅" : "❌"} ${c.id}: ${c.detail}`);
		}
	}

	// --- i18n ---
	if (args.modalities.has("i18n")) {
		const phrases = applyLimitFilter(
			loadYaml<{ phrases: I18nPhrase[] }>("autoresearch-i18n-phrases.yaml").phrases,
			args,
			p => p.id,
		);
		console.log(`\n[i18n] running ${phrases.length} phrases × ${LOCALES.length} locales...`);
		for (const p of phrases) {
			for (const loc of LOCALES) {
				const c = await runI18n(p, loc, cfg);
				cells.push(c);
				console.log(
					`  ${c.status === "PASS" ? "✅" : c.status === "SKIP" ? "⏭" : "❌"} ${c.id}-${loc}: ${c.detail}`,
				);
			}
		}
	}

	if (!args.noCleanup) await cleanup(cfg);

	const ctx: ReportContext = {
		startedAt,
		finishedAt: new Date().toISOString(),
		tenant: cfg.tenant,
		consoleNamespace: cfg.consoleNamespace,
		apiUrl: cfg.apiUrl,
		modalities: [...args.modalities],
		observable: args.observable,
		delayMs: args.delayMs,
	};
	const { mdPath, jsonPath } = writeReport(cells, args.reportDir, ctx);
	const s = summarize(cells);
	console.log(`\n${"=".repeat(60)}`);
	console.log(`UAT MATRIX: ✅ ${s.pass}  ❌ ${s.fail}  ⏭ ${s.skip}  (total ${s.total})`);
	console.log(`Report: ${mdPath}`);
	console.log(`JSON:   ${jsonPath}`);
	console.log("=".repeat(60));
	process.exit(s.fail > 0 ? 1 : 0);
}

main().catch(e => {
	console.error("FATAL:", e instanceof Error ? e.message : e);
	process.exit(1);
});
