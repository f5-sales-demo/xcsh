#!/usr/bin/env bun
/**
 * Live-model Office/Excel certification harness.
 *
 * This starts the binary under test in the requested MEDDPICC workspace, talks
 * to its real Office bridge, and services the production Excel host-tool
 * definitions against a stateful workbook fake. Real Excel remains the final
 * WebView/Office.js acceptance surface; this script owns the repeatable binary,
 * model, plugin, prompt, filesystem, and workbook oracle underneath it.
 */
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import { wireExcelHostTools } from "../src/office/excel-tools";
import { fakeExcel } from "../test/support/fake-excel";
import {
	discoverOfficeBridge,
	OFFICE_WS_RANGE_END,
	OFFICE_WS_RANGE_START,
	type UatBridgeClient,
	waitForOfficeApplicationReady,
} from "./uat/bridge-client";
import {
	MEDDPICC_STEPS,
	renderMeddpiccRunbook,
	type ScenarioAssertion,
	type ScenarioObservation,
	validateMeddpiccStep,
} from "./uat/meddpicc-scenario";

const OFFICE_PANE_PORT = 8444;
const EXPECTED_FIXTURE_SHA256 = "8394bcd6485adca57e72fd53f2c149f026c3bb9652f7809dfa3614438bd6cd75";
const EXPECTED_PLUGIN_VERSION = "7.5.3";
const EXPECTED_MODEL = "gpt-5.6-sol";

export interface UatMeddpiccOptions {
	binary?: string;
	workspace?: string;
	fixture?: string;
	evidence?: string;
	printPrompts: boolean;
	help: boolean;
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface InstalledPlugin {
	id: string;
	version: string;
}

interface ScenarioRunEvidence {
	step: number;
	repeat: number;
	title: string;
	prompt: string;
	ended: "chat_done" | "chat_error";
	reason?: string;
	durationMs: number;
	reply: string;
	toolNotices: ScenarioObservation["toolNotices"];
	hostToolCalls: ScenarioObservation["hostToolCalls"];
	filesBefore: ScenarioObservation["filesBefore"];
	filesAfter: ScenarioObservation["filesAfter"];
	workbookBefore: ScenarioObservation["workbookBefore"];
	workbookAfter: ScenarioObservation["workbookAfter"];
	assertions: ScenarioAssertion[];
	passed: boolean;
}

interface UatEvidence {
	schemaVersion: 1;
	startedAt: string;
	finishedAt?: string;
	status: "running" | "passed" | "failed";
	error?: string;
	binary?: { path: string; realPath: string; version: string; sha256: string };
	gitSha?: string;
	cwd?: string;
	fixture?: { path: string; sha256: string; bytes: number };
	plugin?: InstalledPlugin;
	bridge?: { port: number; pid: number; contractVersion: string | null };
	configure?: { modelOmitted: true; acknowledgement: string };
	runs: ScenarioRunEvidence[];
}

const USAGE = `Usage:
  bun run uat:meddpicc-excel --binary <xcsh> --workspace <dir> \\
    --fixture <example-deal.json> --evidence <evidence.json>
  bun run uat:meddpicc-excel --print-prompts

Required for a live run:
  --binary       Local build or installed xcsh binary to certify
  --workspace    Dedicated folder from which office serve will run
  --fixture      Canonical MEDDPICC example-deal.json source
  --evidence     Destination for sanitized JSON evidence

Environment:
  LITELLM_BASE_URL must be the full HTTPS OpenAI-compatible API base, including
  its path (for example, https://gateway.example.com/v1), and LITELLM_API_KEY
  must be set. The configure frame omits model so the binary must select its
  baked litellm/gpt-5.6-sol:high default.`;

export function requireGatewayApiBaseUrl(raw: string): string {
	const normalized = raw.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error("LITELLM_BASE_URL must be a valid https:// URL");
	}
	if (parsed.protocol !== "https:") throw new Error("LITELLM_BASE_URL must use https://");
	if (parsed.pathname === "/") {
		throw new Error("LITELLM_BASE_URL must include the OpenAI-compatible API base path, such as /v1 or /api/v1");
	}
	return normalized;
}

export function parseUatMeddpiccArgs(argv: string[]): UatMeddpiccOptions {
	const result: UatMeddpiccOptions = { printPrompts: false, help: false };
	const valueFlags = new Set(["binary", "workspace", "fixture", "evidence"]);
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--print-prompts") {
			result.printPrompts = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			result.help = true;
			continue;
		}
		if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
		const equals = argument.indexOf("=");
		const name = argument.slice(2, equals === -1 ? undefined : equals);
		if (!valueFlags.has(name)) throw new Error(`Unknown option: --${name}`);
		const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
		if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
		result[name as "binary" | "workspace" | "fixture" | "evidence"] = value;
	}
	return result;
}

function requiredLiveOptions(
	options: UatMeddpiccOptions,
): asserts options is UatMeddpiccOptions &
	Required<Pick<UatMeddpiccOptions, "binary" | "workspace" | "fixture" | "evidence">> {
	const missing = (["binary", "workspace", "fixture", "evidence"] as const).filter(name => !options[name]);
	if (missing.length > 0)
		throw new Error(`Missing required option(s): ${missing.map(name => `--${name}`).join(", ")}`);
}

function sha256Bytes(bytes: Uint8Array | ArrayBuffer | string): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function sha256File(file: string): Promise<string> {
	return sha256Bytes(await Bun.file(file).arrayBuffer());
}

async function resolveBinary(input: string): Promise<{ path: string; realPath: string }> {
	const binaryPath = input.includes(path.sep) ? path.resolve(input) : Bun.which(input);
	if (!binaryPath) throw new Error(`Binary not found: ${input}`);
	const stat = await fs.stat(binaryPath).catch(() => null);
	if (!stat?.isFile()) throw new Error(`Binary is not a regular file: ${binaryPath}`);
	return { path: binaryPath, realPath: await fs.realpath(binaryPath) };
}

function runCommand(command: string[], cwd: string): CommandResult {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function requireSuccessfulCommand(result: CommandResult, label: string): string {
	if (result.exitCode !== 0)
		throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
	return result.stdout;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end < start) throw new Error(`${label} did not return JSON`);
	return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function installedMeddpicc(binary: string, workspace: string): InstalledPlugin {
	const output = requireSuccessfulCommand(
		runCommand([binary, "plugin", "list", "--json"], workspace),
		"xcsh plugin list --json",
	);
	const parsed = parseJsonObject(output, "xcsh plugin list --json");
	const plugins = Array.isArray(parsed.marketplace) ? parsed.marketplace : [];
	for (const value of plugins) {
		if (!value || typeof value !== "object") continue;
		const plugin = value as { id?: unknown; entries?: unknown };
		if (plugin.id !== "meddpicc@f5-sales-demo-marketplace" || !Array.isArray(plugin.entries)) continue;
		const active = plugin.entries[0] as { version?: unknown } | undefined;
		if (typeof active?.version === "string") return { id: plugin.id, version: active.version };
	}
	throw new Error("meddpicc@f5-sales-demo-marketplace is not installed");
}

async function prepareFixture(workspaceInput: string, fixtureInput: string) {
	await fs.mkdir(workspaceInput, { recursive: true });
	const workspace = await fs.realpath(workspaceInput);
	const fixtureSource = await fs.realpath(fixtureInput).catch(() => "");
	if (!fixtureSource) throw new Error(`Fixture not found: ${fixtureInput}`);
	const sourceStat = await fs.stat(fixtureSource);
	if (!sourceStat.isFile()) throw new Error(`Fixture is not a regular file: ${fixtureSource}`);
	const sourceSha = await sha256File(fixtureSource);
	if (sourceSha !== EXPECTED_FIXTURE_SHA256) {
		throw new Error(`Fixture SHA-256 is ${sourceSha}; expected ${EXPECTED_FIXTURE_SHA256}`);
	}

	const target = path.join(workspace, "example-corp.json");
	if (fixtureSource !== target) {
		const targetStat = await fs.stat(target).catch(() => null);
		if (targetStat) {
			const targetSha = targetStat.isFile() ? await sha256File(target) : "not-a-file";
			if (targetSha !== sourceSha) {
				throw new Error(`Refusing to overwrite non-canonical workspace fixture: ${target}`);
			}
		} else {
			await fs.copyFile(fixtureSource, target);
		}
	}
	const targetStat = await fs.stat(target);
	return { workspace, path: target, sha256: sourceSha, bytes: targetStat.size };
}

async function snapshotFiles(root: string): Promise<ScenarioObservation["filesBefore"]> {
	const entries: ScenarioObservation["filesBefore"] = [];
	async function visit(directory: string): Promise<void> {
		const children = await fs.readdir(directory, { withFileTypes: true });
		children.sort((left, right) => left.name.localeCompare(right.name));
		for (const child of children) {
			const absolute = path.join(directory, child.name);
			if (child.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!child.isFile()) continue;
			const stat = await fs.stat(absolute);
			entries.push({
				path: path.relative(root, absolute).split(path.sep).join("/"),
				sha256: await sha256File(absolute),
				bytes: stat.size,
			});
		}
	}
	await visit(root);
	return entries;
}

export function isTcpPortListening(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		let settled = false;
		const finish = (listening: boolean): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(listening);
		};
		socket.setTimeout(500, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

async function stopSpawnedChild(child: ReturnType<typeof Bun.spawn>): Promise<void> {
	let exited = false;
	void child.exited.then(() => {
		exited = true;
	});
	if (!exited) child.kill("SIGTERM");
	await Promise.race([child.exited, Bun.sleep(5_000)]);
	if (!exited) {
		child.kill("SIGKILL");
		await child.exited;
	}
}

function redactText(text: string, secrets: string[]): string {
	let redacted = text;
	for (const secret of secrets) {
		if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
	}
	return redacted
		.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
		.replace(/\b(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;"']+/gi, match => {
			const separator = match.includes(":") ? ":" : "=";
			return `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED]`;
		});
}

function sanitizeEvidence<T>(value: T, secrets: string[]): T {
	if (typeof value === "string") return redactText(value, secrets) as T;
	if (Array.isArray(value)) return value.map(item => sanitizeEvidence(item, secrets)) as T;
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item, secrets)]),
		) as T;
	}
	return value;
}

async function writeEvidence(file: string, evidence: UatEvidence, secrets: string[]): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const sanitized = sanitizeEvidence(evidence, secrets);
	await Bun.write(file, `${JSON.stringify(sanitized, null, 2)}\n`);
}

async function runScenarioStep(
	bridge: UatBridgeClient,
	workspace: string,
	workbook: ReturnType<typeof fakeExcel>,
	stepIndex: number,
	repeat: number,
): Promise<ScenarioRunEvidence> {
	const step = MEDDPICC_STEPS[stepIndex];
	const filesBefore = await snapshotFiles(workspace);
	const workbookBefore = workbook.snapshot();
	const turn = await bridge.turn(step.prompt, `c-uat-meddpicc-${step.number}-${repeat}`);
	const filesAfter = await snapshotFiles(workspace);
	const workbookAfter = workbook.snapshot();
	const observation: ScenarioObservation = {
		reply: turn.reply,
		workspace,
		filesBefore,
		filesAfter,
		toolNotices: turn.toolNotices,
		hostToolCalls: turn.hostToolCalls.map(call => ({ toolName: call.toolName, arguments: call.arguments })),
		workbookBefore,
		workbookAfter,
	};
	const assertions = [
		{ label: "turn completed with chat_done", passed: turn.ended === "chat_done", detail: turn.reason },
		{
			label: "every reported tool completed successfully",
			passed: turn.toolNotices.every(notice => notice.ok),
		},
		...validateMeddpiccStep(step.number, observation),
	].map(value => ({
		label: value.label,
		passed: value.passed,
		...(value.detail ? { detail: value.detail } : {}),
	}));
	return {
		step: step.number,
		repeat,
		title: step.title,
		prompt: step.prompt,
		ended: turn.ended,
		...(turn.reason ? { reason: turn.reason } : {}),
		durationMs: turn.durationMs,
		reply: turn.reply,
		toolNotices: observation.toolNotices,
		hostToolCalls: observation.hostToolCalls,
		filesBefore,
		filesAfter,
		workbookBefore,
		workbookAfter,
		assertions,
		passed: assertions.every(assertion => assertion.passed),
	};
}

async function runLive(options: UatMeddpiccOptions): Promise<void> {
	requiredLiveOptions(options);
	const evidencePath = path.resolve(options.evidence);
	const secrets = [process.env.LITELLM_API_KEY ?? ""];
	const evidence: UatEvidence = {
		schemaVersion: 1,
		startedAt: new Date().toISOString(),
		status: "running",
		runs: [],
	};
	let child: ReturnType<typeof Bun.spawn> | null = null;
	let bridge: UatBridgeClient | null = null;
	let dispatcher: ReturnType<typeof wireExcelHostTools>["dispatcher"] | null = null;
	let stdoutPromise: Promise<string> | null = null;
	let stderrPromise: Promise<string> | null = null;

	try {
		const baseUrlInput = process.env.LITELLM_BASE_URL ?? "";
		const token = process.env.LITELLM_API_KEY?.trim() ?? "";
		if (!baseUrlInput.trim() || !token) throw new Error("LITELLM_BASE_URL and LITELLM_API_KEY are required");
		const baseUrl = requireGatewayApiBaseUrl(baseUrlInput);

		const prepared = await prepareFixture(path.resolve(options.workspace), path.resolve(options.fixture));
		evidence.cwd = prepared.workspace;
		evidence.fixture = { path: prepared.path, sha256: prepared.sha256, bytes: prepared.bytes };

		const binary = await resolveBinary(options.binary);
		const version = requireSuccessfulCommand(
			runCommand([binary.path, "--version"], prepared.workspace),
			"xcsh --version",
		);
		evidence.binary = {
			...binary,
			version,
			sha256: await sha256File(binary.realPath),
		};
		const repoRoot = path.resolve(import.meta.dir, "../../..");
		evidence.gitSha = requireSuccessfulCommand(
			runCommand(["git", "rev-parse", "HEAD"], repoRoot),
			"git rev-parse HEAD",
		);

		const plugin = installedMeddpicc(binary.path, prepared.workspace);
		if (plugin.version !== EXPECTED_PLUGIN_VERSION) {
			throw new Error(`Installed MEDDPICC is ${plugin.version}; ${EXPECTED_PLUGIN_VERSION} is required`);
		}
		evidence.plugin = plugin;

		if (await isTcpPortListening(OFFICE_PANE_PORT)) {
			throw new Error(
				`TCP port ${OFFICE_PANE_PORT} is already occupied; refusing to supersede a server the harness did not start`,
			);
		}
		for (let port = OFFICE_WS_RANGE_START; port <= OFFICE_WS_RANGE_END; port++) {
			if (await isTcpPortListening(port)) {
				throw new Error(
					`TCP port ${port} is already occupied; refusing to adopt an Office bridge the harness did not start`,
				);
			}
		}

		console.log(`Starting ${binary.path} office serve in ${prepared.workspace}`);
		const spawned = Bun.spawn([binary.path, "office", "serve"], {
			cwd: prepared.workspace,
			env: process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		child = spawned;
		stdoutPromise = new Response(spawned.stdout).text();
		stderrPromise = new Response(spawned.stderr).text();

		bridge = await discoverOfficeBridge({ attempts: 30, retryDelayMs: 500 });
		evidence.bridge = {
			port: bridge.port,
			pid: child.pid,
			contractVersion: bridge.ack.contractVersion ?? null,
		};
		if (!bridge.canConfigureProvider) throw new Error("Office bridge did not advertise provider configuration");
		await waitForOfficeApplicationReady(bridge);

		// Deliberately omit model. This is the end-to-end proof that the binary owns
		// litellm/gpt-5.6-sol:high as the single production default.
		const acknowledgement = await bridge.configure({ baseUrl, token });
		if (acknowledgement !== EXPECTED_MODEL) {
			throw new Error(`Office configure selected ${acknowledgement}; expected ${EXPECTED_MODEL}`);
		}
		evidence.configure = { modelOmitted: true, acknowledgement };

		const workbook = fakeExcel({}, { Start: { "A1:B1": [["sentinel", "keep"]] } });
		const wired = wireExcelHostTools(bridge, workbook);
		dispatcher = wired.dispatcher;
		const registration = bridge.waitForFrame(
			frame => frame.type === "set_host_tools_ack" || frame.type === "set_host_tools_error",
			10_000,
		);
		wired.onConnected();
		const registrationFrame = await registration;
		if (registrationFrame.type !== "set_host_tools_ack") throw new Error("Excel host-tool registration was rejected");

		for (let index = 0; index < MEDDPICC_STEPS.length; index++) {
			console.log(`Step ${index + 1}/5: ${MEDDPICC_STEPS[index].title}`);
			const run = await runScenarioStep(bridge, prepared.workspace, workbook, index, 1);
			evidence.runs.push(run);
			console.log(`  ${run.passed ? "PASS" : "FAIL"} (${run.durationMs} ms)`);
		}

		console.log("Step 5 idempotency rerun");
		const rerun = await runScenarioStep(bridge, prepared.workspace, workbook, 4, 2);
		evidence.runs.push(rerun);
		console.log(`  ${rerun.passed ? "PASS" : "FAIL"} (${rerun.durationMs} ms)`);

		const failures = evidence.runs.flatMap(run =>
			run.assertions
				.filter(assertion => !assertion.passed)
				.map(assertion => `step ${run.step}.${run.repeat}: ${assertion.label}`),
		);
		if (failures.length > 0) throw new Error(`MEDDPICC UAT failed: ${failures.join("; ")}`);
		evidence.status = "passed";
	} catch (error) {
		evidence.status = "failed";
		evidence.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		dispatcher?.dispose();
		bridge?.dispose();
		if (child) await stopSpawnedChild(child);
		evidence.finishedAt = new Date().toISOString();
		if (child && evidence.status === "failed") {
			const [stdout, stderr] = await Promise.all([stdoutPromise ?? "", stderrPromise ?? ""]);
			const tail = `${stdout}\n${stderr}`.trim().slice(-2_000);
			if (tail && evidence.error && !evidence.error.includes("port 8444")) {
				evidence.error = `${evidence.error}\noffice serve tail:\n${tail}`;
			}
		}
		await writeEvidence(evidencePath, evidence, secrets);
		console.log(`Evidence: ${evidencePath}`);
	}
}

async function main(): Promise<void> {
	let options: UatMeddpiccOptions;
	try {
		options = parseUatMeddpiccArgs(process.argv.slice(2));
		if (options.help) {
			console.log(USAGE);
			return;
		}
		if (options.printPrompts) {
			console.log(renderMeddpiccRunbook());
			if (!options.binary && !options.workspace && !options.fixture && !options.evidence) return;
		}
		await runLive(options);
	} catch (error) {
		console.error(
			redactText(error instanceof Error ? error.message : String(error), [process.env.LITELLM_API_KEY ?? ""]),
		);
		process.exitCode = 1;
	}
}

if (import.meta.main) await main();
