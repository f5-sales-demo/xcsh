/**
 * Placeholder hygiene guard (#2650)
 *
 * STYLE_GUIDE.md bans ACME as a placeholder organisation, tenant, domain or header. Two reasons,
 * and the second is why this is a guard and not a style note: in networking and TLS content the
 * name already belongs to RFC 8555, the certificate-issuance protocol. A fake company called ACME
 * makes our own documentation ambiguous about a live registered protocol. It is also not
 * trademark-cleared, and `acme.com` resolves to a real party.
 *
 * The name is legitimate in exactly two shapes, both preserved by the allowlist below: the RFC 8555
 * vocabulary itself, and the passages that state the prohibition.
 */

import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/**
 * Files whose whole point is to name the thing they ban, or to rewrite it — including this one.
 *
 * Self-exemption is load-bearing: `git grep` searches the index, so while this file was untracked it
 * was invisible to its own scan and passed locally, then failed in CI the moment it was committed.
 */
const ALLOWED_FILES = new Set([
	"CLAUDE.md",
	"CONTRIBUTING.md",
	"README.md",
	"STYLE_GUIDE.md",
	"packages/coding-agent/scripts/generate-api-spec-index.ts",
	"packages/coding-agent/test/placeholder-hygiene.test.ts",
]);

/** RFC 8555 vocabulary. Not the placeholder — must never be renamed. */
const PROTOCOL_TERMS = [/_acme-challenge/gi, /\bacme challenge\b/gi];
const CONTACT_EMAIL_RE = /(?<![:/])\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]+)\b/g;
const RESERVED_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

const BINARY_EXTENSIONS = new Set([
	".gif",
	".gz",
	".ico",
	".jpeg",
	".jpg",
	".node",
	".png",
	".ttf",
	".webp",
	".woff",
	".woff2",
	".zip",
]);

/**
 * Tracked files that mention the name at all. `git grep` does the scan in C over the index; reading
 * all ~3,500 tracked files in JS takes seconds, mostly on the multi-megabyte generated spec index.
 */
function candidateFiles(): string[] {
	try {
		return execFileSync("git", ["grep", "-lIi", "-e", "acme"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		})
			.split("\n")
			.filter(Boolean);
	} catch (err) {
		// git grep exits 1 with no output when nothing matches, which is a pass, not a failure.
		if ((err as { status?: number }).status === 1) return [];
		throw err;
	}
}

/** Occurrences left after removing every legitimate use. */
function offendingOccurrences(text: string): number {
	let stripped = text;
	for (const term of PROTOCOL_TERMS) stripped = stripped.replace(term, "");
	return stripped.match(/acme/gi)?.length ?? 0;
}

describe("placeholder hygiene", () => {
	it("no tracked file uses ACME as a placeholder organisation, tenant or domain", () => {
		const offenders: string[] = [];

		for (const rel of candidateFiles()) {
			if (ALLOWED_FILES.has(rel)) continue;
			if (BINARY_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;

			const abs = path.join(REPO_ROOT, rel);
			let text: string;
			try {
				text = fs.readFileSync(abs, "utf8");
			} catch {
				continue; // deleted between listing and read, or unreadable
			}
			if (!/acme/i.test(text)) continue;

			const count = offendingOccurrences(text);
			if (count > 0) offenders.push(`${rel} (${count})`);
		}

		expect(offenders).toEqual([]);
	});

	it("keeps the RFC 8555 DNS-01 record label, which is the protocol and not the placeholder", () => {
		// Guards the guard: a blanket rename would silently destroy upstream API documentation.
		const generated = path.join(REPO_ROOT, "packages/coding-agent/src/internal-urls/api-spec-index.generated.ts");
		const text = fs.readFileSync(generated, "utf8");
		expect(text).toContain("_acme-challenge");
	});

	it("the spec-index generator sanitises its output, so regeneration cannot reintroduce the placeholder", () => {
		const generator = path.join(REPO_ROOT, "packages/coding-agent/scripts/generate-api-spec-index.ts");
		const text = fs.readFileSync(generator, "utf8");
		// Both emitted artifacts must go through the sanitiser, or the next upstream sync undoes #2650.
		// Matched loosely on purpose: sanitisers compose (#2677 wraps this one), and pinning the exact
		// call text made this assertion fail for a correct change rather than an incorrect one.
		expect(text).toMatch(/Bun\.write\(outputPath,[^;]*sanitizePlaceholders\(output\)/);
		expect(text).toMatch(/Bun\.write\(catalogOutputPath,[^;]*sanitizePlaceholders\(catalogOutput\)/);
		// Contact addresses at real domains are sanitised at the same write sites (#2677).
		expect(text).toMatch(/Bun\.write\(outputPath,[^;]*sanitizeEmails\(/);
		expect(text).toMatch(/Bun\.write\(catalogOutputPath,[^;]*sanitizeEmails\(/);
		// Globally routable examples are rewritten into RFC 5737 space at both write sites (#2674).
		expect(text).toMatch(/Bun\.write\(outputPath,[^;]*sanitizePublicIpv4Examples\(/);
		expect(text).toMatch(/Bun\.write\(catalogOutputPath,[^;]*sanitizePublicIpv4Examples\(/);

		const consoleGenerator = fs.readFileSync(
			path.join(REPO_ROOT, "packages/coding-agent/scripts/generate-console-catalog.ts"),
			"utf8",
		);
		expect(consoleGenerator).toMatch(/Bun\.write\(outputPath,[^;]*sanitizePublicIpv4Examples\(/);
	});

	it("generated API indexes contain only reserved-domain contact addresses", () => {
		const generatedFiles = [
			"packages/coding-agent/src/internal-urls/api-spec-index.generated.ts",
			"packages/coding-agent/src/internal-urls/api-catalog-index.generated.ts",
		];
		const offenders: string[] = [];

		for (const rel of generatedFiles) {
			const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
			let count = 0;
			for (const match of text.matchAll(CONTACT_EMAIL_RE)) {
				if (!RESERVED_EMAIL_DOMAINS.has(match[1].toLowerCase())) count++;
			}
			if (count > 0) offenders.push(`${rel} (${count})`);
		}

		expect(offenders).toEqual([]);
	});
});
