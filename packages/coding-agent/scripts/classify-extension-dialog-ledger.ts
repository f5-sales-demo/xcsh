import { resolve } from "node:path";
import type { TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

const ledgerPath = resolve(import.meta.dir, "../test/evidence/tui-implementation-ledger.json");
const ledger = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
const fingerprint = "718ee37113ddfdb857dfd5e754af2ba5bc6390b0cfd83a3be1698415fb9ba242";
const captures = ["packages/coding-agent/test/evidence/extension-dialogs-v1"];
const visualVerdicts = ["packages/coding-agent/test/evidence/extension-dialogs-v1/visual-review.md"];

const evidence: Record<string, Omit<TuiLedgerEntry, "surface" | "status" | "fingerprint">> = {
	"dialog:packages/coding-agent/src/autoresearch/dashboard.ts:custom:1": {
		adapter: "ExtensionUIContext.custom overlay with extension-owned read-only dashboard rendering",
		reviewPolicy: "No persistent action; Escape and q close, navigation remains local to the overlay",
		states: ["results", "running indicator", "scroll bounds", "Escape close", "dispose"],
		tests: ["packages/coding-agent/test/autoresearch-dashboard-dialog.test.ts"],
		persistence: ["Read-only dashboard; no persistent state is changed by opening or closing it"],
		captures,
		visualVerdicts,
		notes: [
			"Direct inspection found and repaired process-global terminal sizing; all required viewport variants now fit.",
		],
	},
	"dialog:packages/coding-agent/src/extensibility/custom-commands/bundled/review/index.ts:editor:1": {
		adapter: "ExtensionUIContext.editor through HookEditorComponent and selector-frame",
		reviewPolicy: "Ephemeral instructions; Escape returns undefined and no review request is submitted",
		states: ["prefill", "edit", "submit", "Escape cancel", "external editor", "awaiting-user lifecycle"],
		tests: [
			"packages/coding-agent/test/review-command-dialogs.test.ts",
			"packages/coding-agent/test/hook-editor.test.ts",
		],
		persistence: ["No write; submitted text is returned only after explicit submit"],
		captures,
		visualVerdicts,
		notes: ["The first-party review command keeps public extension editor callbacks unchanged."],
	},
	"dialog:packages/coding-agent/src/extensibility/custom-commands/bundled/review/index.ts:select:1": {
		adapter: "ExtensionUIContext.select through HookSelectorComponent and selector-frame",
		reviewPolicy: "Read-only mode choice; Escape cancels before any git inspection or prompt creation",
		states: ["mode list", "search", "selection", "Escape cancel"],
		tests: [
			"packages/coding-agent/test/review-command-dialogs.test.ts",
			"packages/coding-agent/test/hook-selector-overflow.test.ts",
		],
		persistence: ["No persistent mutation"],
		captures,
		visualVerdicts,
		notes: ["The mode chooser is independently exercised and uses the shared searchable frame."],
	},
	"dialog:packages/coding-agent/src/extensibility/custom-commands/bundled/review/index.ts:select:2": {
		adapter: "ExtensionUIContext.select through HookSelectorComponent and selector-frame",
		reviewPolicy: "Read-only exact base-branch choice; Escape cancels before diff construction",
		states: ["branch list", "search", "exact selection", "Escape cancel"],
		tests: [
			"packages/coding-agent/test/review-command-dialogs.test.ts",
			"packages/coding-agent/test/hook-selector-overflow.test.ts",
		],
		persistence: ["No persistent mutation; selected branch identity is passed unchanged to diff"],
		captures,
		visualVerdicts,
		notes: ["Branch selection is individually exercised with exact selected identity."],
	},
	"dialog:packages/coding-agent/src/extensibility/custom-commands/bundled/review/index.ts:select:3": {
		adapter: "ExtensionUIContext.select through HookSelectorComponent and selector-frame",
		reviewPolicy: "Read-only exact commit choice; Escape cancels before git show",
		states: ["commit list", "search", "exact selection", "Escape cancel"],
		tests: [
			"packages/coding-agent/test/review-command-dialogs.test.ts",
			"packages/coding-agent/test/hook-selector-overflow.test.ts",
		],
		persistence: ["No persistent mutation; selected commit hash is passed unchanged to git show"],
		captures,
		visualVerdicts,
		notes: ["Commit selection is individually exercised with exact selected identity."],
	},
	"dialog:packages/coding-agent/src/extensibility/custom-commands/types.ts:confirm:1": {
		adapter: "Documentation example for shared ExtensionUIContext.confirm",
		reviewPolicy: "Documented No-first confirmation discloses target, scope, old-to-new state, and consequence",
		states: ["No selected", "explicit Yes", "Escape cancel", "abort and timeout forwarding"],
		tests: ["packages/coding-agent/test/hook-selector-overflow.test.ts"],
		persistence: ["Example performs its mutation only after confirm returns true"],
		captures,
		visualVerdicts,
		notes: [
			"Documentation-only call site; runtime behavior is the shared confirmation adapter and was not rewritten.",
		],
	},
	"dialog:packages/coding-agent/src/extensibility/extensions/bundled/native-lifecycle-control.ts:input:1": {
		adapter: "ExtensionUIContext.input through HookInputComponent and selector-frame",
		reviewPolicy: "Ephemeral acceptance input; Escape or cooperative abort fails closed and aborts the native turn",
		states: ["awaiting input", "submit", "Escape dismiss", "managed abort", "shutdown cleanup"],
		tests: [
			"packages/coding-agent/test/native-lifecycle-acceptance.test.ts",
			"packages/coding-agent/test/hook-input-timeout.test.ts",
		],
		persistence: ["No credential or configuration write; accepted label becomes an in-memory hidden turn message"],
		captures,
		visualVerdicts,
		notes: ["The native lifecycle hook keeps its public input callback and real cancellation boundary."],
	},
	"dialog:packages/coding-agent/src/extensibility/hooks/types.ts:custom:1": {
		adapter: "Documentation example for extension-owned custom component rendering",
		reviewPolicy:
			"Hook owns rendering and completion; guidance requires shared inputs/keybindings and truthful settlement",
		states: ["factory creation", "focused interaction", "done settlement", "cleanup failure"],
		tests: [
			"packages/coding-agent/test/reviewed-action-dialog.test.ts",
			"packages/coding-agent/test/autoresearch-dashboard-dialog.test.ts",
		],
		persistence: ["Documentation-only example; persistence policy belongs to the extension operation"],
		captures,
		visualVerdicts,
		notes: ["Third-party rendering API and callback signature are intentionally preserved."],
	},
	"dialog:packages/coding-agent/src/extensibility/hooks/types.ts:custom:2": {
		adapter: "Documentation example for asynchronous extension-owned custom component rendering",
		reviewPolicy: "Cancellation is only a request; failure and retry remain visible until work settles",
		states: ["async factory", "working", "cancellation requested", "completion", "cleanup failure"],
		tests: ["packages/coding-agent/test/reviewed-action-dialog.test.ts"],
		persistence: ["Documentation-only example; completion must follow the backing operation"],
		captures,
		visualVerdicts,
		notes: ["Third-party rendering API and callback signature are intentionally preserved."],
	},
};

const found = new Set<string>();
for (const entry of ledger.entries) {
	const classified = evidence[entry.surface.id];
	if (!classified) continue;
	Object.assign(entry, classified, { status: "in-progress", fingerprint });
	found.add(entry.surface.id);
}
const missing = Object.keys(evidence).filter(id => !found.has(id));
if (missing.length) throw new Error(`Missing ledger rows: ${missing.join(", ")}`);
await Bun.write(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ classified: found.size, fingerprint }));
