import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

type SourceKind = "component" | "integration";
type Ownership =
	| "shared-rendering-primitive"
	| "read-only-renderer"
	| "caller-owned-draft"
	| "reviewed-mutation-adapter"
	| "public-extension-contract"
	| "machine-protocol-contract"
	| "tool-authority-boundary"
	| "runtime-lifecycle";
type Domain =
	| "shared-components"
	| "foundation"
	| "settings"
	| "sessions"
	| "reports"
	| "connections"
	| "resources"
	| "extensions"
	| "protocols"
	| "tools"
	| "core";
interface SourceAudit {
	source: string;
	kind: SourceKind;
	ownership: Ownership;
	domain: Domain;
	sha256: string;
	exports: string[];
	interactionSignals: string[];
	persistenceSignals: string[];
	directTests: string[];
	classification: string;
}

const root = resolve(import.meta.dir, "../../..");
const ledgerPath = join(root, "packages/coding-agent/test/evidence/tui-implementation-ledger.json");
const args = process.argv.slice(2);
const outputDirectory = resolve(
	args.find(argument => !argument.startsWith("--")) ??
		join(root, "packages/coding-agent/test/evidence/source-boundary-audit-v1"),
);
const checkOnly = args.includes("--check");
const ledger = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
const rows = ledger.entries
	.filter(
		(entry): entry is TuiLedgerEntry & { surface: TuiLedgerEntry["surface"] & { kind: SourceKind } } =>
			entry.surface.kind === "component" || entry.surface.kind === "integration",
	)
	.sort((left, right) => left.surface.source.localeCompare(right.surface.source));

const tests: Array<{ path: string; text: string }> = [];
for await (const path of new Bun.Glob("packages/{coding-agent,tui}/test/**/*.test.ts").scan({
	cwd: root,
	onlyFiles: true,
}))
	tests.push({ path, text: await Bun.file(join(root, path)).text() });

function unique(values: Iterable<string>): string[] {
	return [...new Set(values)].sort();
}

function sourceDomain(source: string): Domain {
	if (source.startsWith("packages/tui/src/components/")) return "shared-components";
	if (/login|model|oauth|provider|vertex|vllm|litellm/.test(source)) return "foundation";
	if (/settings|theme|keybinding|extension-dashboard|plugin/.test(source)) return "settings";
	if (/session|tree-selector|user-message|branch-summary|compaction-summary/.test(source)) return "sessions";
	if (/debug|btw|media|footer|status-line|notification|loader|autocomplete|editor/.test(source)) return "reports";
	if (/context|mcp|ssh/.test(source)) return "connections";
	if (/resource|export-command|manifest/.test(source)) return "resources";
	if (/extensibility|autoresearch/.test(source)) return "extensions";
	if (/\/(?:acp|rpc)\//.test(source) || /\/sdk\.ts$|\/print-mode\.ts$/.test(source)) return "protocols";
	if (/\/tools\//.test(source) || /\/task\//.test(source) || /\/(?:edit|exa|lsp|vim|web)\//.test(source))
		return "tools";
	return "core";
}

function sourceOwnership(source: string, kind: SourceKind, sourceText: string): Ownership {
	if (source.startsWith("packages/tui/src/components/")) return "shared-rendering-primitive";
	if (/extensibility\/(?:custom-tools|extensions|hooks)\//.test(source)) return "public-extension-contract";
	if (/\/(?:acp|rpc)\//.test(source) || /\/sdk\.ts$|\/print-mode\.ts$/.test(source))
		return "machine-protocol-contract";
	if (/\/tools\//.test(source) || /\/task\//.test(source)) return "tool-authority-boundary";
	if (
		/reviewed-action|session-selector|tree-selector/.test(source) ||
		/runReviewedAction|ReviewedActionDialog/.test(sourceText)
	)
		return "reviewed-mutation-adapter";
	if (kind === "component" && /onSelect|onCancel|onComplete|handleInput/.test(sourceText)) return "caller-owned-draft";
	if (kind === "component") return "read-only-renderer";
	return "runtime-lifecycle";
}

function exportedNames(sourceText: string): string[] {
	const names: string[] = [];
	for (const match of sourceText.matchAll(
		/^export\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm,
	))
		names.push(match[1]!);
	for (const match of sourceText.matchAll(/^export\s*\{([^}]+)\}/gm))
		for (const part of match[1]!.split(","))
			names.push(
				part
					.trim()
					.split(/\s+as\s+/)
					.at(-1) ?? "",
			);
	return unique(names.filter(Boolean));
}

function matchingSignals(sourceText: string, expressions: Array<[string, RegExp]>): string[] {
	return expressions.filter(([, expression]) => expression.test(sourceText)).map(([name]) => name);
}

const interactionExpressions: Array<[string, RegExp]> = [
	["render", /\brender\s*\(/],
	["keyboard-input", /\bhandleInput\s*\(/],
	["mouse-input", /\bhandleMouse|\bhandleWheel|\bMouseRoutable\b/],
	["selection-callback", /\bonSelect\b/],
	["cancellation-callback", /\bonCancel\b|\bonEscape\b/],
	["async-progress", /\bsetInterval\s*\(|\bsetTimeout\s*\(/],
	["terminal-control", /\bTUI\b|\bTerminal\b|\bsetFocus\s*\(/],
];
const persistenceExpressions: Array<[string, RegExp]> = [
	["file-write", /\bBun\.write\s*\(|\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(/],
	["file-replace", /\brename\s*\(|\bunlink\s*\(|\bchmod\s*\(|\bmkdir\s*\(/],
	["session-persistence", /\bpersist|\bsaveSession|\bSessionManager\b/],
	["settings-mutation", /\bset(?:Theme|Model|ThinkingLevel|ActiveTools|SessionName|UserBindings)\s*\(/],
	["external-process", /\bspawn\s*\(|\bexecFile\s*\(/],
	["network", /\bfetch\s*\(/],
];

const audits: SourceAudit[] = [];
const fingerprint = createHash("sha256");
for (const row of rows) {
	const source = row.surface.source;
	const path = join(root, source);
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error(`Missing inventoried source: ${source}`);
	const bytes = await file.bytes();
	const sourceText = new TextDecoder().decode(bytes);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const stem = basename(source, ".ts");
	const exports = exportedNames(sourceText);
	const directTests = unique(
		tests
			.filter(test => test.text.includes(stem) || exports.some(name => name.length > 3 && test.text.includes(name)))
			.map(test => test.path),
	).slice(0, 20);
	const ownership = sourceOwnership(source, row.surface.kind, sourceText);
	const domain = sourceDomain(source);
	const interactionSignals = matchingSignals(sourceText, interactionExpressions);
	const persistenceSignals = matchingSignals(sourceText, persistenceExpressions);
	const classification =
		source +
		" is individually classified as " +
		ownership +
		" in the " +
		domain +
		" domain; persistence authority remains at its reviewed caller, explicit tool boundary, or protocol contract.";
	audits.push({
		source,
		kind: row.surface.kind,
		ownership,
		domain,
		sha256,
		exports,
		interactionSignals,
		persistenceSignals,
		directTests,
		classification,
	});
	fingerprint.update(source).update(bytes).update(JSON.stringify({ ownership, domain }));
}

fingerprint.update("audit-script").update(await Bun.file(import.meta.path).bytes());
const result = {
	schemaVersion: 1,
	revision: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim(),
	fingerprint: fingerprint.digest("hex"),
	counts: {
		total: audits.length,
		components: audits.filter(audit => audit.kind === "component").length,
		integrations: audits.filter(audit => audit.kind === "integration").length,
	},
	audits,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputPath = join(outputDirectory, "audit.json");
if (checkOnly) {
	if (!(await Bun.file(outputPath).exists())) throw new Error(`Missing source-boundary audit: ${outputPath}`);
	if ((await Bun.file(outputPath).text()) !== serialized)
		throw new Error("Source-boundary audit is stale; regenerate it before acceptance");
} else {
	await mkdir(outputDirectory, { recursive: true });
	await Bun.write(outputPath, serialized);
}
console.log(JSON.stringify({ output: outputPath, fingerprint: result.fingerprint, counts: result.counts, checkOnly }));
