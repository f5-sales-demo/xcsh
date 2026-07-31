import { describe, expect, it } from "bun:test";
import { classifyStartFolder, resolveStartFolder, type StartFolderDeps } from "../src/discovery/start-folder";

/** Deps that answer as told; any field omitted throws, so a test must state what it exercises. */
function deps(over: Partial<StartFolderDeps>): StartFolderDeps {
	return {
		repoRoot: async () => {
			throw new Error("repoRoot not stubbed");
		},
		originUrl: async () => {
			throw new Error("originUrl not stubbed");
		},
		...over,
	};
}

describe("classifyStartFolder", () => {
	it("is plain when the directory is not in a repository", () => {
		expect(classifyStartFolder(null, "https://github.com/org/name.git")).toEqual({ kind: "plain" });
	});

	it("is github for an https remote, with the slug", () => {
		expect(classifyStartFolder("/w", "https://github.com/f5-sales-demo/mcn.git")).toEqual({
			kind: "github",
			slug: "f5-sales-demo/mcn",
		});
	});

	// parseGitHubRepo already handles these three spellings; this pins that the classifier
	// actually delegates to it rather than doing its own narrower matching.
	it("is github for scp-style ssh and git:// remotes", () => {
		expect(classifyStartFolder("/w", "git@github.com:org/name.git")).toEqual({ kind: "github", slug: "org/name" });
		expect(classifyStartFolder("/w", "git://github.com/org/name")).toEqual({ kind: "github", slug: "org/name" });
	});

	// The middle state, and the reason there are three rather than two: version control is
	// legitimate here, GitHub-specific actions are not.
	it("is git for a repository whose remote is not GitHub", () => {
		expect(classifyStartFolder("/w", "https://gitlab.com/org/name.git")).toEqual({ kind: "git" });
	});

	it("is git for a repository with no remote at all", () => {
		expect(classifyStartFolder("/w", null)).toEqual({ kind: "git" });
	});

	// A host that merely contains "github.com" is not GitHub, and neither is a URL with
	// github.com somewhere in its PATH. Getting either wrong grants GitHub scope — and
	// prompt text authorising it — to a repository hosted somewhere else entirely.
	it("is git for remotes that only look like GitHub", () => {
		for (const url of [
			"https://github.com.evil.example/org/name.git",
			"https://gitlab.example/github.com/acme/repo.git",
			"https://evil.example/?x=github.com/acme/repo",
			"https://github.com/org/repo/tree/main",
		]) {
			expect(classifyStartFolder("/w", url)).toEqual({ kind: "git" });
		}
	});
});

describe("resolveStartFolder fails in the safe direction", () => {
	it("resolves plain when the repo probe throws", async () => {
		const got = await resolveStartFolder("/w", deps({}));
		expect(got).toEqual({ kind: "plain" });
	});

	it("resolves plain when the directory is not a repository", async () => {
		const got = await resolveStartFolder("/w", deps({ repoRoot: async () => null }));
		expect(got).toEqual({ kind: "plain" });
	});

	// A confirmed repository whose remote cannot be read is a repository, so claiming
	// "not a repository" would be false and would suppress legitimate version-control
	// work. Reporting `git` is both true and safe: it withholds GitHub scope.
	it("resolves git — not plain — when the repo is known but the remote probe throws", async () => {
		const got = await resolveStartFolder("/w", deps({ repoRoot: async () => "/w" }));
		expect(got).toEqual({ kind: "git" });
	});

	it("resolves github when both probes answer", async () => {
		const got = await resolveStartFolder(
			"/w",
			deps({ repoRoot: async () => "/w", originUrl: async () => "git@github.com:f5-sales-demo/xcsh.git" }),
		);
		expect(got).toEqual({ kind: "github", slug: "f5-sales-demo/xcsh" });
	});
});
