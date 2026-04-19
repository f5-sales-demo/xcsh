import { describe, expect, it } from "bun:test";
import {
	type EnvLike,
	type GhFn,
	type GitFn,
	resolveBranch,
	resolveCommit,
	resolveDirty,
	resolvePrNumber,
	resolveTag,
} from "../scripts/build-info/resolvers";

function gitFn(responses: Record<string, string>): GitFn {
	return async (args: string[]) => responses[args.join(" ")] ?? "";
}

describe("resolveCommit (build-time)", () => {
	it("prefers XCSH_BUILD_COMMIT override", async () => {
		const env: EnvLike = { XCSH_BUILD_COMMIT: "a".repeat(40) };
		expect(await resolveCommit(env, gitFn({ "rev-parse HEAD": "b".repeat(40) }))).toBe("a".repeat(40));
	});

	it("falls back to git rev-parse HEAD", async () => {
		expect(await resolveCommit({}, gitFn({ "rev-parse HEAD": "c".repeat(40) }))).toBe("c".repeat(40));
	});

	it("returns empty when nothing resolves", async () => {
		expect(await resolveCommit({}, gitFn({}))).toBe("");
	});
});

describe("resolveBranch (build-time)", () => {
	it("prefers XCSH_BUILD_BRANCH override", async () => {
		const env: EnvLike = { XCSH_BUILD_BRANCH: "release-17" };
		expect(await resolveBranch(env, gitFn({ "rev-parse --abbrev-ref HEAD": "feature" }))).toBe("release-17");
	});

	it("uses git abbrev-ref when no override", async () => {
		expect(await resolveBranch({}, gitFn({ "rev-parse --abbrev-ref HEAD": "main" }))).toBe("main");
	});

	it("skips detached HEAD and falls to remote-contains", async () => {
		const git = gitFn({
			"rev-parse --abbrev-ref HEAD": "HEAD",
			"branch -r --contains HEAD": "  origin/main\n  origin/release-17",
		});
		expect(await resolveBranch({}, git)).toBe("main");
	});

	it("returns 'unknown' when nothing resolves", async () => {
		expect(await resolveBranch({}, gitFn({}))).toBe("unknown");
	});
});

describe("resolveTag (build-time)", () => {
	it("prefers XCSH_BUILD_TAG override", async () => {
		const env: EnvLike = { XCSH_BUILD_TAG: "v99.0.0" };
		expect(await resolveTag(env, gitFn({}))).toBe("v99.0.0");
	});

	it("uses git describe when no override", async () => {
		expect(await resolveTag({}, gitFn({ "describe --exact-match --tags HEAD": "v17.4.2" }))).toBe("v17.4.2");
	});

	it("returns empty when HEAD is not tagged", async () => {
		expect(await resolveTag({}, gitFn({}))).toBe("");
	});
});

describe("resolveDirty (build-time)", () => {
	it("returns true when git status has changes", async () => {
		expect(await resolveDirty({}, gitFn({ "status --porcelain": " M foo" }))).toBe(true);
	});

	it("returns false when git status is clean", async () => {
		expect(await resolveDirty({}, gitFn({ "status --porcelain": "" }))).toBe(false);
	});
});

describe("resolvePrNumber (build-time)", () => {
	const ghSpy = (response: string, seen: { sha: string }): GhFn => {
		return async sha => {
			seen.sha = sha;
			return response;
		};
	};

	it("prefers XCSH_BUILD_PR override", async () => {
		const seen = { sha: "" };
		expect(await resolvePrNumber("a".repeat(40), { XCSH_BUILD_PR: "999" }, ghSpy("42", seen))).toBe("999");
		expect(seen.sha).toBe("");
	});

	it("calls gh with the sha when no override", async () => {
		const seen = { sha: "" };
		expect(await resolvePrNumber("a".repeat(40), {}, ghSpy("42", seen))).toBe("42");
		expect(seen.sha).toBe("a".repeat(40));
	});

	it("returns empty when sha is missing", async () => {
		const seen = { sha: "" };
		expect(await resolvePrNumber("", {}, ghSpy("42", seen))).toBe("");
		expect(seen.sha).toBe("");
	});
});
