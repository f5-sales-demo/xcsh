import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_SLASH_COMMAND_DEFS } from "../src/slash-commands/builtin-registry";
import { discoverTuiSurfaces, incompleteEvidence, type TuiLedgerEntry } from "./helpers/tui-surface-inventory";

const root = new URL("../../../", import.meta.url).pathname;
const ledgerFile = new URL("./evidence/tui-implementation-ledger.json", import.meta.url);

test("source-derived commands, aliases, subpaths and terminal integration boundaries are classified", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: TuiLedgerEntry[] };
	const surfaces = await discoverTuiSurfaces(root);
	expect(ledger.entries.map(entry => entry.surface)).toEqual(surfaces);
	expect(new Set(surfaces.map(surface => surface.id)).size).toBe(surfaces.length);
	expect(surfaces.filter(surface => surface.kind === "command")).toHaveLength(BUILTIN_SLASH_COMMAND_DEFS.length);
	expect(surfaces.some(surface => surface.id === "/plugins install")).toBe(true);
	expect(surfaces.some(surface => surface.id === "source:packages/tui/src/components/editor.ts")).toBe(true);
});

test("completion labels cannot omit evidence categories", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: TuiLedgerEntry[] };
	for (const entry of ledger.entries)
		expect({ id: entry.surface.id, missing: incompleteEvidence(entry) }).toEqual({
			id: entry.surface.id,
			missing: [],
		});
	const unsupportedClaim: TuiLedgerEntry = {
		...ledger.entries[0],
		status: "verified",
		adapter: null,
		persistence: [],
		visualVerdicts: [],
	};
	expect(incompleteEvidence(unsupportedClaim)).toContain("visualVerdicts");
	expect(incompleteEvidence(unsupportedClaim)).toContain("persistence");
	expect(incompleteEvidence(unsupportedClaim)).toContain("adapter");
});

test("new terminal components and dialog calls are discovered without editing the inventory", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-tui-inventory-"));
	try {
		const source = "packages/example/src/new-selector.ts";
		await mkdir(join(directory, "packages/example/src"), { recursive: true });
		await Bun.write(
			join(directory, source),
			'import { Input } from "@f5-sales-demo/pi-tui";\nctx.ui.confirm("Change?");\nctx.ui.confirm("Again?");',
		);
		const discovered = await discoverTuiSurfaces(directory);
		expect(
			discovered
				.filter(surface => surface.source === source)
				.map(surface => surface.kind)
				.sort(),
		).toEqual(["extension-dialog", "extension-dialog", "integration"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("every built-in slash command is listed in the style-guide inventory", async () => {
	const guide = await Bun.file(
		new URL("../../../docs/en/architecture-contribution/tui-style-guide.mdx", import.meta.url),
	).text();
	const reviewed = [...guide.matchAll(/^\| `\/([^`]+)` \|/gm)].map(match => match[1]);
	expect(reviewed.toSorted()).toEqual(BUILTIN_SLASH_COMMAND_DEFS.map(command => command.name).toSorted());
});
