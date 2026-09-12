import { join } from "node:path";
import { getBuiltinSlashCommandInventory } from "../../src/slash-commands/builtin-registry";

export interface TuiSurface {
	id: string;
	source: string;
	kind: "command" | "alias" | "subcommand" | "typed-arguments" | "component" | "integration" | "extension-dialog";
	parent?: string;
}

/** Source-derived boundaries, not evidence that any surface has been implemented or accepted. */
export async function discoverTuiSurfaces(root: string): Promise<TuiSurface[]> {
	const surfaces: TuiSurface[] = [];
	const source = "packages/coding-agent/src/slash-commands/builtin-registry.ts";
	for (const command of getBuiltinSlashCommandInventory()) {
		const parent = `/${command.name}`;
		surfaces.push({ id: parent, source, kind: "command" });
		for (const name of [command.name, ...command.aliases]) {
			const path = `/${name}`;
			if (name !== command.name) surfaces.push({ id: path, source, kind: "alias", parent });
			if (command.acceptsArguments)
				surfaces.push({ id: `${path} <arguments>`, source, kind: "typed-arguments", parent });
			for (const subcommand of command.subcommands)
				surfaces.push({ id: `${path} ${subcommand}`, source, kind: "subcommand", parent });
		}
	}
	for await (const file of new Bun.Glob("packages/*/src/**/*.{ts,tsx}").scan({ cwd: root, onlyFiles: true })) {
		if (/\.(test|spec)\.tsx?$/.test(file)) continue;
		const content = await Bun.file(join(root, file)).text();
		const component =
			file.startsWith("packages/coding-agent/src/modes/components/") ||
			file.startsWith("packages/tui/src/components/");
		const integration =
			file.startsWith("packages/coding-agent/src/slash-commands/") ||
			file.startsWith("packages/coding-agent/src/modes/") ||
			file.startsWith("packages/tui/src/") ||
			/from ["']@f5-sales-demo\/pi-tui["']/.test(content);
		if (component || integration)
			surfaces.push({ id: `source:${file}`, source: file, kind: component ? "component" : "integration" });
		// Calls are inventoried separately so a new first-party dialog in an existing file is visible.
		const calls = new Map<string, number>();
		for (const match of content.matchAll(/\.ui\.(select|input|confirm|editor|custom)\s*(?:<[^;\n]+>)?\s*\(/g)) {
			const method = match[1];
			const ordinal = (calls.get(method) ?? 0) + 1;
			calls.set(method, ordinal);
			surfaces.push({ id: `dialog:${file}:${method}:${ordinal}`, source: file, kind: "extension-dialog" });
		}
	}
	return surfaces.sort((a, b) => a.id.localeCompare(b.id));
}

export interface TuiLedgerEntry {
	surface: TuiSurface;
	status: "required" | "in-progress" | "verified" | "compliant";
	adapter: string | null;
	reviewPolicy: string | null;
	states: string[];
	tests: string[];
	persistence: string[];
	captures: string[];
	visualVerdicts: string[];
	fingerprint: string | null;
	notes: string[];
}

export function incompleteEvidence(entry: TuiLedgerEntry): string[] {
	if (entry.status !== "verified" && entry.status !== "compliant") return [];
	const missing: string[] = [];
	for (const field of ["adapter", "reviewPolicy", "fingerprint"] as const) if (!entry[field]) missing.push(field);
	for (const field of ["states", "tests", "persistence", "captures", "visualVerdicts"] as const)
		if (!entry[field].length) missing.push(field);
	return missing;
}
