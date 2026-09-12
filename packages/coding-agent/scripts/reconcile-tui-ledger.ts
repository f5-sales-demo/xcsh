#!/usr/bin/env bun
/**
 * Reconcile the implementation ledger with the live first-party TUI inventory.
 *
 * Evidence is preserved only by the stable surface id. New surfaces are
 * deliberately classified as required; removed source paths disappear. This
 * avoids the positional zip bug that can attach one command's evidence to a
 * different command when source inventory ordering changes.
 */
import { resolve } from "node:path";
import { discoverTuiSurfaces, type TuiLedgerEntry } from "../test/helpers/tui-surface-inventory";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const ledgerPath = resolve(packageRoot, "test/evidence/tui-implementation-ledger.json");

const existing = (await Bun.file(ledgerPath).json()) as { schemaVersion: 1; entries: TuiLedgerEntry[] };
const byId = new Map(existing.entries.map(entry => [entry.surface.id, entry]));
const surfaces = await discoverTuiSurfaces(repositoryRoot);
const entries = surfaces.map((surface): TuiLedgerEntry => {
	const prior = byId.get(surface.id);
	if (prior) return { ...prior, surface };
	return {
		surface,
		status: "required",
		adapter: null,
		reviewPolicy: null,
		states: [],
		tests: [],
		persistence: [],
		captures: [],
		visualVerdicts: [],
		fingerprint: null,
		notes: ["Unverified. Source discovery is not implementation or acceptance evidence."],
	};
});

await Bun.write(ledgerPath, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
console.log(
	JSON.stringify({
		previous: existing.entries.length,
		current: entries.length,
		added: entries.filter(entry => !byId.has(entry.surface.id)).map(entry => entry.surface.id),
		removed: existing.entries
			.filter(entry => !surfaces.some(surface => surface.id === entry.surface.id))
			.map(entry => entry.surface.id),
	}),
);
