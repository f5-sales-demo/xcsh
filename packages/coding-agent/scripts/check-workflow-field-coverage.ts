#!/usr/bin/env bun
// scripts/check-workflow-field-coverage.ts
//
// Cross-checks every console `create` workflow against the authoritative
// required-field registry (console_field_metadata, embedded). For each required
// field it reports whether the create workflow ADDRESSES it (a fill/select step
// whose selector or context names the field) or relies on a console DEFAULT —
// and flags GAPS (required, no default, not addressed) and AMBIGUOUS selectors
// (addressed only by a bare role like `textbox`, which grabs the wrong input on
// multi-field forms — exactly the http-lb "Domains is required" bug).
//
// Reports per-resource. Exit 1 if any GAP (so CI surfaces missing required-field
// coverage); ambiguous selectors are warnings only.

import { parse as parseYaml } from "yaml";
import { CONSOLE_CATALOG_DATA } from "../src/internal-urls/console-catalog.generated";
import { CONSOLE_FIELD_METADATA } from "../src/internal-urls/console-field-metadata.generated";
import type { ConsoleFieldMeta } from "../src/internal-urls/console-field-metadata-types";

const norm = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, "");

interface Step {
	action?: string;
	selector?: string;
	context?: string;
	value?: string;
	then?: Step[];
}
function flatten(steps: Step[]): Step[] {
	const out: Step[] = [];
	for (const s of steps) {
		out.push(s);
		if (Array.isArray(s.then)) out.push(...flatten(s.then));
	}
	return out;
}

/** Does any fill/select step explicitly name this field's label/section? */
function addressedBy(steps: Step[], label: string, section: string | undefined): "named" | "ambiguous" | "no" {
	const nlabel = norm(label);
	const nsection = section ? norm(section) : "";
	const inputs = steps.filter(s => s.action === "fill" || s.action === "select");
	let ambiguous = false;
	for (const s of inputs) {
		const sel = s.selector ?? "";
		const ctx = s.context ?? "";
		// Extract the value of any [name='X'] / :text('X') / [name="X"] in the selector.
		const targets = [...sel.matchAll(/name=['"]([^'"]*)['"]|text\(['"]([^'"]*)['"]\)/g)].map(m =>
			norm(m[1] ?? m[2] ?? ""),
		);
		const named =
			targets.some(t => t === nlabel || (t.length > 0 && (t.includes(nlabel) || nlabel.includes(t)))) ||
			norm(ctx).includes(nlabel) ||
			(nsection !== "" && norm(ctx).includes(nsection));
		if (named) return "named";
		// bare role selector (textbox / listbox / spinbutton with no [name=…]) → ambiguous
		if (/^(textbox|listbox|spinbutton|combobox|checkbox)$/i.test(sel.trim())) ambiguous = true;
	}
	return ambiguous ? "ambiguous" : "no";
}

let gaps = 0;
let warns = 0;
const resources = Object.keys(CONSOLE_CATALOG_DATA.resources).sort();
console.log("# Console create-workflow required-field coverage\n");

for (const id of resources) {
	const createRaw = CONSOLE_CATALOG_DATA.workflows[`${id}/create`];
	if (!createRaw) continue;
	const resourceDoc = parseYaml(CONSOLE_CATALOG_DATA.resources[id] ?? "") as { api?: { kind?: string } };
	const kind = resourceDoc?.api?.kind;
	const fields = (kind && CONSOLE_FIELD_METADATA.resources[kind]) || undefined;
	if (!fields) continue;
	const required = Object.entries(fields).filter(([, m]) => (m as ConsoleFieldMeta).required === true);
	if (required.length === 0) continue;

	const steps = flatten((parseYaml(createRaw) as { steps?: Step[] })?.steps ?? []);
	const rows: string[] = [];
	for (const [apiField, raw] of required) {
		const m = raw as ConsoleFieldMeta;
		const label = m.label ?? apiField;
		const how = addressedBy(steps, label, m.form_section);
		const hasDefault = m.default !== undefined && m.default !== "" && m.default !== 0;
		let mark: string;
		if (how === "named") mark = "✅ filled by a named step";
		else if (hasDefault) mark = `✅ relies on default (${JSON.stringify(m.default)})`;
		else if (how === "ambiguous") {
			mark = "⚠️ only a BARE selector (e.g. `textbox`) targets this — ambiguous on multi-field forms";
			warns++;
		} else {
			mark = "❌ GAP: required, no default, no step fills it";
			gaps++;
		}
		rows.push(`  - **${label}** (\`${apiField}\`): ${mark}`);
	}
	console.log(`## ${id} (${kind})`);
	console.log(rows.join("\n"), "\n");
}

console.log(`\n---\nGaps: ${gaps}  Ambiguous-selector warnings: ${warns}`);
process.exit(gaps > 0 ? 1 : 0);
