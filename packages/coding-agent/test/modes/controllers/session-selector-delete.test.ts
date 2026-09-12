import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { SessionSelectorComponent } from "../../../src/modes/components/session-selector";
import { initTheme } from "../../../src/modes/theme/theme";
import type { SessionInfo } from "../../../src/session/session-manager";

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createSession(id: string, title: string): SessionInfo {
	return {
		path: `/tmp/${id}.jsonl`,
		id,
		cwd: "/tmp",
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		firstMessage: `${title} first message`,
		allMessagesText: `${title} first message`,
	};
}

function createSelector(onDelete: (session: SessionInfo) => Promise<boolean>): SessionSelectorComponent {
	return new SessionSelectorComponent(
		[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
		() => {},
		() => {},
		() => {},
		onDelete,
	);
}

function renderText(selector: SessionSelectorComponent): string {
	return selector.render(120).join("\n");
}

describe("SessionSelectorComponent delete confirmation", () => {
	it("keeps the session visible and shows the error when delete fails after confirmation", async () => {
		const onDelete = vi.fn(async () => {
			throw new Error("disk failed");
		});
		const selector = createSelector(onDelete);

		selector.handleInput("\x1b[3~");
		expect(renderText(selector)).toContain("Review session deletion");
		expect(renderText(selector)).toContain("Cancel");
		expect(renderText(selector)).toContain("Alpha");

		selector.handleInput("\x1b[B");
		selector.handleInput("\n");
		await Bun.sleep(0);

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).toContain("disk failed");
		expect(rendered).toContain("Alpha");
		expect(rendered).toContain("Retry change");
		selector.handleInput("\n");
		expect(renderText(selector)).toContain("Beta");
	});

	it("keeps the session visible when delete is canceled upstream", async () => {
		const onDelete = vi.fn(async () => false);
		const selector = createSelector(onDelete);

		selector.handleInput("\x1b[3~");
		selector.handleInput("\x1b[B");
		selector.handleInput("\n");
		await Bun.sleep(0);

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).toContain("Alpha");
		expect(rendered).toContain("Session deletion was not completed");
		selector.handleInput("\n");
		expect(renderText(selector)).toContain("Beta");
	});

	it("removes the session row after a successful delete", async () => {
		const onDelete = vi.fn(async () => true);
		const selector = createSelector(onDelete);

		selector.handleInput("\x1b[3~");
		selector.handleInput("\x1b[B");
		selector.handleInput("\n");
		await Bun.sleep(0);

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).not.toContain("Alpha");
		expect(rendered).toContain("Beta");
	});
});
