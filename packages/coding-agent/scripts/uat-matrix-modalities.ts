/**
 * UAT matrix — per-modality run + verify functions.
 *
 * Each returns a Cell. The agent is driven via `xcsh --print` (NL in), then
 * verified out-of-band:
 *   console → catalog_workflow_runner (observable) + UI step-table + API GET
 *   json    → API GET (autoresearch-crud pattern)
 *   hcl     → terraform validate (or keyword presence fallback)
 *   i18n    → HCL keyword presence per locale
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Cell } from "./uat-matrix-report";

export interface MatrixConfig {
	xcshBin: string;
	apiUrl: string;
	apiToken: string;
	consoleNamespace: string;
	tenant: string;
	observable: boolean;
	delayMs: number;
	reportDir: string;
	strictNl: boolean;
	cellTimeoutMs: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// xcsh subprocess + API helpers
// ---------------------------------------------------------------------------

export interface XcshRun {
	stdout: string;
	stderr: string;
	code: number | null;
	timedOut: boolean;
}

export function runXcsh(
	args: string[],
	opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string; bin?: string },
): Promise<XcshRun> {
	return new Promise(resolve => {
		const child = spawn(opts.bin ?? "xcsh", args, {
			env: opts.env ?? process.env,
			cwd: opts.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, opts.timeoutMs);
		child.stdout.on("data", d => {
			stdout += d.toString();
		});
		child.stderr.on("data", d => {
			stderr += d.toString();
		});
		child.on("close", code => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code, timedOut });
		});
		child.on("error", () => {
			clearTimeout(timer);
			resolve({ stdout, stderr: `${stderr}\n(spawn error)`, code: -1, timedOut });
		});
	});
}

/** GET an API path; returns the HTTP code, retrying 3× on transient 000. */
export async function apiGet(apiPath: string, cfg: MatrixConfig): Promise<string> {
	const url = `${cfg.apiUrl}${apiPath}`;
	for (let i = 0; i < 3; i++) {
		try {
			const r = await fetch(url, { headers: { Authorization: `APIToken ${cfg.apiToken}` } });
			return String(r.status);
		} catch {
			await sleep(2000);
		}
	}
	return "000";
}

export async function apiDelete(apiPath: string, cfg: MatrixConfig): Promise<string> {
	try {
		const r = await fetch(`${cfg.apiUrl}${apiPath}`, {
			method: "DELETE",
			headers: { Authorization: `APIToken ${cfg.apiToken}`, "Content-Type": "application/json" },
		});
		return String(r.status);
	} catch {
		return "000";
	}
}

/** Best-effort detection of which path the agent used, from the --print trace. */
export function detectRouted(stdout: string): Cell["routedTo"] {
	const s = stdout.toLowerCase();
	const usedConsole = /catalog_workflow_runner|workflow:\s|\[pass\s*\]|\[fail\s*\]|\bobservable\b/.test(s);
	const usedApi = /xcsh_api|\bpost \/api|\bput \/api|api call/.test(s);
	if (usedConsole && !usedApi) return "console";
	if (usedApi && !usedConsole) return "api";
	if (usedConsole && usedApi) return "console"; // console drove it even if it also read via API
	if (/```(hcl|terraform)|resource\s+"xcsh_/.test(stdout)) return "file";
	return "unknown";
}

/** Parse the catalog_workflow_runner step table from xcsh stdout. */
function workflowReportedPass(stdout: string): boolean | null {
	const m = stdout.match(/Status:\s*(PASS|FAIL)/i);
	if (m) return m[1]!.toUpperCase() === "PASS";
	if (/\[FAIL\s*\]/.test(stdout)) return false;
	if (/\[PASS\s*\]/.test(stdout)) return true;
	return null;
}

// ---------------------------------------------------------------------------
// Console phrase shape (from console-phrases.yaml)
// ---------------------------------------------------------------------------

export interface ConsolePhrase {
	id: string;
	phrase: string;
	operation: "create" | "delete";
	console_resource: string;
	verify: {
		api_path: string;
		resource_name: string;
		namespace: string;
		expect_http_create?: number;
		expect_http_delete?: number;
		ui_readback?: string;
	};
	nested?: Array<{ console_resource: string; api_path: string; resource_name: string }>;
	cleanup?: string[];
}

// ---------------------------------------------------------------------------
// Modality runners
// ---------------------------------------------------------------------------

export async function runConsole(p: ConsolePhrase, cfg: MatrixConfig): Promise<Cell> {
	const start = performance.now();
	const shotDir = path.join(cfg.reportDir, "screenshots", p.id);
	fs.mkdirSync(shotDir, { recursive: true });

	const guardrail = cfg.strictNl
		? "" // strict-NL: no guardrail, measure raw routing
		: [
				"You are executing a console UAT step against the F5 XC web console.",
				"You MUST perform this operation in the console using the catalog_workflow_runner tool —",
				"do NOT substitute the xcsh_api tool. When you call catalog_workflow_runner, set",
				`observable: ${cfg.observable}, observable_delay_ms: ${cfg.delayMs}, screenshot_dir: "${shotDir}",`,
				`and pass namespace: "${cfg.consoleNamespace}" in params. Use the exact resource names in the request.`,
			].join(" ");

	const args = ["--print", "--no-session"];
	if (guardrail) args.push("--append-system-prompt", guardrail);
	args.push(p.phrase);

	const run = await runXcsh(args, {
		timeoutMs: cfg.cellTimeoutMs,
		bin: cfg.xcshBin,
		env: { ...process.env, XCSH_API_URL: cfg.apiUrl },
	});

	const routedTo = detectRouted(run.stdout);
	const uiPass = workflowReportedPass(run.stdout);

	// API verification (authoritative): parent + every nested child.
	const ns = p.verify.namespace;
	const targets = [
		{ api_path: p.verify.api_path, name: p.verify.resource_name },
		...(p.nested ?? []).map(n => ({ api_path: n.api_path, name: n.resource_name })),
	];
	const codes: Record<string, string> = {};
	let apiOk = true;
	for (const t of targets) {
		const code = await apiGet(`/api/config/namespaces/${ns}/${t.api_path}/${t.name}`, cfg);
		codes[t.name] = code;
		if (p.operation === "create" && code !== String(p.verify.expect_http_create ?? 200)) apiOk = false;
		if (p.operation === "delete" && !(code === String(p.verify.expect_http_delete ?? 404) || code === "000"))
			apiOk = false;
	}

	const screenshots = fs.existsSync(shotDir)
		? fs
				.readdirSync(shotDir)
				.filter(f => f.endsWith(".png"))
				.map(f => path.join(shotDir, f))
		: [];

	let status: Cell["status"] = "PASS";
	const notes: string[] = [];
	if (run.timedOut) {
		status = "FAIL";
		notes.push(`timed out after ${cfg.cellTimeoutMs}ms`);
	}
	if (!apiOk) {
		status = "FAIL";
		notes.push(`API codes ${JSON.stringify(codes)} (expected ${p.operation})`);
	}
	if (uiPass === false) {
		// UI said fail but API ok → divergence
		if (apiOk) notes.push("UI/API divergence: workflow reported FAIL but API matches");
		else {
			status = "FAIL";
			notes.push("workflow reported FAIL");
		}
	}
	if (routedTo === "api") notes.push("router leak: agent used the API, not the console");

	const parentCode = codes[p.verify.resource_name];
	return {
		modality: "console",
		id: p.id,
		phrase: p.phrase,
		operation: p.operation,
		resource: p.console_resource,
		status,
		durationMs: performance.now() - start,
		detail: notes.join("; ") || `console ${p.operation} ok (${routedTo})`,
		screenshots,
		httpCreate: p.operation === "create" ? parentCode : undefined,
		httpDelete: p.operation === "delete" ? parentCode : undefined,
		routedTo,
	};
}

export interface CrudPhrase {
	phrase: string;
	operation: string;
	resource: string;
	resource_name: string;
	api_path: string;
	namespace_scoped?: boolean;
	api_namespace?: string;
	skip_crud_test?: boolean;
}

export async function runJson(p: CrudPhrase, cfg: MatrixConfig): Promise<Cell> {
	const start = performance.now();
	if (p.skip_crud_test) {
		return {
			modality: "json",
			id: `J-${p.resource}-${p.operation}`,
			phrase: p.phrase,
			operation: p.operation,
			resource: p.resource,
			status: "SKIP",
			durationMs: 0,
			detail: "skip_crud_test=true",
		};
	}
	const ns = p.api_namespace || "r-mordasiewicz";
	const verifyPath =
		p.namespace_scoped === false
			? `/api/web/namespaces/${p.resource_name}`
			: `/api/config/namespaces/${ns}/${p.api_path}/${p.resource_name}`;

	const run = await runXcsh(["--print", "--no-session", p.phrase], {
		timeoutMs: 120_000,
		bin: cfg.xcshBin,
		env: { ...process.env, XCSH_API_URL: cfg.apiUrl, XCSH_API_TOKEN: cfg.apiToken },
	});

	let code = await apiGet(verifyPath, cfg);
	let ok = false;
	if (p.operation === "create" || p.operation === "update" || p.operation === "read") {
		ok = code === "200";
	} else if (p.operation === "delete") {
		await sleep(2000);
		code = await apiGet(verifyPath, cfg);
		ok = code === "404" || code === "000";
	}
	return {
		modality: "json",
		id: `J-${p.resource}-${p.operation}`,
		phrase: p.phrase,
		operation: p.operation,
		resource: p.resource,
		status: run.timedOut ? "FAIL" : ok ? "PASS" : "FAIL",
		durationMs: performance.now() - start,
		detail: run.timedOut ? "timed out" : `http=${code}`,
		httpCreate: p.operation !== "delete" ? code : undefined,
		httpDelete: p.operation === "delete" ? code : undefined,
		routedTo: detectRouted(run.stdout),
	};
}

export interface TfPhrase {
	phrase: string;
	operation: string;
	expect_resource?: string;
	expect_fields?: string[];
	expect_command?: string;
}

function extractHcl(stdout: string, workdir: string): string {
	// 1) any *.tf files xcsh wrote
	let hcl = "";
	try {
		for (const f of fs.readdirSync(workdir)) {
			if (f.endsWith(".tf")) hcl += `\n${fs.readFileSync(path.join(workdir, f), "utf8")}`;
		}
	} catch {
		/* no workdir files */
	}
	// 2) fenced ```hcl / ```terraform blocks in stdout
	const fence = /```(?:hcl|terraform|tf)?\s*([\s\S]*?)```/gi;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
	while ((m = fence.exec(stdout)) !== null) {
		if (/resource\s+"xcsh_|provider\s+"xcsh"|terraform\s*\{/.test(m[1]!)) hcl += `\n${m[1]}`;
	}
	return hcl.trim();
}

async function terraformAvailable(): Promise<boolean> {
	const r = await runXcsh(["version"], { timeoutMs: 10_000, bin: "terraform" });
	return r.code === 0;
}

export async function runHcl(p: TfPhrase, cfg: MatrixConfig, tfOk: boolean): Promise<Cell> {
	const start = performance.now();
	const id = `H-${(p.expect_resource ?? p.operation).replace(/^xcsh_/, "")}-${p.operation}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-hcl-"));
	try {
		const run = await runXcsh(["--print", "--no-session", p.phrase], {
			timeoutMs: 120_000,
			bin: cfg.xcshBin,
			cwd: workdir,
			env: { ...process.env, XCSH_API_URL: cfg.apiUrl },
		});

		// expect_command phrases (plan/destroy explanations): keyword presence only.
		if (p.expect_command && !p.expect_resource) {
			const ok = run.stdout.toLowerCase().includes(p.expect_command.toLowerCase());
			return cell(ok, run, `expect_command "${p.expect_command}"`);
		}

		const hcl = extractHcl(run.stdout, workdir);
		const fieldsPresent =
			!!p.expect_resource && hcl.includes(p.expect_resource) && (p.expect_fields ?? []).every(f => hcl.includes(f));

		let detail = `keyword presence: ${fieldsPresent ? "ok" : "missing fields/resource"}`;
		let ok = fieldsPresent;

		// Authoritative terraform validate when available + we have HCL.
		if (tfOk && hcl) {
			fs.writeFileSync(path.join(workdir, "main.tf"), hcl);
			const fmt = await runXcsh(["fmt", "-check", "-list=false"], {
				timeoutMs: 30_000,
				bin: "terraform",
				cwd: workdir,
			});
			const init = await runXcsh(["init", "-backend=false", "-input=false", "-no-color"], {
				timeoutMs: 120_000,
				bin: "terraform",
				cwd: workdir,
			});
			if (init.code === 0) {
				const val = await runXcsh(["validate", "-no-color"], { timeoutMs: 60_000, bin: "terraform", cwd: workdir });
				ok = val.code === 0 && fieldsPresent;
				detail = `terraform validate=${val.code === 0 ? "ok" : "fail"}, fmt=${fmt.code === 0 ? "ok" : "warn"}, fields=${fieldsPresent}`;
				if (val.code !== 0) detail += `: ${val.stderr.slice(0, 120)}`;
			} else {
				detail = `terraform init failed (provider unavailable?); fell back to keyword presence=${fieldsPresent}`;
			}
		}
		return cell(ok, run, detail);
	} finally {
		fs.rmSync(workdir, { recursive: true, force: true });
	}

	function cell(ok: boolean, run: XcshRun, detail: string): Cell {
		return {
			modality: "hcl",
			id,
			phrase: p.phrase,
			operation: p.operation,
			resource: p.expect_resource ?? "(command)",
			status: run.timedOut ? "FAIL" : ok ? "PASS" : "FAIL",
			durationMs: performance.now() - start,
			detail: run.timedOut ? "timed out" : detail,
			routedTo: "file",
		};
	}
}

export interface I18nPhrase {
	id: string;
	resource_name: string;
	expected_resource_type: string;
	expected_fields: string[];
	phrase_en: string;
	translations: Record<string, string>;
}

export async function runI18n(p: I18nPhrase, locale: string, cfg: MatrixConfig): Promise<Cell> {
	const start = performance.now();
	const phrase = locale === "en" ? p.phrase_en : p.translations[locale];
	const id = `${p.id}-${locale}`;
	if (!phrase) {
		return {
			modality: "i18n",
			id,
			phrase: `(missing ${locale})`,
			operation: "create",
			resource: p.expected_resource_type,
			locale,
			status: "SKIP",
			durationMs: 0,
			detail: `no ${locale} translation`,
		};
	}
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-i18n-"));
	try {
		const run = await runXcsh(["--print", "--no-session", phrase], {
			timeoutMs: 120_000,
			bin: cfg.xcshBin,
			cwd: workdir,
			env: { ...process.env, XCSH_API_URL: cfg.apiUrl },
		});
		const hcl = extractHcl(run.stdout, workdir);
		const ok = hcl.includes(p.expected_resource_type) && p.expected_fields.every(f => hcl.includes(f));
		return {
			modality: "i18n",
			id,
			phrase,
			operation: "create",
			resource: p.expected_resource_type,
			locale,
			status: run.timedOut ? "FAIL" : ok ? "PASS" : "FAIL",
			durationMs: performance.now() - start,
			detail: run.timedOut ? "timed out" : ok ? "resource+fields present" : "missing resource/fields in HCL",
			routedTo: "file",
		};
	} finally {
		fs.rmSync(workdir, { recursive: true, force: true });
	}
}

export { terraformAvailable };
