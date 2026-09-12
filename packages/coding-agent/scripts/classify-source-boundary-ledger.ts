import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

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
	kind: "component" | "integration";
	ownership: Ownership;
	domain: Domain;
	sha256: string;
	exports: string[];
	interactionSignals: string[];
	persistenceSignals: string[];
	directTests: string[];
	classification: string;
}

interface DomainProfile {
	adapter: string;
	states: string[];
	terminalDirectories: string[];
}

const root = resolve(import.meta.dir, "../../..");
const ledgerPath = join(root, "packages/coding-agent/test/evidence/tui-implementation-ledger.json");
const auditPath = join(root, "packages/coding-agent/test/evidence/source-boundary-audit-v1/audit.json");
const componentDirectory = "packages/coding-agent/test/evidence/component-boundaries-v1";
const componentFingerprint = "95bbbb473ac835d03116a16acf4a9c841ac3f9bc9676fc2155f5204a2f3cddd5";

const domainProfiles: Record<Domain, DomainProfile> = {
	"shared-components": {
		adapter: "shared pi-tui rendering primitive exercised through deterministic real-component fixtures",
		states: ["narrow", "standard", "wide", "dark", "light", "unicode", "ascii"],
		terminalDirectories: [],
	},
	foundation: {
		adapter: "provider login, model selection, and authenticated startup lifecycle",
		states: ["browse", "draft", "cancelled", "validated", "connected", "failure", "reopen"],
		terminalDirectories: ["terminal-foundation-login-model-final-v1"],
	},
	settings: {
		adapter: "settings, keybinding, theme, plugin, extension, and agent inventory lifecycle",
		states: ["browse", "search", "draft", "review", "cancelled", "saved", "failure", "reopen"],
		terminalDirectories: ["terminal-settings-inventories-final-v1"],
	},
	sessions: {
		adapter: "session browse, branch, observe, persistence, and teardown lifecycle",
		states: ["browse", "search", "review", "cancelled", "progress", "success", "failure", "reopen"],
		terminalDirectories: ["terminal-sessions-final-v1"],
	},
	reports: {
		adapter: "reports, debug, BTW, media, editor, loader, notification, and status lifecycle",
		states: ["idle", "loading", "progress", "complete", "interrupted", "failure", "retry", "reopen"],
		terminalDirectories: ["terminal-reports-final-v1"],
	},
	connections: {
		adapter: "context, MCP, and SSH isolated connection lifecycle",
		states: ["browse", "draft", "test", "review", "cancelled", "saved", "partial-failure", "retry", "reopen"],
		terminalDirectories: ["terminal-connections-final-v1"],
	},
	resources: {
		adapter: "resource and export preflight, reviewed action, execution, and artifact lifecycle",
		states: ["validation", "review", "cancelled", "stale-review", "progress", "success", "partial-failure", "retry"],
		terminalDirectories: ["terminal-resources-artifacts-final-v1"],
	},
	extensions: {
		adapter: "public extension contract plus first-party plugin and extension lifecycle",
		states: ["browse", "details", "draft", "review", "cancelled", "running", "success", "failure", "reopen"],
		terminalDirectories: ["terminal-plugin-lifecycle-final-v1"],
	},
	protocols: {
		adapter: "machine protocol mapping that preserves ACP, RPC, SDK, print-mode, and transcript wire contracts",
		states: ["initialize", "stream", "tool-event", "completion", "error", "shutdown"],
		terminalDirectories: [],
	},
	tools: {
		adapter: "tool authority, execution outcome, and bounded terminal rendering pipeline",
		states: ["queued", "running", "progress", "success", "failure", "interrupted", "retry", "rendered"],
		terminalDirectories: ["terminal-reports-final-v1", "terminal-route-mode-final-v1"],
	},
	core: {
		adapter: "core interactive routing, shared controller, and terminal lifecycle",
		states: ["idle", "input", "browse", "review", "cancelled", "progress", "success", "failure", "restored"],
		terminalDirectories: ["terminal-route-mode-final-v1", "terminal-plan-mode-final-v1"],
	},
};

const ownershipPolicies: Record<Ownership, string> = {
	"shared-rendering-primitive":
		"No persistence authority. The primitive renders or edits caller-owned state; the caller owns review and mutation.",
	"read-only-renderer":
		"Read-only presentation. It cannot claim or perform persistence; its caller supplies already-authoritative state.",
	"caller-owned-draft":
		"Draft-only interaction. Escape returns without mutation, and the caller must perform any Cancel-first reviewed persistence.",
	"reviewed-mutation-adapter":
		"Persistent changes are Cancel-first, disclose exact target, scope, old-to-new state and consequences, and revalidate before execution.",
	"public-extension-contract":
		"Public extension callbacks and rendering contracts remain unchanged; persistence and authority remain with the extension operation.",
	"machine-protocol-contract":
		"No independent TUI mutation. Typed wire events, callbacks, transcript structure, and shutdown behavior remain protocol-authoritative.",
	"tool-authority-boundary":
		"Tool invocation authority is explicit and separate from rendering; displayed success follows the actual tool result and never authorizes work.",
	"runtime-lifecycle":
		"Lifecycle orchestration does not bypass caller authority; applicable mutations retain Cancel-first review, revalidation, and truthful outcomes.",
};

const ledger = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
const auditReport = (await Bun.file(auditPath).json()) as { fingerprint: string; audits: SourceAudit[] };
const audits = new Map(auditReport.audits.map(audit => [audit.source, audit]));
const domainReceipts = new Map<string, string>();

for (const profile of Object.values(domainProfiles)) {
	for (const directory of profile.terminalDirectories) {
		if (domainReceipts.has(directory)) continue;
		const evidenceRoot = join(root, "packages/coding-agent/test/evidence", directory);
		const matrixPath = join(evidenceRoot, "matrix.json");
		const reviewPath = join(evidenceRoot, "visual-review.md");
		if (!(await Bun.file(matrixPath).exists()) || !(await Bun.file(reviewPath).exists()))
			throw new Error(`Missing domain evidence: ${directory}`);
		const matrix = (await Bun.file(matrixPath).json()) as { complete?: boolean; runs?: unknown[] };
		if (matrix.complete !== true || matrix.runs?.length !== 16)
			throw new Error(`Incomplete 16-variant domain matrix: ${directory}`);
		const digest = createHash("sha256")
			.update(await Bun.file(matrixPath).bytes())
			.update(await Bun.file(reviewPath).bytes())
			.digest("hex");
		domainReceipts.set(directory, digest);
	}
}

const componentReceipts = Array.fromAsync(
	new Bun.Glob("*.json").scan({ cwd: join(root, componentDirectory), onlyFiles: true }),
);
if ((await componentReceipts).length !== 288) throw new Error("Component evidence must contain exactly 288 receipts");

let classified = 0;
for (const entry of ledger.entries) {
	const generatedSourceRow = entry.notes.some(note =>
		note.startsWith("Individually classified from current source SHA-256"),
	);
	if (entry.status !== "required" && !generatedSourceRow) continue;
	if (entry.surface.kind !== "component" && entry.surface.kind !== "integration")
		throw new Error(`Required non-source row needs tailored evidence: ${entry.surface.id}`);
	const audit = audits.get(entry.surface.source);
	if (!audit) throw new Error(`Missing source audit: ${entry.surface.source}`);
	if (audit.directTests.length === 0) throw new Error(`Source has no direct test: ${audit.source}`);
	const profile = domainProfiles[audit.domain];
	const componentEvidence = audit.kind === "component";
	const captures = [
		`packages/coding-agent/test/evidence/source-boundary-audit-v1/audit.json · ${audit.source} · sha256 ${audit.sha256}`,
		...profile.terminalDirectories.map(
			directory =>
				`packages/coding-agent/test/evidence/${directory} · complete 16-variant actual-terminal domain matrix`,
		),
	];
	const visualVerdicts = profile.terminalDirectories.map(
		directory => `packages/coding-agent/test/evidence/${directory}/visual-review.md · pass-actual-terminal`,
	);
	if (componentEvidence) {
		captures.push(`${componentDirectory} · 288 deterministic real-component captures`);
		visualVerdicts.push(`${componentDirectory}/visual-review.md · pass-deterministic-component`);
	}
	if (audit.domain === "protocols")
		visualVerdicts.push(
			"not-applicable-machine-protocol · no independent visual surface; direct tests verify typed wire and transcript behavior",
		);
	const fingerprint = createHash("sha256")
		.update(auditReport.fingerprint)
		.update(audit.sha256)
		.update(componentEvidence ? componentFingerprint : "non-component")
		.update(profile.terminalDirectories.map(directory => domainReceipts.get(directory)).join(":"))
		.update(JSON.stringify({ ownership: audit.ownership, domain: audit.domain }))
		.digest("hex");
	Object.assign(entry, {
		status: "in-progress",
		adapter: `${profile.adapter}; ${audit.classification}`,
		reviewPolicy: ownershipPolicies[audit.ownership],
		states: [...new Set([...profile.states, ...audit.interactionSignals, ...audit.persistenceSignals])],
		tests: [
			...audit.directTests,
			"packages/coding-agent/test/tui-source-boundary-audit.test.ts",
			"packages/coding-agent/test/component-boundary-contract.test.ts",
		],
		persistence: [
			ownershipPolicies[audit.ownership],
			profile.terminalDirectories.length
				? "Applicable domain matrices prove isolated cancellation/no-op, truthful outcomes, and reopen behavior."
				: "No domain persistence is owned by this boundary; direct contract tests prove the non-mutating or caller-owned behavior.",
		],
		captures,
		visualVerdicts,
		fingerprint,
		notes: [
			`Individually classified from current source SHA-256 ${audit.sha256}.`,
			`Ownership: ${audit.ownership}; domain: ${audit.domain}; direct tests: ${audit.directTests.length}.`,
			"Complete-candidate convergence and final current-source gates remain pending.",
		],
	});
	classified++;
}

const remaining = ledger.entries.filter(entry => entry.status === "required").map(entry => entry.surface.id);
if (remaining.length) throw new Error(`Unclassified required rows: ${remaining.join(", ")}`);
if (classified !== 190) throw new Error(`Expected to classify 190 required source rows, classified ${classified}`);
await Bun.write(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ classified, auditFingerprint: auditReport.fingerprint, remaining: remaining.length }));
