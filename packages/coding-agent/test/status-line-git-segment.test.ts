import { beforeAll, describe, expect, it } from "bun:test";
import { SEGMENTS } from "../src/modes/components/status-line/segments";
import type { SegmentContext } from "../src/modes/components/status-line/types";
import { initTheme, theme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

type GitStatus = NonNullable<SegmentContext["git"]["status"]>;

function baseStatus(): GitStatus {
	return {
		staged: 0,
		unstaged: 0,
		untracked: 0,
		conflicted: 0,
		ahead: 0,
		behind: 0,
		stashes: 0,
		action: "",
	};
}

function makeCtx(branch: string | null, status: GitStatus | null): SegmentContext {
	// The git segment only reads ctx.git and ctx.options.git. Other SegmentContext
	// fields are unused here — cast from a minimal stub.
	return {
		git: { branch, status, pr: null },
		options: {},
	} as unknown as SegmentContext;
}

describe("powerline git segment priority (issue #242)", () => {
	it("Case 1 — conflict wins even with staged+unstaged", () => {
		const ctx = makeCtx("main", { ...baseStatus(), conflicted: 2, unstaged: 5, staged: 3 });
		const out = SEGMENTS.git.render(ctx);
		expect(out.visible).toBe(true);
		expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitConflictBg"));
		expect(out.fg).toBe(theme.getFgAnsi("statusLineGitConflictFg"));
	});

	it("Case 2 — staged+unstaged together render as dirty, NOT staged (priority regression guard)", () => {
		const ctx = makeCtx("main", { ...baseStatus(), staged: 4, unstaged: 2 });
		const out = SEGMENTS.git.render(ctx);
		expect(out.visible).toBe(true);
		expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitDirtyBg"));
		expect(out.fg).toBe(theme.getFgAnsi("statusLineGitDirtyFg"));
	});

	it("Case 3 — staged-only renders with new staged tokens", () => {
		const ctx = makeCtx("main", { ...baseStatus(), staged: 3 });
		const out = SEGMENTS.git.render(ctx);
		expect(out.visible).toBe(true);
		expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitStagedBg"));
		expect(out.fg).toBe(theme.getFgAnsi("statusLineGitStagedFg"));
	});

	it("Case 4 — untracked-only renders with untracked tokens", () => {
		const ctx = makeCtx("main", { ...baseStatus(), untracked: 7 });
		const out = SEGMENTS.git.render(ctx);
		expect(out.visible).toBe(true);
		expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitUntrackedBg"));
		expect(out.fg).toBe(theme.getFgAnsi("statusLineGitUntrackedFg"));
	});

	it("Case 5 — clean repo renders with clean tokens", () => {
		const ctx = makeCtx("main", baseStatus());
		const out = SEGMENTS.git.render(ctx);
		expect(out.visible).toBe(true);
		expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitCleanBg"));
		expect(out.fg).toBe(theme.getFgAnsi("statusLineGitCleanFg"));
	});

	describe("Case 6 — null/undefined gitStatus defensive guard", () => {
		it("6a: branch=null && status=null → not rendered", () => {
			const out = SEGMENTS.git.render(makeCtx(null, null));
			expect(out.visible).toBe(false);
			expect(out.content).toBe("");
		});

		it("6b: branch='main' && status=null → renders branch with clean tokens (graceful degradation)", () => {
			const out = SEGMENTS.git.render(makeCtx("main", null));
			expect(out.visible).toBe(true);
			expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitCleanBg"));
			expect(out.fg).toBe(theme.getFgAnsi("statusLineGitCleanFg"));
		});

		it("6a (undefined): branch=null && status=undefined → not rendered", () => {
			const out = SEGMENTS.git.render(makeCtx(null, undefined as unknown as null));
			expect(out.visible).toBe(false);
			expect(out.content).toBe("");
		});

		it("6b (undefined): branch='main' && status=undefined → renders branch with clean tokens", () => {
			const out = SEGMENTS.git.render(makeCtx("main", undefined as unknown as null));
			expect(out.visible).toBe(true);
			expect(out.bg).toBe(theme.fgColorAsBg("statusLineGitCleanBg"));
			expect(out.fg).toBe(theme.getFgAnsi("statusLineGitCleanFg"));
		});
	});
});
