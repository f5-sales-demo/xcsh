import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import type { TuiLedgerEntry } from "./helpers/tui-surface-inventory";

const root = resolve(import.meta.dir, "../../..");
const ledgerPath = join(import.meta.dir, "evidence/tui-implementation-ledger.json");
const auditPath = join(import.meta.dir, "evidence/source-boundary-audit-v1/audit.json");

interface Audit {
	source: string;
	kind: "component" | "integration";
	ownership: string;
	domain: string;
	sha256: string;
	classification: string;
}

describe("TUI source-boundary audit", () => {
	it("individually classifies every component and integration source", async () => {
		const ledger = (await Bun.file(ledgerPath).json()) as { entries: TuiLedgerEntry[] };
		const report = (await Bun.file(auditPath).json()) as {
			counts: { total: number; components: number; integrations: number };
			audits: Audit[];
		};
		const rows = ledger.entries.filter(
			(
				entry,
			): entry is TuiLedgerEntry & {
				surface: TuiLedgerEntry["surface"] & { kind: "component" | "integration" };
			} => entry.surface.kind === "component" || entry.surface.kind === "integration",
		);
		expect(report.counts.total).toBe(rows.length);
		expect(report.counts.components).toBe(rows.filter(entry => entry.surface.kind === "component").length);
		expect(report.counts.integrations).toBe(rows.filter(entry => entry.surface.kind === "integration").length);
		expect(new Set(report.audits.map(audit => audit.source)).size).toBe(rows.length);
		for (const row of rows) {
			const audit = report.audits.find(candidate => candidate.source === row.surface.source);
			expect(audit, row.surface.source).toBeDefined();
			expect(audit!.kind).toBe(row.surface.kind);
			expect(audit!.ownership).not.toBe("unclassified");
			expect(audit!.domain).not.toBe("unclassified");
			expect(audit!.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(audit!.classification).toContain(row.surface.source);
		}
	});

	it("is current for every inventoried source", () => {
		const result = Bun.spawnSync(
			[process.execPath, join(root, "packages/coding-agent/scripts/audit-tui-source-boundaries.ts"), "--check"],
			{ cwd: root },
		);
		expect(result.exitCode, result.stderr.toString()).toBe(0);
	});
});
