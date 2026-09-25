import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

export type ReadabilityPolicy = "wrap" | "truncate-with-full-detail" | "intentionally-compact";
export type FindingStatus = "verified" | "finding-open";

export interface ReadabilityLedgerEntry {
	id: string;
	surface: string;
	source: string;
	sinks: string[];
	category: string;
	policy: ReadabilityPolicy;
	reproductionWidth: number;
	fixture: string;
	status: FindingStatus;
	issue: string;
	tests: string[];
	terminalUat: string;
	mergedPr: string;
	detailView?: boolean;
}

export interface ReadabilityLedger {
	version: 1;
	sourceRoots: string[];
	sinkNames: string[];
	entries: ReadabilityLedgerEntry[];
}

export interface ReadabilitySink {
	file: string;
	line: number;
	sink: string;
	entry: string | null;
}

interface AuditOptions {
	packageRoot: string;
	ledger?: ReadabilityLedger;
	sources?: Record<string, string>;
	checkEvidence?: boolean;
	writeEvidence?: boolean;
}

const LEDGER_FILE = "tui-readability-ledger.json";
const EVIDENCE_FILE = "tui-readability-evidence.json";

function stableJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashSegments(value: string): string[] {
	return sha256(value).match(/.{8}/gu) ?? [];
}

async function sourceFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async entry => {
			const target = path.join(root, entry.name);
			if (entry.isDirectory()) return sourceFiles(target);
			return /\.(?:ts|tsx)$/u.test(entry.name) ? [target] : [];
		}),
	);
	return files.flat();
}

function sourceMatches(pattern: string, file: string): boolean {
	if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -3));
	return pattern === file;
}

function findSinks(sources: Record<string, string>, sinkNames: string[]): ReadabilitySink[] {
	const found: ReadabilitySink[] = [];
	for (const [file, source] of Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))) {
		for (const [index, line] of source.split("\n").entries()) {
			for (const sink of sinkNames) {
				const escaped = sink.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
				const expression =
					sink === "SelectList" || sink === "TruncatedText"
						? new RegExp(`\\bnew\\s+${escaped}\\s*\\(`, "u")
						: new RegExp(`\\b${escaped}\\s*\\(`, "u");
				if (!expression.test(line) || new RegExp(`\\b(?:function|class)\\s+${escaped}\\b`, "u").test(line))
					continue;
				found.push({ file, line: index + 1, sink, entry: null });
			}
		}
	}
	return found;
}

function validateEntry(entry: ReadabilityLedgerEntry): string[] {
	const errors: string[] = [];
	if (entry.category === "prose" && entry.policy !== "wrap" && entry.status === "verified") {
		errors.push(`Prose must use the wrap policy: ${entry.id}`);
	}
	if (entry.policy === "truncate-with-full-detail" && entry.detailView !== true && entry.status === "verified") {
		errors.push(`truncate-with-full-detail requires detailView=true: ${entry.id}`);
	}
	if (entry.status === "finding-open" && !/^#\d+$/u.test(entry.issue)) {
		errors.push(`Open finding requires a child issue: ${entry.id}`);
	}
	if (entry.reproductionWidth < 20 || entry.fixture.trim() === "" || entry.tests.length === 0) {
		errors.push(`Incomplete reproduction evidence: ${entry.id}`);
	}
	return errors;
}

export async function auditTuiReadability(
	options: AuditOptions,
): Promise<{ errors: string[]; sinks: ReadabilitySink[] }> {
	const repoRoot = path.resolve(options.packageRoot, "../..");
	const ledger =
		options.ledger ?? ((await Bun.file(path.join(options.packageRoot, LEDGER_FILE)).json()) as ReadabilityLedger);
	const sources: Record<string, string> = options.sources ?? {};
	if (!options.sources) {
		for (const sourceRoot of ledger.sourceRoots) {
			for (const file of await sourceFiles(path.join(repoRoot, sourceRoot))) {
				const relative = path.relative(repoRoot, file).split(path.sep).join("/");
				sources[relative] = await Bun.file(file).text();
			}
		}
	}

	const errors = ledger.entries.flatMap(validateEntry);
	const sinks = findSinks(sources, ledger.sinkNames).map(sink => {
		const entry = ledger.entries.find(
			candidate => candidate.sinks.includes(sink.sink) && sourceMatches(candidate.source, sink.file),
		);
		if (!entry) errors.push(`Unclassified TUI sink: ${sink.file}:${sink.line} ${sink.sink}`);
		return { ...sink, entry: entry?.id ?? null };
	});
	for (const entry of ledger.entries) {
		if (!sinks.some(sink => sink.entry === entry.id)) errors.push(`Ledger entry matches no TUI sink: ${entry.id}`);
	}

	const sinkSources = Object.fromEntries(
		[...new Set(sinks.map(sink => sink.file))].sort().map(file => [file, hashSegments(sources[file] ?? "")]),
	);
	const evidence = stableJson({
		version: 1,
		ledgerSha256: hashSegments(stableJson(ledger)),
		sourceSha256: sinkSources,
		sinks,
	});
	const evidencePath = path.join(options.packageRoot, EVIDENCE_FILE);
	if (options.writeEvidence) await Bun.write(evidencePath, evidence);
	if (options.checkEvidence && (await Bun.file(evidencePath).text()) !== evidence) {
		errors.push("Generated TUI readability evidence is stale; run bun run audit:tui-readability:write");
	}
	return { errors, sinks };
}

if (import.meta.main) {
	const packageRoot = path.resolve(import.meta.dir, "..");
	const writeEvidence = process.argv.includes("--write");
	const result = await auditTuiReadability({ packageRoot, writeEvidence, checkEvidence: !writeEvidence });
	if (result.errors.length > 0) {
		for (const error of result.errors) console.error(error);
		process.exit(1);
	}
	console.log(`${writeEvidence ? "Wrote" : "Verified"} ${result.sinks.length} classified TUI readability sinks.`);
}
