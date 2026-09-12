import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

describe("/branch slash command", () => {
	it("always opens message branching instead of inheriting the double-Escape tree preference", async () => {
		const showUserMessageSelector = vi.fn();
		const showTreeSelector = vi.fn();
		const setText = vi.fn();
		const runtime = {
			ctx: {
				showUserMessageSelector,
				showTreeSelector,
				editor: { setText },
			} as unknown as InteractiveModeContext,
			handleBackgroundCommand: () => {},
		};

		expect(await executeBuiltinSlashCommand("/branch", runtime)).toBe(true);
		expect(showUserMessageSelector).toHaveBeenCalledTimes(1);
		expect(showTreeSelector).not.toHaveBeenCalled();
		expect(setText).toHaveBeenCalledWith("");
	});
});
