import { describe, expect, it } from "bun:test";
import {
	CLASS_UNCLASSIFIED,
	CURRENT_ORG,
	classifyRepo,
	createFleetResolver,
	createLiveCwdGetter,
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
		expect(classifyRepo(parsed, { org: CURRENT_ORG, name: "mcn" }).className).toBe("content");
		expect(classifyRepo(parsed, { org: CURRENT_ORG, name: "xcsh" }).className).toBe("developer");
		expect(classifyRepo(parsed, { org: CURRENT_ORG, name: "docs-control" }).className).toBe("scaffolding");
	});

	it("fails safe to the default class for an unlisted repo, never to content", () => {
		const verdict = classifyRepo(parsed, { org: CURRENT_ORG, name: "ghostty-web" });
		expect(verdict.className).toBe("developer");
		expect(verdict.declared).toBe(false);
		expect(verdict.className).not.toBe("content");
	});

	it("reports UNCLASSIFIED when there is no manifest at all", () => {
		expect(classifyRepo(null, { org: CURRENT_ORG, name: "mcn" }).className).toBe(CLASS_UNCLASSIFIED);
	});
});

describe("live working directory (#2429 review)", () => {
	it("follows the session's cd instead of pinning the startup directory", () => {
		// The bash tool tracks its own cwd and emits `cwd:changed`; process.cwd() never
		// moves. Classifying against the startup directory would keep a content grant
		// alive after cd'ing into a developer repository.
		const handlers: Array<(next: unknown) => void> = [];
		const events = {
			on(_event: "cwd:changed", handler: (next: unknown) => void) {
				handlers.push(handler);
				return () => {};
			},
		};
		const getCwd = createLiveCwdGetter("/work/mcn", events);
		expect(getCwd()).toBe("/work/mcn");
		for (const h of handlers) h("/work/xcsh");
		expect(getCwd()).toBe("/work/xcsh");
	});

	it("ignores non-string and empty payloads", () => {
		const handlers: Array<(next: unknown) => void> = [];
		const events = {
			on(_e: "cwd:changed", h: (next: unknown) => void) {
				handlers.push(h);
				return () => {};
			},
		};
		const getCwd = createLiveCwdGetter("/work/mcn", events);
		for (const h of handlers) {
			h(undefined);
			h("");
			h(42);
		}
		expect(getCwd()).toBe("/work/mcn");
	});

	it("works with no event source at all", () => {
		expect(createLiveCwdGetter("/work/mcn")()).toBe("/work/mcn");
	});
});

describe("organization trust boundary (#2429 review)", () => {
	it("does not grant a foreign org's same-named repo the declared class", async () => {
		// github.com/attacker/mcn must not inherit f5-sales-demo/mcn's authoring rights.
		const doc = await render("https://github.com/some-other-org/mcn.git", GOVERNANCE);
		expect(doc).not.toMatch(/class: \*\*content\*\*/);
		expect(doc).toMatch(/outside|not part of|foreign|unrecognized/i);
	});

	it("still classifies both the current and the pre-rename org", async () => {
		for (const org of [CURRENT_ORG, LEGACY_ORG]) {
			const doc = await render(`https://github.com/${org}/mcn.git`, GOVERNANCE);
			expect(doc).toContain("class: **content**");
		}
	});

	it("classifyRepo requires a trusted org", () => {
		const parsed = parseRepoClasses(GOVERNANCE);
		expect(classifyRepo(parsed, { org: CURRENT_ORG, name: "mcn" }).className).toBe("content");
		expect(classifyRepo(parsed, { org: "some-other-org", name: "mcn" }).trustedOrg).toBe(false);
		expect(classifyRepo(parsed, { org: "some-other-org", name: "mcn" }).className).not.toBe("content");
	});
});

describe("manifest provenance (#2429 review)", () => {
	it("rejects a local manifest that is not published by docs-control", async () => {
		const foreign = JSON.parse(GOVERNANCE);
		foreign.source_repo = "attacker/docs-control";
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", JSON.stringify(foreign));
		// Untrusted provenance must not produce an authoring grant.
		expect(doc).not.toMatch(/class: \*\*content\*\*/);
	});

	it("accepts a manifest published by docs-control", async () => {
		const doc = await render("https://github.com/f5-sales-demo/mcn.git", GOVERNANCE);
		expect(doc).toContain("class: **content**");
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
