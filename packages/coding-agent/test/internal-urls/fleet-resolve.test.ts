import { describe, expect, it } from "bun:test";
import {
	CLASS_UNCLASSIFIED,
	classifyRepo,
	createFleetResolver,
	LEGACY_ORG,
	parseRepoClasses,
	repoNameFromOrigin,
} from "@f5-sales-demo/xcsh/internal-urls/fleet-resolve";
import type { InternalUrl } from "@f5-sales-demo/xcsh/internal-urls/types";

function parseUrl(urlStr: string): InternalUrl {
	const url = new URL(urlStr) as InternalUrl;
	const match = urlStr.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

/** A governance.json shaped like the one docs-control syncs into every governed repo. */
const GOVERNANCE = JSON.stringify({
	source_repo: "f5-sales-demo/docs-control",
	skip_files: {},
	protected_files: [".claude/governance.json"],
	repo_classes: {
		_default: "developer",
		classes: {
			content: { authority: "author", surfaces: ["docs/", "terraform/"] },
			developer: { authority: "delegate", delegate_to: "claude-code|codex" },
			scaffolding: { authority: "governed" },
		},
		repos: {
			mcn: "content",
			waf: "content",
			xcsh: "developer",
			"api-specs": "developer",
			"docs-control": "scaffolding",
		},
	},
});

function resolverFor(origin: string | null, governance: string | null) {
	return createFleetResolver({
		cwd: () => "/work/repo",
		repoRoot: async () => (origin === null ? null : "/work/repo"),
		repoOrigin: async () => origin,
		readGovernance: async () => governance,
		runGh: async () => ({ ok: false, stdout: "", stderr: "gh: command not found" }),
	});
}

async function render(origin: string | null, governance: string | null): Promise<string> {
	const res = await resolverFor(origin, governance).resolve(parseUrl("xcsh://fleet"));
	return res.content;
}

describe("parseRepoClasses", () => {
	it("reads the classes, assignments and fail-safe default", () => {
		const parsed = parseRepoClasses(GOVERNANCE);
		expect(parsed).not.toBeNull();
		expect(parsed?.defaultClass).toBe("developer");
		expect(parsed?.repos.mcn).toBe("content");
		expect(parsed?.classes.content?.authority).toBe("author");
	});

	it("returns null when the manifest predates repo_classes", () => {
		const old = JSON.stringify({ source_repo: "x", skip_files: {}, protected_files: [] });
		expect(parseRepoClasses(old)).toBeNull();
	});

	it("returns null on malformed JSON rather than throwing", () => {
		expect(parseRepoClasses("{not json")).toBeNull();
	});
});

describe("repoNameFromOrigin", () => {
	it("extracts the bare repo name from https and ssh remotes", () => {
		expect(repoNameFromOrigin("https://github.com/f5-sales-demo/mcn.git")).toEqual({
			org: "f5-sales-demo",
			name: "mcn",
		});
		expect(repoNameFromOrigin("git@github.com:f5-sales-demo/mcn.git")).toEqual({
			org: "f5-sales-demo",
			name: "mcn",
		});
	});

	it("treats the pre-rename org as the same repository", () => {
		const legacy = repoNameFromOrigin(`https://github.com/${LEGACY_ORG}/mcn.git`);
		expect(legacy?.name).toBe("mcn");
		expect(legacy?.org).toBe(LEGACY_ORG);
	});

	it("returns null for a non-GitHub remote", () => {
		expect(repoNameFromOrigin("https://gitlab.com/x/y.git")).toBeNull();
	});
});

describe("classifyRepo", () => {
	const parsed = parseRepoClasses(GOVERNANCE);

	it("returns the declared class for a governed repo", () => {
		expect(classifyRepo(parsed, "mcn").className).toBe("content");
		expect(classifyRepo(parsed, "xcsh").className).toBe("developer");
		expect(classifyRepo(parsed, "docs-control").className).toBe("scaffolding");
	});

	it("fails safe to the default class for an unlisted repo, never to content", () => {
		const verdict = classifyRepo(parsed, "ghostty-web");
		expect(verdict.className).toBe("developer");
		expect(verdict.declared).toBe(false);
		expect(verdict.className).not.toBe("content");
	});

	it("reports UNCLASSIFIED when there is no manifest at all", () => {
		expect(classifyRepo(null, "mcn").className).toBe(CLASS_UNCLASSIFIED);
	});
});

describe("xcsh://fleet document", () => {
	it("leads with the current repo's verdict and its authority", async () => {
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", GOVERNANCE);
		const head = doc.slice(0, doc.indexOf("## Fleet"));
		expect(head).toContain("f5-sales-demo/mcn");
		expect(head).toContain("content");
		expect(head).toMatch(/author/i);
		// The authoring path must be stated, not implied.
		expect(head).toMatch(/issue/i);
		expect(head).toMatch(/pull request|PR/);
	});

	it("tells a developer repo to delegate implementation rather than write feature code", async () => {
		const doc = await render("https://github.com/f5-sales-demo/xcsh.git", GOVERNANCE);
		const head = doc.slice(0, doc.indexOf("## Fleet"));
		expect(head).toContain("developer");
		expect(head).toMatch(/delegate/i);
		expect(head).not.toMatch(/full CRUD|author freely/i);
	});

	it("fails safe to developer for a repo outside the governed fleet", async () => {
		const doc = await render("https://github.com/f5-sales-demo/ghostty-web.git", GOVERNANCE);
		expect(doc).toContain("UNCLASSIFIED");
		expect(doc).toMatch(/fail(s|ing)? safe|fail-closed|treated as/i);
		expect(doc).toMatch(/developer/);
	});

	it("warns that pushes are rejected on the pre-rename org, and still classifies", async () => {
		const doc = await render(`https://github.com/${LEGACY_ORG}/mcn.git`, GOVERNANCE);
		expect(doc).toContain("content");
		expect(doc).toContain("git remote set-url");
		expect(doc).toMatch(/reject/i);
	});

	it("lists every class with its repos so the whole fleet is visible", async () => {
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", GOVERNANCE);
		expect(doc).toContain("## Fleet");
		for (const name of ["mcn", "waf", "xcsh", "api-specs", "docs-control"]) {
			expect(doc).toContain(name);
		}
	});

	it("degrades with an actionable message when the manifest predates repo_classes", async () => {
		const old = JSON.stringify({ source_repo: "x", skip_files: {}, protected_files: [] });
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", old);
		expect(doc).toMatch(/not (yet )?published|unavailable/i);
		expect(doc).toContain("governance.json");
		// It must not invent a class.
		expect(doc).not.toMatch(/class: content/);
	});

	it("degrades when there is no governance file and gh is unavailable", async () => {
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", null);
		expect(doc).toMatch(/unavailable|could not/i);
		expect(doc).toContain("docs-control");
	});

	it("never throws outside a git repository", async () => {
		const res = await resolverFor(null, null).resolve(parseUrl("xcsh://fleet"));
		expect(res.contentType).toBe("text/markdown");
		expect(res.sourcePath).toBe("xcsh://fleet");
		expect(res.size).toBeGreaterThan(0);
	});

	it("falls back to gh against docs-control when the cwd has no governance file", async () => {
		let received: string[] = [];
		const resolver = createFleetResolver({
			cwd: () => "/tmp",
			repoRoot: async () => null,
			repoOrigin: async () => null,
			readGovernance: async () => null,
			runGh: async args => {
				received = args;
				return { ok: true, stdout: GOVERNANCE, stderr: "" };
			},
		});
		const res = await resolver.resolve(parseUrl("xcsh://fleet"));
		expect(received.join(" ")).toContain("docs-control");
		expect(res.content).toContain("## Fleet");
		expect(res.content).toContain("mcn");
	});
});
