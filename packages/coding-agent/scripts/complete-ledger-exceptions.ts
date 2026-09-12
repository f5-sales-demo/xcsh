import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

interface Audit {
	source: string;
	sha256: string;
	directTests: string[];
}

const root = resolve(import.meta.dir, "../../..");
const ledgerPath = join(root, "packages/coding-agent/test/evidence/tui-implementation-ledger.json");
const auditPath = join(root, "packages/coding-agent/test/evidence/source-boundary-audit-v1/audit.json");
const ledger = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
const auditReport = (await Bun.file(auditPath).json()) as { fingerprint: string; audits: Audit[] };
const audits = new Map(auditReport.audits.map(audit => [audit.source, audit]));
const componentFingerprint = "95bbbb473ac835d03116a16acf4a9c841ac3f9bc9676fc2155f5204a2f3cddd5";
const extensionFingerprint = "718ee37113ddfdb857dfd5e754af2ba5bc6390b0cfd83a3be1698415fb9ba242";
const finalMatrixFingerprint = "ca9c5c03475c256d54a3d5b0edd0e06b78802dc7b56dd777652299df0fb2a98b";

function row(id: string): TuiLedgerEntry {
	const entry = ledger.entries.find(candidate => candidate.surface.id === id);
	if (!entry) throw new Error(`Missing ledger row: ${id}`);
	return entry;
}

Object.assign(row("/open <arguments>"), {
	adapter:
		"CommandController.handleOpenCommand strict argument rejection; valid argument-free requests use reviewExternalUrlAction -> runReviewedAction -> openHttpUrl",
	reviewPolicy:
		"Typed arguments fail closed with usage guidance and cannot bypass exact-link Cancel-first review, latest-link revalidation, duplicate prevention, or launcher outcome handling.",
	states: [
		"invalid-arguments",
		"no-launch",
		"shared-review",
		"shared-cancel",
		"shared-stale-renewal",
		"shared-failure",
		"shared-retry",
	],
	tests: [
		"packages/coding-agent/test/modes/controllers/command-controller-open.test.ts",
		"packages/coding-agent/test/scripts/terminal-uat-profile.test.ts",
		"packages/coding-agent/scripts/terminal-uat-walkthrough.ts --publication-launcher-fixture",
		"packages/coding-agent/scripts/terminal-uat-matrix.ts --publication-launcher-fixture",
	],
	persistence: [
		"Focused tests prove typed input reports Usage: /open and performs no launcher call.",
		"The shared 16-variant launcher receipts prove Cancel/no-attempt, stale-link renewal, successful launch, failure, one unresolved retry, duplicate prevention, and unchanged session reopen.",
	],
	captures: [
		"packages/coding-agent/test/evidence/terminal-publication-launcher-final-v1 · 224 actual-terminal publication and launcher viewport state sets",
	],
	visualVerdicts: [
		"packages/coding-agent/test/evidence/terminal-publication-launcher-final-v1/visual-review.md · all 224 PNGs directly inspected; pass-actual-terminal",
	],
	fingerprint: finalMatrixFingerprint,
	notes: [
		"Typed input has no independent mutation path; valid execution remains owned by the shared argument-free adapter.",
		"Complete-candidate convergence and final current-source gates remain pending.",
	],
});

for (const id of ["/force", "/force <arguments>"]) {
	Object.assign(row(id), {
		adapter:
			"Builtin force handler -> shared searchable HookSelector -> existing AgentSession forced-tool directive queue",
		reviewPolicy:
			"Cancel-first ephemeral queue choice scoped to the current session. Queueing does not write settings or transcript state and never claims that a tool ran; the session revalidates the exact active tool before enqueue.",
		states: [
			"editor",
			"active-tools",
			"empty-inventory",
			"cancelled",
			"wheel-selected",
			"queued",
			"unsupported-tool",
			"duplicate-selector",
			"changed-session",
		],
		tests: [
			"packages/coding-agent/test/slash-commands/force.test.ts",
			"packages/coding-agent/test/agent-session-force-tool-choice.test.ts",
			"packages/coding-agent/test/hook-selector-overflow.test.ts",
			"packages/coding-agent/test/scripts/terminal-uat-profile.test.ts",
			"packages/coding-agent/scripts/terminal-uat-walkthrough.ts --force-fixture",
			"packages/coding-agent/scripts/terminal-uat-matrix.ts --force-fixture",
		],
		persistence: [
			"All 16 isolated actual-terminal receipts prove Cancel and queueing create no session file; provider traffic is only the synthetic model inventory GET.",
			"Real AgentSession and FileSessionStorage tests prove typed and menu queue parity, FIFO ordering behind prior directives, stale-tool rejection, and byte-preserving no-write behavior.",
		],
		captures: [
			"packages/coding-agent/test/evidence/terminal-force-final-v1 · 64 current-source actual-terminal state sets and four fixed-order contact sheets",
			"packages/coding-agent/test/evidence/terminal-force-matrix · retained historical visual failure",
			"packages/coding-agent/test/evidence/terminal-force-matrix-current-failed · retained current-source readiness-harness failure",
		],
		visualVerdicts: [
			"packages/coding-agent/test/evidence/terminal-force-final-v1/visual-review.md · all 64 PNGs directly inspected; pass-actual-terminal",
		],
		fingerprint: finalMatrixFingerprint,
		notes: [
			"The successful matrix covers 60x20 through 140x40, dark/light, and Unicode/ASCII; no inference or tool execution was requested.",
			"Historical and current-source failures remain retained and are explicitly excluded from acceptance.",
			"Complete-candidate convergence and final current-source gates remain pending.",
		],
	});
}

const hookRows = [
	{
		id: "source:packages/coding-agent/src/modes/components/hook-editor.ts",
		dialogStates: ["review-editor"],
		lifecycle: ["editing", "details", "external-editor", "failure", "cancelled", "submitted"],
	},
	{
		id: "source:packages/coding-agent/src/modes/components/hook-input.ts",
		dialogStates: ["native-input"],
		lifecycle: ["idle", "masked-input", "timeout", "abort", "cancelled", "submitted"],
	},
	{
		id: "source:packages/coding-agent/src/modes/components/hook-selector.ts",
		dialogStates: ["review-mode", "review-branch", "review-commit", "confirmation"],
		lifecycle: ["browse", "search", "no-match", "selection", "timeout", "cancelled"],
	},
];

for (const item of hookRows) {
	const entry = row(item.id);
	const audit = audits.get(entry.surface.source);
	if (!audit) throw new Error(`Missing source audit: ${entry.surface.source}`);
	Object.assign(entry, {
		adapter:
			"Public ExtensionUIContext callback -> shared selector-frame and native Input, Editor, or searchable selection primitive",
		reviewPolicy:
			"Draft-only public dialog. Escape, timeout, or abort returns without mutation; persistent work remains owned by the caller's Cancel-first reviewed action.",
		states: item.lifecycle,
		tests: [
			...audit.directTests,
			"packages/coding-agent/test/review-command-dialogs.test.ts",
			"packages/coding-agent/test/native-lifecycle-acceptance.test.ts",
			"packages/coding-agent/test/tui-source-boundary-audit.test.ts",
		],
		persistence: [
			"No settings, credential, session, or external write is owned by this component.",
			"Focused tests prove callbacks settle only after explicit submit or selection; Escape, timeout, and managed abort fail closed.",
		],
		captures: [
			"packages/coding-agent/test/evidence/extension-dialogs-v1 · " +
				item.dialogStates.join(", ") +
				" across all 16 variants",
			"packages/coding-agent/test/evidence/component-boundaries-v1 · current shared primitive dependency matrix",
		],
		visualVerdicts: [
			"packages/coding-agent/test/evidence/extension-dialogs-v1/visual-review.md · all 112 dialog PNGs directly inspected; pass-deterministic-component",
			"packages/coding-agent/test/evidence/component-boundaries-v1/visual-review.md · all 288 shared-component PNGs directly inspected",
		],
		fingerprint: createHash("sha256")
			.update(auditReport.fingerprint)
			.update(audit.sha256)
			.update(extensionFingerprint)
			.update(componentFingerprint)
			.digest("hex"),
		notes: [
			"Current source SHA-256 " +
				audit.sha256 +
				"; public callback and third-party rendering contracts are unchanged.",
			"Complete-candidate convergence and final current-source gates remain pending.",
		],
	});
}

const welcome = row("source:packages/coding-agent/src/modes/components/welcome.ts");
const welcomeAudit = audits.get(welcome.surface.source);
if (!welcomeAudit) throw new Error("Missing welcome source audit");
Object.assign(welcome, {
	adapter:
		"WelcomeComponent -> shared selectorFrame with live terminal-row budget; InteractiveMode owns placement and transcript scrolling",
	reviewPolicy:
		"Read-only startup presentation with no settings, session, credential, network, or external-process mutation.",
	states: ["compact", "full-artwork", "resized", "narrow", "scrolled-transcript", "dark", "light", "unicode", "ascii"],
	tests: [
		...welcomeAudit.directTests,
		"packages/coding-agent/test/welcome-component.test.ts",
		"packages/coding-agent/test/welcome-logo.test.ts",
		"packages/coding-agent/test/component-boundary-contract.test.ts",
	],
	persistence: [
		"Welcome rendering is read-only and owns no persistent state.",
		"All 16 reports-matrix receipts preserve and reopen the same isolated conversation while the startup frame remains presentation-only.",
	],
	captures: [
		"packages/coding-agent/test/evidence/terminal-reports-final-v1 · reports-editor captures show the current compact welcome in all 16 actual-terminal variants",
		"packages/coding-agent/test/evidence/component-boundaries-v1 · current selector-frame, theme, symbol, and bounded-width dependency matrix",
	],
	visualVerdicts: [
		"packages/coding-agent/test/evidence/terminal-reports-final-v1/visual-review.md · all 538 PNGs directly inspected; reports-editor includes all 16 compact welcome variants",
		"packages/coding-agent/test/evidence/component-boundaries-v1/visual-review.md · all 288 shared-component PNGs directly inspected",
	],
	fingerprint: createHash("sha256")
		.update(auditReport.fingerprint)
		.update(welcomeAudit.sha256)
		.update(finalMatrixFingerprint)
		.update(componentFingerprint)
		.digest("hex"),
	notes: [
		"Current source SHA-256 " +
			welcomeAudit.sha256 +
			"; focused tests cover compact/full-artwork selection, resize, symmetry, narrow width, and frame bounds.",
		"Required 60x20 through 140x40 actual-terminal variants use the compact form by design; full artwork requires a taller terminal and is covered by deterministic component tests.",
		"Complete-candidate convergence and final current-source gates remain pending.",
	],
});

await Bun.write(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ completed: 7 }));
