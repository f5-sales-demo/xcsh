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
import * as os from "node:os";
import * as path from "node:path";
import { deflateSync } from "node:zlib";
import { wireExcelHostTools } from "../src/office/excel-tools";
import { fakeExcel } from "../test/support/fake-excel";
import {
	discoverOfficeBridge,
	OFFICE_WS_RANGE_END,
	OFFICE_WS_RANGE_START,
	type UatBridgeClient,
	type UatTurnResult,
	waitForOfficeApplicationReady,
} from "./uat/bridge-client";
import {
	MEDDPICC_STEPS,
	type MeddpiccStep,
	renderMeddpiccRunbook,
	type ScenarioAssertion,
	type ScenarioObservation,
	validateMeddpiccStep,
} from "./uat/meddpicc-scenario";

const OFFICE_PANE_PORT = 8444;
const EXPECTED_FIXTURE_SHA256 = "eb891f2b2588d5b6bafcceaaa9c6923bfd26f87f5e7bdc23971b1c61e657ced8";
const EXPECTED_PLUGIN_VERSION = "7.5.4";
const EXPECTED_MODEL = "gpt-5.6-sol";
const ALTERNATE_MODEL = "claude-opus-5";
const MODEL_PROBE_MARKER = "OFFICE MODEL READY";

const VISION_GLYPHS: Readonly<Record<string, readonly string[]>> = {
	"-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
	"0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
	"1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	"2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
	"3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
	"4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
	"5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
	"6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
	"7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	"8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
	"9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
	C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
	X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
};

export interface SyntheticVisionProbe {
	code: string;
	fileName: string;
	mimeType: "image/png";
	bytes: Uint8Array;
	sha256: string;
}

export interface VisionProbeEvidence {
	image: { fileName: string; mimeType: "image/png"; bytes: number; sha256: string };
	directAttachmentPassed: boolean;
	directAttachmentDurationMs: number;
	fileInspectionPassed: boolean;
	fileInspectionDurationMs: number;
	inspectImageToolObserved: boolean;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
	const typeBytes = Buffer.from(type, "ascii");
	const chunk = Buffer.alloc(12 + data.length);
	chunk.writeUInt32BE(data.length, 0);
	typeBytes.copy(chunk, 4);
	Buffer.from(data).copy(chunk, 8);
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
	return chunk;
}

/** Build a generated, high-contrast PNG so live vision UAT never needs customer-derived media. */
export function createSyntheticVisionProbe(code?: string): SyntheticVisionProbe {
	const resolvedCode =
		code ?? `XC-${Array.from(crypto.getRandomValues(new Uint8Array(5)), value => value % 10).join("")}`;
	if (!/^XC-\d{5}$/.test(resolvedCode)) throw new Error("Synthetic vision code must match XC-00000");

	const width = 800;
	const height = 180;
	const scale = 14;
	const stride = 1 + width * 3;
	const raw = Buffer.alloc(stride * height, 0xff);
	for (let y = 0; y < height; y++) raw[y * stride] = 0;
	const setBlack = (x: number, y: number): void => {
		const offset = y * stride + 1 + x * 3;
		raw[offset] = 0;
		raw[offset + 1] = 0;
		raw[offset + 2] = 0;
	};
	const fillBlack = (x: number, y: number, blockWidth: number, blockHeight: number): void => {
		for (let row = y; row < y + blockHeight; row++) {
			for (let column = x; column < x + blockWidth; column++) setBlack(column, row);
		}
	};

	fillBlack(12, 12, width - 24, 4);
	fillBlack(12, height - 16, width - 24, 4);
	fillBlack(12, 12, 4, height - 24);
	fillBlack(width - 16, 12, 4, height - 24);
	const advance = 6 * scale;
	const textWidth = resolvedCode.length * advance - scale;
	const startX = Math.floor((width - textWidth) / 2);
	const startY = Math.floor((height - 7 * scale) / 2);
	for (const [characterIndex, character] of [...resolvedCode].entries()) {
		const glyph = VISION_GLYPHS[character]!;
		for (const [row, pixels] of glyph.entries()) {
			for (const [column, pixel] of [...pixels].entries()) {
				if (pixel === "1")
					fillBlack(startX + characterIndex * advance + column * scale, startY + row * scale, scale, scale);
			}
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const bytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", new Uint8Array()),
	]);
	return {
		code: resolvedCode,
		fileName: `synthetic-vision-probe-${crypto.randomUUID()}.png`,
		mimeType: "image/png",
		bytes,
		sha256: sha256Bytes(bytes),
	};
}

export function directVisionProbePrompt(): string {
	return "Read the exact uppercase code in the attached synthetic image. Reply with the code only. Do not use tools.";
}

export function fileVisionProbePrompt(fileName: string): string {
	return `Use inspect_image on ${fileName} to read the exact uppercase code. Reply with the code only.`;
}

function turnReadCode(turn: UatTurnResult, code: string): boolean {
	return turn.ended === "chat_done" && turn.reply.toUpperCase().includes(code);
}

export function summarizeVisionProbe(
	probe: SyntheticVisionProbe,
	direct: UatTurnResult,
	inspected: UatTurnResult,
): VisionProbeEvidence {
	const inspectImageToolObserved = inspected.toolNotices.some(notice => notice.tool === "inspect_image" && notice.ok);
	return {
		image: {
			fileName: probe.fileName,
			mimeType: probe.mimeType,
			bytes: probe.bytes.length,
			sha256: probe.sha256,
		},
		directAttachmentPassed:
			turnReadCode(direct, probe.code) &&
			direct.toolNotices.every(notice => notice.ok) &&
			direct.hostToolCalls.length === 0,
		directAttachmentDurationMs: direct.durationMs,
		fileInspectionPassed:
			turnReadCode(inspected, probe.code) &&
			inspectImageToolObserved &&
			inspected.toolNotices.every(notice => notice.ok),
		fileInspectionDurationMs: inspected.durationMs,
		inspectImageToolObserved,
	};
}

export function assertVisionProbePassed(summary: VisionProbeEvidence): void {
	if (!summary.directAttachmentPassed) throw new Error("GPT-5.6 Sol direct image attachment probe failed");
	if (!summary.fileInspectionPassed) throw new Error("GPT-5.6 Sol inspect_image probe failed");
}

export function requireMeddpiccScenarioModel(currentModel: string): string {
	if (currentModel !== EXPECTED_MODEL) throw new Error("MEDDPICC scenario did not start under GPT-5.6 Sol");
	return currentModel;
}

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

export interface ScenarioRunEvidence {
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

interface ModelRoundTripEvidence {
	advertisedModels: string[];
	initialModel: string;
	initialTurnPassed: boolean;
	initialTurnDurationMs: number;
	alternateModel: string;
	alternateTurnPassed: boolean;
	alternateTurnDurationMs: number;
	restoredModel: string;
	restoredTurnPassed: boolean;
	restoredTurnDurationMs: number;
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
	modelRoundTrip?: ModelRoundTripEvidence;
	visionProbe?: VisionProbeEvidence;
	scenarioModel?: string;
	runs: ScenarioRunEvidence[];
}

const USAGE = `Usage:
  bun run uat:meddpicc-excel --binary <xcsh> --workspace <dir> \\
    --fixture <example-deal.json> --evidence <evidence.json>
  bun run uat:meddpicc-excel --print-prompts

Required for a live run:
  --binary       Local build or installed xcsh binary to certify
  --workspace    Dedicated folder from which office serve will run
  --fixture      Canonical, role-aliased MEDDPICC example-deal.json source
  --evidence     Destination for sanitized JSON evidence

Environment:
  LITELLM_BASE_URL is the HTTPS gateway root (for example,
  https://gateway.example.com), and LITELLM_API_KEY must be set. Legacy provider
  paths are normalized to the root. xcsh derives the provider path from the
  selected model and the UAT proves GPT-5.6 Sol -> Claude Opus 5 -> GPT-5.6 Sol.`;

export function requireGatewayRootUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		throw new Error("LITELLM_BASE_URL must be a valid https:// URL");
	}
	if (parsed.protocol !== "https:") throw new Error("LITELLM_BASE_URL must use https://");
	return parsed.origin;
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
	const missing: string[] = (["binary", "workspace", "fixture", "evidence"] as const).filter(name => !options[name]);
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

const ROLE_ALIAS = /^<[A-Z][A-Z0-9_]*>$/;
const OWNED_ROLE_ALIAS = /^<[A-Z][A-Z0-9_]*>(?: \([A-Z][A-Z0-9_-]*\))?$/;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Refuse development fixtures whose identity fields are not visibly synthetic role aliases. */
export function assertSyntheticFixtureUsesRoleAliases(fixture: unknown): void {
	const deal = record(fixture);
	const invalid: string[] = [];
	const requireAlias = (field: string, value: unknown, pattern = ROLE_ALIAS): void => {
		if (typeof value !== "string" || !pattern.test(value)) invalid.push(field);
	};

	const metadata = record(deal?.metadata);
	requireAlias("metadata.reviewer", metadata?.reviewer);

	const stakeholders = Array.isArray(deal?.stakeholders) ? deal.stakeholders : [];
	for (const [index, value] of stakeholders.entries()) {
		const stakeholder = record(value);
		requireAlias(`stakeholders[${index}].name`, stakeholder?.name);
		requireAlias(`stakeholders[${index}].relationshipOwner`, stakeholder?.relationshipOwner);
	}

	const closePlan = record(deal?.closePlan);
	const actions = Array.isArray(closePlan?.criticalActions) ? closePlan.criticalActions : [];
	for (const [index, value] of actions.entries()) {
		requireAlias(`closePlan.criticalActions[${index}].owner`, record(value)?.owner, OWNED_ROLE_ALIAS);
	}

	const team = record(deal?.team);
	for (const group of ["internal", "partner"] as const) {
		const members = Array.isArray(team?.[group]) ? team[group] : [];
		for (const [index, value] of members.entries()) {
			requireAlias(`team.${group}[${index}].name`, record(value)?.name);
		}
	}

	if (invalid.length > 0) {
		throw new Error(
			`Synthetic MEDDPICC fixture identity fields must use <ROLE_ALIAS> role aliases: ${invalid.join(", ")}`,
		);
	}
}

async function prepareFixture(workspaceInput: string, fixtureInput: string) {
	await fs.mkdir(workspaceInput, { recursive: true });
	const workspace = await fs.realpath(workspaceInput);
	const fixtureSource = await fs.realpath(fixtureInput).catch(() => "");
	if (!fixtureSource) throw new Error(`Fixture not found: ${fixtureInput}`);
	const sourceStat = await fs.stat(fixtureSource);
	if (!sourceStat.isFile()) throw new Error(`Fixture is not a regular file: ${fixtureSource}`);
	const fixture = JSON.parse(await fs.readFile(fixtureSource, "utf8")) as unknown;
	assertSyntheticFixtureUsesRoleAliases(fixture);
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

function redactText(text: string, secrets: string[], homeDirectory: string = os.homedir()): string {
	let redacted = text;
	for (const secret of secrets) {
		if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
	}
	if (homeDirectory) redacted = redacted.replaceAll(homeDirectory, "<HOME>");
	return redacted
		.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
		.replace(/\b(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;"']+/gi, match => {
			const separator = match.includes(":") ? ":" : "=";
			return `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED]`;
		});
}

export function sanitizeEvidence<T>(value: T, secrets: string[], homeDirectory: string = os.homedir()): T {
	if (typeof value === "string") return redactText(value, secrets, homeDirectory) as T;
	if (Array.isArray(value)) return value.map(item => sanitizeEvidence(item, secrets, homeDirectory)) as T;
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item, secrets, homeDirectory)]),
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
	steps: readonly MeddpiccStep[],
	validate: (stepNumber: number, observation: ScenarioObservation) => ScenarioAssertion[],
	stepIndex: number,
	repeat: number,
): Promise<ScenarioRunEvidence> {
	const step = steps[stepIndex];
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
		...validate(step.number, observation),
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

function modelList(frame: { type?: string; [key: string]: unknown }): { current: string; models: string[] } {
	if (frame.type !== "models" || typeof frame.current !== "string" || !Array.isArray(frame.models)) {
		throw new Error("Office bridge returned an invalid model list");
	}
	const models = frame.models
		.map(value =>
			value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
				? (value as { id: string }).id
				: null,
		)
		.filter((value): value is string => value !== null);
	if (!models.includes(EXPECTED_MODEL) || !models.includes(ALTERNATE_MODEL)) {
		throw new Error("Office bridge did not advertise both presentation models");
	}
	return { current: frame.current, models };
}

async function probeModel(bridge: UatBridgeClient, id: string): Promise<{ passed: true; durationMs: number }> {
	const turn = await bridge.turn(`Reply with exactly ${MODEL_PROBE_MARKER}. Do not use tools.`, `c-uat-model-${id}`);
	const passed =
		turn.ended === "chat_done" &&
		turn.reply.includes(MODEL_PROBE_MARKER) &&
		turn.toolNotices.every(notice => notice.ok) &&
		turn.hostToolCalls.length === 0;
	if (!passed) throw new Error("Office model inference probe failed");
	return { passed: true, durationMs: turn.durationMs };
}

async function proveModelRoundTrip(
	bridge: UatBridgeClient,
	baseUrl: string,
	token: string,
): Promise<ModelRoundTripEvidence> {
	const initialList = modelList(await bridge.request({ type: "list_models" }, "models"));
	if (initialList.current !== EXPECTED_MODEL) throw new Error("Office bridge default model did not match GPT-5.6 Sol");
	const initial = await probeModel(bridge, "initial");

	const alternateModel = await bridge.configure({ baseUrl, token, model: ALTERNATE_MODEL });
	if (alternateModel !== ALTERNATE_MODEL) throw new Error("Office bridge did not select Claude Opus 5");
	const alternate = await probeModel(bridge, "alternate");

	const restoredModel = await bridge.configure({ baseUrl, token, model: EXPECTED_MODEL });
	if (restoredModel !== EXPECTED_MODEL) throw new Error("Office bridge did not restore GPT-5.6 Sol");
	const restored = await probeModel(bridge, "restored");
	const restoredList = modelList(await bridge.request({ type: "list_models" }, "models"));
	if (restoredList.current !== EXPECTED_MODEL)
		throw new Error("Office bridge model list did not reflect the restored model");

	return {
		advertisedModels: initialList.models,
		initialModel: initialList.current,
		initialTurnPassed: initial.passed,
		initialTurnDurationMs: initial.durationMs,
		alternateModel,
		alternateTurnPassed: alternate.passed,
		alternateTurnDurationMs: alternate.durationMs,
		restoredModel,
		restoredTurnPassed: restored.passed,
		restoredTurnDurationMs: restored.durationMs,
	};
}

async function proveVisionInput(bridge: UatBridgeClient, workspace: string): Promise<VisionProbeEvidence> {
	const probe = createSyntheticVisionProbe();
	await fs.writeFile(path.join(workspace, probe.fileName), probe.bytes, { flag: "wx" });
	const direct = await bridge.turn(directVisionProbePrompt(), "c-uat-vision-direct", [
		{ data: Buffer.from(probe.bytes).toString("base64"), mimeType: probe.mimeType },
	]);
	const inspected = await bridge.turn(fileVisionProbePrompt(probe.fileName), "c-uat-vision-file");
	const summary = summarizeVisionProbe(probe, direct, inspected);
	assertVisionProbePassed(summary);
	return summary;
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
	let failure: unknown = null;

	try {
		const baseUrlInput = process.env.LITELLM_BASE_URL ?? "";
		const token = process.env.LITELLM_API_KEY?.trim() ?? "";
		if (!baseUrlInput.trim() || !token) throw new Error("LITELLM_BASE_URL and LITELLM_API_KEY are required");
		const baseUrl = requireGatewayRootUrl(baseUrlInput);

		const prepared = await prepareFixture(path.resolve(options.workspace), path.resolve(options.fixture));
		evidence.cwd = prepared.workspace;
		evidence.fixture = { path: prepared.path, sha256: prepared.sha256, bytes: prepared.bytes };

		const binary = await resolveBinary(options.binary);
		const version = requireSuccessfulCommand(
			runCommand([binary.path, "--version"], prepared.workspace),
			"xcsh --version",
		);
		const binarySha256 = await sha256File(binary.realPath);
		evidence.binary = { ...binary, version, sha256: binarySha256 };
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

		console.log(redactText(`Starting ${binary.path} office serve in ${prepared.workspace}`, secrets));
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
		evidence.bridge = { port: bridge.port, pid: child.pid, contractVersion: bridge.ack.contractVersion ?? null };
		if (!bridge.canConfigureProvider) throw new Error("Office bridge did not advertise provider configuration");
		await waitForOfficeApplicationReady(bridge);

		// Deliberately omit model. This is the end-to-end proof that the binary owns
		// litellm/gpt-5.6-sol:high as the vision-capable production default.
		const acknowledgement = await bridge.configure({ baseUrl, token });
		if (acknowledgement !== EXPECTED_MODEL) {
			throw new Error(`Office configure selected ${acknowledgement}; expected ${EXPECTED_MODEL}`);
		}
		evidence.configure = { modelOmitted: true, acknowledgement };

		evidence.modelRoundTrip = await proveModelRoundTrip(bridge, baseUrl, token);
		evidence.visionProbe = await proveVisionInput(bridge, prepared.workspace);
		const scenarioList = modelList(await bridge.request({ type: "list_models" }, "models"));
		evidence.scenarioModel = requireMeddpiccScenarioModel(scenarioList.current);

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

		const steps = MEDDPICC_STEPS;
		for (let index = 0; index < steps.length; index++) {
			console.log(`Step ${index + 1}/5: ${steps[index].title}`);
			const run = await runScenarioStep(bridge, prepared.workspace, workbook, steps, validateMeddpiccStep, index, 1);
			evidence.runs.push(run);
			console.log(`  ${run.passed ? "PASS" : "FAIL"} (${run.durationMs} ms)`);
		}

		console.log("Step 5 idempotency rerun");
		const rerun = await runScenarioStep(bridge, prepared.workspace, workbook, steps, validateMeddpiccStep, 4, 2);
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
		failure = error;
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
		let evidenceWritten = false;
		try {
			await writeEvidence(evidencePath, evidence, secrets);
			evidenceWritten = true;
		} catch (error) {
			failure = error;
		}
		if (evidenceWritten) {
			console.log(redactText(`Evidence: ${evidencePath}`, secrets));
		}
	}
	if (failure) throw failure;
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
