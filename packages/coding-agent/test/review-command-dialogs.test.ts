import { afterEach, describe, expect, it, vi } from "bun:test";
import { ReviewCommand } from "../src/extensibility/custom-commands/bundled/review";
import type { CustomCommandAPI } from "../src/extensibility/custom-commands/types";
import type { HookCommandContext } from "../src/extensibility/hooks/types";
import * as git from "../src/utils/git";

const reviewableDiff = [
	"diff --git a/src/example.ts b/src/example.ts",
	"index 1111111..2222222 100644",
	"--- a/src/example.ts",
	"+++ b/src/example.ts",
	"@@ -1 +1 @@",
	"-old",
	"+new",
].join("\n");

afterEach(() => vi.restoreAllMocks());

function harness(selections: Array<string | undefined>, editorResult?: string) {
	const select = vi.fn(async (_title: string, _options: string[]) => selections.shift());
	const editor = vi.fn(async (_title: string, _prefill?: string) => editorResult);
	const notify = vi.fn();
	const ctx = { hasUI: true, ui: { select, editor, notify } } as unknown as HookCommandContext;
	const command = new ReviewCommand({ cwd: "/synthetic/repository" } as CustomCommandAPI);
	return { command, ctx, editor, notify, select };
}

describe("review command shared dialogs", () => {
	it("keeps the initial mode chooser cancel-safe", async () => {
		const { command, ctx, select } = harness([undefined]);
		expect(await command.execute([], ctx)).toBeUndefined();
		expect(select).toHaveBeenCalledWith(
			"Review Mode",
			expect.arrayContaining([expect.stringContaining("base branch")]),
		);
	});

	it("uses the shared nested branch selector and returns a review prompt", async () => {
		vi.spyOn(git.branch, "list").mockResolvedValue(["main", "feature"]);
		vi.spyOn(git.branch, "current").mockResolvedValue("feature");
		vi.spyOn(git, "diff").mockResolvedValue(reviewableDiff);
		const { command, ctx, select } = harness(["1. Review against a base branch (PR Style)", "main"]);
		const result = await command.execute([], ctx);
		expect(select.mock.calls[1]).toEqual(["Select base branch to compare against", ["main", "feature"]]);
		expect(result).toContain("Reviewing changes between `main` and `feature`");
	});

	it("uses the shared commit selector without changing the selected identity", async () => {
		vi.spyOn(git.log, "onelines").mockResolvedValue(["abc1234 synthetic change"]);
		vi.spyOn(git, "show").mockResolvedValue(reviewableDiff);
		const { command, ctx, select } = harness(["3. Review a specific commit", "abc1234 synthetic change"]);
		const result = await command.execute([], ctx);
		expect(select.mock.calls[1]).toEqual(["Select commit to review", ["abc1234 synthetic change"]]);
		expect(result).toContain("Reviewing commit `abc1234`");
	});

	it("uses the shared multiline editor and treats Escape as no request", async () => {
		const cancelled = harness(["4. Custom review instructions"], undefined);
		expect(await cancelled.command.execute([], cancelled.ctx)).toBeUndefined();
		expect(cancelled.editor).toHaveBeenCalledWith("Enter custom review instructions", "Review the following:\n\n");

		vi.spyOn(git, "diff").mockResolvedValue("");
		const accepted = harness(["4. Custom review instructions"], "Inspect lifecycle races");
		const result = await accepted.command.execute([], accepted.ctx);
		expect(result).toContain("Inspect lifecycle races");
	});
});
