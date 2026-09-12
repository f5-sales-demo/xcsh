import { afterEach, beforeAll, expect, it, spyOn, vi } from "bun:test";
import * as native from "@f5-sales-demo/pi-natives";
import type { CopySelectorComponent } from "../../../src/modes/components/copy-selector";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { setTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import * as clipboard from "../../../src/modes/utils/clipboard-action";
import type { SessionMessageEntry } from "../../../src/session/session-manager";

beforeAll(() => setTheme("xcsh-dark"));
afterEach(() => vi.restoreAllMocks());

it("reviews a session-qualified selector target, re-resolves its text, and preserves cancelled selection", async () => {
	const nativeCopy = spyOn(native, "copyToClipboard").mockImplementation(() => {});
	let entries: SessionMessageEntry[] = [
		{
			type: "message",
			id: "entry-a",
			parentId: null,
			timestamp: "2026-09-10T00:00:00Z",
			message: { role: "user", content: "synthetic", timestamp: 1 },
		},
	];
	let selector!: CopySelectorComponent;
	const hide = vi.fn();
	const manager = {
		getSessionId: () => "synthetic-session",
		getMessageBranchTail: () => ({ entries, truncated: false }),
		getBranch: () => entries,
	};
	const ctx = {
		session: { sessionManager: manager },
		ui: {
			terminal: { rows: 24 },
			requestRender: vi.fn(),
			showOverlay: (component: CopySelectorComponent) => {
				selector = component;
				return { hide };
			},
		},
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
	} as unknown as InteractiveModeContext;
	const review = spyOn(clipboard, "reviewClipboardAction").mockResolvedValue("cancelled");
	new SelectorController(ctx).showCopySelector();
	selector.handleInput("\r");
	selector.handleInput("\r");
	await Promise.resolve();
	expect(review).toHaveBeenCalledTimes(1);
	expect(nativeCopy).not.toHaveBeenCalled();
	const action = review.mock.calls[0]![1];
	expect(action.identity).toBe("copy:synthetic-session:entry-a:turn");
	expect(action.current()).toBe(true);
	expect(action.resolveText()).toBe("synthetic");
	entries = [{ ...entries[0]!, message: { role: "user", content: "changed synthetic", timestamp: 2 } }];
	expect(action.resolveText()).toBe("changed synthetic");
	expect(hide).not.toHaveBeenCalled();
	expect(selector.selectedCopySource).toEqual({ targetId: "entry-a" });
	entries = [];
	expect(action.resolveText()).toBeUndefined();
	selector.handleInput("\x1b");
	expect(action.current()).toBe(true);
	selector.handleInput("\x1b");
	expect(action.current()).toBe(false);
});

for (const delivered of ["copied", "requested"] as const) {
	it(`closes the selector only after clipboard delivery is ${delivered}`, async () => {
		const entry: SessionMessageEntry = {
			type: "message",
			id: "entry-a",
			parentId: null,
			timestamp: "2026-09-10T00:00:00Z",
			message: { role: "user", content: "synthetic", timestamp: 1 },
		};
		let selector!: CopySelectorComponent;
		const hide = vi.fn();
		const manager = {
			getSessionId: () => "synthetic-session",
			getMessageBranchTail: () => ({ entries: [entry], truncated: false }),
			getBranch: () => [entry],
		};
		const ctx = {
			session: { sessionManager: manager },
			ui: {
				terminal: { rows: 24 },
				requestRender: vi.fn(),
				showOverlay: (component: CopySelectorComponent) => {
					selector = component;
					return { hide };
				},
			},
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
		} as unknown as InteractiveModeContext;
		spyOn(clipboard, "reviewClipboardAction").mockResolvedValue(delivered);
		new SelectorController(ctx).showCopySelector();
		selector.handleInput("\r");
		selector.handleInput("\r");
		await Promise.resolve();
		await Promise.resolve();
		expect(hide).toHaveBeenCalledTimes(1);
	});
}
