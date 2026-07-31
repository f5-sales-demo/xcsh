import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifyStartFolder, resolveStartFolder, type StartFolderDeps } from "../src/discovery/start-folder";
import * as git from "../src/utils/git";

/** Deps that answer as told; any field omitted throws, so a test must state what it exercises. */
function deps(over: Partial<StartFolderDeps>): StartFolderDeps {
	return {
		repoRoot: async () => {
			throw new Error("repoRoot not stubbed");
		},
		originUrl: async () => {
			throw new Error("originUrl not stubbed");
		},
		isIgnored: async () => false,
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
			"https://gitlab.example/github.com/example-corp/repo.git",
			"https://evil.example/?x=github.com/example-corp/repo",
			"https://github.com/org/repo/tree/main",
		]) {
			expect(classifyStartFolder("/w", url)).toEqual({ kind: "git" });
		}
	});
});

describe("a git-ignored start folder", () => {
	// The repository is real, but this subtree was deliberately excluded from it — the
	// shape of `example-corp-app/lab-secrets/`, which is exactly where tenant credentials live.
	// The kind stays accurate; the caution rides alongside it.
	it("keeps the kind and flags the exclusion", () => {
		expect(classifyStartFolder("/w", "https://github.com/example-corp/app.git", true)).toEqual({
			kind: "github",
			slug: "example-corp/app",
			ignored: true,
		});
		expect(classifyStartFolder("/w", null, true)).toEqual({ kind: "git", ignored: true });
	});

	it("does not flag an unignored folder", () => {
		expect(classifyStartFolder("/w", null, false)).toEqual({ kind: "git" });
	});

	it("is resolved end to end from the probes", async () => {
		const got = await resolveStartFolder(
			"/w",
			deps({
				repoRoot: async () => "/w",
				originUrl: async () => "https://github.com/example-corp/app.git",
				isIgnored: async () => true,
			}),
		);
		expect(got).toEqual({ kind: "github", slug: "example-corp/app", ignored: true });
	});

	// `git check-ignore` exits 1 for "not ignored", which is an answer rather than a
	// failure, so a throw here means git itself is broken — and repoRoot already
	// succeeded, so that is close to impossible. Treat it as "not ignored" rather than
	// cautioning in every repository on the strength of a broken probe.
	it("treats an unanswerable ignore probe as not ignored", async () => {
		const got = await resolveStartFolder(
			"/w",
			deps({
				repoRoot: async () => "/w",
				originUrl: async () => null,
				isIgnored: async () => {
					throw new Error("check-ignore blew up");
				},
			}),
		);
		expect(got).toEqual({ kind: "git" });
	});
});

describe("resolveStartFolder cancellation", () => {
	// #2654 review round 4: the timeout wrapper only rejects its own promise, so unless the
	// signal actually reaches the probes their git subprocesses outlive the fallback — and
	// the prompt is rebuilt many times per session.
	it("hands the caller's signal to every probe", async () => {
		const seen: (AbortSignal | undefined)[] = [];
		const controller = new AbortController();
		await resolveStartFolder(
			"/w",
			{
				repoRoot: async (_c, s) => {
					seen.push(s);
					return "/w";
				},
				originUrl: async (_c, s) => {
					seen.push(s);
					return null;
				},
				isIgnored: async (_c, s) => {
					seen.push(s);
					return false;
				},
			},
			controller.signal,
		);
		expect(seen).toHaveLength(3);
		expect(seen.every(s => s === controller.signal)).toBe(true);
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

describe("git.repo.ignored reports only what it knows", () => {
	// #2654 review round 4. `runCommand` returns exit codes rather than throwing, so
	// mapping "anything but 0" to false silently turned a fatal 128 — dubious ownership,
	// a corrupt repository — into a confident "not ignored", dropping the sensitive-subtree
	// warning. Only 0 and 1 are answers; 128 is reachable simply by asking outside a repo.
	it("throws rather than answering when git could not decide", async () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-notrepo-"));
		try {
			expect(git.repo.ignored(outside)).rejects.toThrow();
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});

	it("answers cleanly inside a repository", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-repo-"));
		try {
			await Bun.$`git init -q`.cwd(root).quiet();
			fs.writeFileSync(path.join(root, ".gitignore"), "hidden/\n");
			fs.mkdirSync(path.join(root, "hidden"));
			expect(await git.repo.ignored(root)).toBe(false);
			expect(await git.repo.ignored(path.join(root, "hidden"))).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
