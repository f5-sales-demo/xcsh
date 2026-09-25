import { describe, expect, test } from "bun:test";
import path from "node:path";
import { auditTuiReadability, type ReadabilityLedger } from "../scripts/audit-tui-readability";

const packageRoot = path.resolve(import.meta.dir, "..");

describe("TUI readability audit", () => {
	test("the checked-in ledger classifies every current text sink and matches generated evidence", async () => {
		const result = await auditTuiReadability({ packageRoot, checkEvidence: true });
		expect(result.errors).toEqual([]);
		expect(result.sinks.length).toBeGreaterThan(0);
	});

	test("rejects an unclassified sink", async () => {
		const ledger: ReadabilityLedger = {
			version: 1,
			sourceRoots: ["fixture"],
			sinkNames: ["truncateToWidth"],
			entries: [],
		};
		const result = await auditTuiReadability({
			packageRoot,
			ledger,
			sources: { "fixture/example.ts": "const line = truncateToWidth(message, width);\n" },
		});
		expect(result.errors).toContain("Unclassified TUI sink: fixture/example.ts:1 truncateToWidth");
	});

	test("rejects prose assigned to truncation-only and incomplete detail policies", async () => {
		const base = {
			version: 1 as const,
			sourceRoots: ["fixture"],
			sinkNames: ["truncateToWidth"],
		};
		const sources = { "fixture/example.ts": "truncateToWidth(message, width);\n" };
		const common = {
			id: "fixture",
			surface: "/fixture",
			source: "fixture/example.ts",
			sinks: ["truncateToWidth"],
			reproductionWidth: 32,
			fixture: "Synthetic long Unicode prose: café 東京 with ANSI emphasis.",
			status: "verified" as const,
			issue: "#1",
			tests: ["fixture.test.ts"],
			terminalUat: "recorded",
			mergedPr: "#2",
		};
		const prose = await auditTuiReadability({
			packageRoot,
			ledger: {
				...base,
				entries: [{ ...common, category: "prose", policy: "intentionally-compact" }],
			},
			sources,
		});
		expect(prose.errors.some(error => error.includes("Prose must use the wrap policy"))).toBe(true);

		const details = await auditTuiReadability({
			packageRoot,
			ledger: {
				...base,
				entries: [
					{
						...common,
						category: "identifier",
						policy: "truncate-with-full-detail",
						detailView: false,
					},
				],
			},
			sources,
		});
		expect(details.errors.some(error => error.includes("requires detailView=true"))).toBe(true);
	});
});
