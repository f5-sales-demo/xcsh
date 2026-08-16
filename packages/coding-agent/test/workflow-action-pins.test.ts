/**
 * Third-party GitHub Actions in credential-bearing workflows must be pinned (#2498).
 *
 * A tag is a pointer. Whoever controls the upstream repo can move it to new code, and the
 * next run picks that up with no diff on our side. That only matters where there is
 * something to steal, and the exposure here is concentrated rather than diffuse: `ci.yml`
 * alone holds 14 references to release secrets and owns the whole publish chain — npm, the
 * Homebrew tap, GitHub releases, macOS signing.
 *
 * This test exists because the decision does not survive on its own. Before it, the only
 * pinned action in the repo was the one pinned in #2496 — and #2508 added a fresh unpinned
 * one straight afterwards. A policy recorded in an issue does not reach the next workflow;
 * a failing test does.
 *
 * Scope is deliberately narrow, so it stays worth obeying:
 *   - `actions/*` is exempt. First-party, GitHub-maintained major tags. Pinning them is
 *     ceremony that costs a SHA bump per security fix and buys little.
 *   - `f5-sales-demo/*` reusable workflows are exempt: same org, same trust boundary.
 *   - Workflows with no credential are exempt. There is nothing to exfiltrate from
 *     `semgrep.yml` or `test-codesign.yml`, and failing them would train people to
 *     dismiss this.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const WORKFLOW_DIR = path.join(import.meta.dir, "../../../.github/workflows");

/** Workflows that reference a publishing or write credential — the ones that matter. */
const CREDENTIAL_BEARING = [
	"ci.yml",
	"release-npm-backfill.yml",
	"api-spec-update.yml",
	"console-catalog-drift.yml",
	"console-catalog-update.yml",
	"tag-on-version-bump.yml",
];

/** Owners whose refs are trusted mutable: GitHub itself, and this org's own workflows. */
const EXEMPT_OWNER = /^(?:actions|f5-sales-demo)\//;

const SHA_PINNED = /@[0-9a-f]{40}(?:\s|$)/;

async function usesLines(file: string): Promise<string[]> {
	const src = await fs.readFile(path.join(WORKFLOW_DIR, file), "utf8");
	return [...src.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(m => m[1]);
}

describe("third-party actions in credential-bearing workflows are pinned (#2498)", () => {
	for (const file of CREDENTIAL_BEARING) {
		it(`${file}: every third-party action is a 40-hex commit`, async () => {
			const unpinned = (await usesLines(file))
				.filter(ref => !ref.startsWith("./") && !EXEMPT_OWNER.test(ref))
				.filter(ref => !SHA_PINNED.test(`${ref} `));
			// Named so the failure says which action to pin, not merely that one exists.
			expect(unpinned).toEqual([]);
		});
	}

	it("the credential-bearing list still matches which workflows reference secrets", async () => {
		// Guards the premise rather than the conclusion: if a workflow starts using a release
		// secret, it joins the list above. Without this, the list silently goes stale and the
		// pinning rule stops covering the thing it was written for.
		const files = (await fs.readdir(WORKFLOW_DIR)).filter(f => f.endsWith(".yml"));
		const withSecrets: string[] = [];
		for (const file of files) {
			const src = await fs.readFile(path.join(WORKFLOW_DIR, file), "utf8");
			if (/secrets\.(?:RELEASE_TOKEN|NPM_TOKEN|GH_PAT|HOMEBREW\w*)/.test(src)) withSecrets.push(file);
		}
		expect(withSecrets.sort()).toEqual([...CREDENTIAL_BEARING].sort());
	});
});
