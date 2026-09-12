import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { getKeybindings, setKeybindings, visibleWidth } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../../../src/config/keybindings";
import { CopySelectorComponent } from "../../../src/modes/components/copy-selector";
import { initTheme } from "../../../src/modes/theme/theme";
import type { SessionMessageEntry } from "../../../src/session/session-manager";

function entry(id: string, message: AgentMessage): SessionMessageEntry {
	return { type: "message", id, parentId: null, timestamp: "2026-09-07T00:00:00Z", message };
}

function user(id: string, text: string): SessionMessageEntry {
	return entry(id, { role: "user", content: text, timestamp: 1 });
}

function assistant(id: string, text: string): SessionMessageEntry {
	return entry(id, {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	} as AgentMessage);
}

beforeAll(() => initTheme());
const originalKeybindings = getKeybindings();
afterEach(() => setKeybindings(originalKeybindings));

describe("CopySelectorComponent", () => {
	it("exposes stable copy source identity without changing pick callback arguments", () => {
		const onPick = vi.fn();
		const selector = new CopySelectorComponent([assistant("entry-a", "```ts\nsynthetic\n```")], {
			requestRender: vi.fn(),
			onPick,
			onCancel: vi.fn(),
		});
		expect(selector.selectedCopySource).toEqual({ targetId: "entry-a" });
		selector.handleInput("\r");
		expect(onPick).not.toHaveBeenCalled();
		selector.handleInput("\x1b[B");
		expect(selector.selectedCopySource).toEqual({ targetId: "entry-a", blockIndex: 0 });
		selector.handleInput("\r");
		expect(onPick).toHaveBeenCalledWith("synthetic", "code · ts");
		selector.handleInput("\x1b");
		expect(selector.selectedCopySource).toEqual({ targetId: "entry-a" });
	});

	it("opens named targets, activates labelled copy/open actions, and ascends", () => {
		const onPick = vi.fn();
		const onOpen = vi.fn();
		const onCancel = vi.fn();
		const selector = new CopySelectorComponent(
			[user("u", "question"), assistant("a", "```ts\nconst x = 1;\n```\n[docs](https://example.test/docs)")],
			{ requestRender: vi.fn(), onPick, onOpen, onCancel, viewportRows: () => 20 },
		);
		selector.handleInput("\r");
		for (let index = 0; index < 3; index++) selector.handleInput("\x1b[B");
		selector.handleInput("\r");
		expect(onOpen).toHaveBeenCalledWith("https://example.test/docs", "link · docs");
		selector.handleInput("\x1b[A");
		selector.handleInput("\r");
		expect(onPick).toHaveBeenCalledWith("https://example.test/docs", "link · docs");
		selector.handleInput("\x1b");
		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("makes earlier history an explicit action while printable input edits search", () => {
		const entries = [
			user("old", "old"),
			...Array.from({ length: 700 }, (_, index) => assistant(`a-${index}`, `part ${index}`)),
		];
		const selector = new CopySelectorComponent(entries, {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
		});
		expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Load earlier transcript");
		expect(selector.touchedEntryCount).toBe(600);
		selector.handleInput("a");
		expect(selector.targetCount).toBe(0);
		expect(Bun.stripANSI(selector.render(100).join("\n"))).toContain("Search: > a");
		selector.handleInput("\x1b");
		expect(Bun.stripANSI(selector.render(100).join("\n"))).not.toContain("Search: > a");
		selector.handleInput("\r");
		expect(selector.targetCount).toBe(701);
	});

	it("restores selection by stable entry ID after loading omitted history", () => {
		const entries = Array.from({ length: 605 }, (_, index) => user(`u-${index}`, `message ${index}`));
		const onPick = vi.fn();
		const selector = new CopySelectorComponent(entries, {
			requestRender: vi.fn(),
			onPick,
			onCancel: vi.fn(),
		});
		selector.handleInput("\x1b[A");
		const rendered = selector.render(100).map(line => Bun.stripANSI(line));
		const loadRow = rendered.findIndex(line => line.includes("Load earlier transcript"));
		expect(loadRow).toBeGreaterThan(0);
		selector.handleInput(`\x1b[<0;3;${loadRow + 1}M`);
		selector.handleInput("\r");
		selector.handleInput("\r");
		expect(onPick).toHaveBeenCalledWith("message 603", "user message");
	});

	it("searches editable text and clears search before closing", () => {
		const onCancel = vi.fn();
		const selector = new CopySelectorComponent([user("one", "alpha"), user("two", "beta")], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel,
		});
		selector.handleInput("lph");
		expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("Search: > lph");
		expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain("alpha");
		expect(Bun.stripANSI(selector.render(80).join("\n"))).not.toContain("beta");
		selector.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);

		const noMatch = new CopySelectorComponent([user("one", "alpha"), user("two", "beta")], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
		});
		noMatch.handleInput("zzzz-no-match");
		const emptyText = Bun.stripANSI(noMatch.render(80).join("\n"));
		expect(emptyText).toContain("No matching transcript entries");
		expect(emptyText).toContain("Clear search to restore the previous selection");
		expect(emptyText).not.toContain("Identity: two");
	});

	it("describes a genuinely empty transcript without unavailable history recovery", () => {
		const selector = new CopySelectorComponent([], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
		});
		const rendered = Bun.stripANSI(selector.render(80).join("\n"));
		expect(rendered).toContain("No transcript entries available");
		expect(rendered).toContain("Nothing can be copied from this session yet.");
		expect(rendered).not.toContain("Load the omitted transcript entries");
		expect(rendered).not.toContain("Load earlier transcript");
	});

	it("routes clicks for long stable identities after column truncation", () => {
		const firstId = "12345678-1234-1234-1234-123456789abc";
		const selector = new CopySelectorComponent([user(firstId, "first"), user("second", "second")], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
		});
		const rendered = selector.render(80).map(line => Bun.stripANSI(line));
		const row = rendered.findIndex(line => line.includes("first"));
		expect(row).toBeGreaterThan(0);
		selector.handleInput(`\x1b[<0;3;${row + 1}M`);
		expect(selector.selectedCopySource).toEqual({ targetId: firstId });
		expect(Bun.stripANSI(selector.render(80).join("\n"))).toContain(`Session entry ${firstId}`);
	});

	it("keeps long details reachable and the frame bounded while resizing", () => {
		const content = Array.from({ length: 45 }, (_, index) => `synthetic line ${index}`).join("\n");
		const selector = new CopySelectorComponent([user("long-entry", content)], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
			viewportRows: () => 20,
		});
		selector.handleInput("\r");
		const narrow = selector.render(60);
		expect(narrow.length).toBeLessThanOrEqual(20);
		expect(narrow.every(line => visibleWidth(line) <= 60)).toBe(true);
		expect(Bun.stripANSI(narrow.join("\n"))).toContain(": details 1–");
		selector.handleInput("\x1b[6~");
		expect(Bun.stripANSI(selector.render(60).join("\n"))).toContain("synthetic line 7");
		expect(selector.render(140).every(line => visibleWidth(line) <= 100)).toBe(true);
	});

	it("honors remapped navigation and does not treat Ctrl+C as Back", () => {
		const keys = KeybindingsManager.inMemory();
		keys.setUserBindings({
			"tui.select.down": "ctrl+n",
			"tui.select.confirm": "ctrl+y",
			"tui.select.cancel": "ctrl+x",
		});
		setKeybindings(keys);
		const onCancel = vi.fn();
		const onPick = vi.fn();
		const selector = new CopySelectorComponent([user("first", "alpha"), user("second", "beta")], {
			requestRender: vi.fn(),
			onPick,
			onCancel,
		});
		const text = Bun.stripANSI(selector.render(80).join("\n"));
		expect(text).toContain("Ctrl+N");
		expect(text).toContain("Ctrl+Y: open");
		expect(text).toContain("Ctrl+X: close");
		selector.handleInput("\r");
		selector.handleInput("\x03");
		expect(onPick).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		selector.handleInput("\x19");
		selector.handleInput("\x19");
		expect(onPick).toHaveBeenCalledWith("beta", "user message");
	});

	it("keeps disposal idempotent", () => {
		const selector = new CopySelectorComponent([user("u", "hello")], {
			requestRender: vi.fn(),
			onPick: vi.fn(),
			onCancel: vi.fn(),
		});
		expect(() => {
			selector.dispose();
			selector.dispose();
		}).not.toThrow();
	});

	it("routes scroll-aware clicks only through visible copy/open controls and skips no-op repaint", () => {
		const requestRender = vi.fn();
		const onPick = vi.fn();
		const onOpen = vi.fn();
		const links = Array.from({ length: 8 }, (_, index) => `[link ${index}](https://example.test/${index})`).join(
			"\n",
		);
		const selector = new CopySelectorComponent([assistant("a", links)], {
			requestRender,
			onPick,
			onOpen,
			onCancel: vi.fn(),
			viewportRows: () => 14,
		});
		selector.handleInput("\r");
		for (let index = 0; index < 6; index++) selector.handleInput("\x1b[<65;1;1M");
		const rendered = selector.render(100).map(line => Bun.stripANSI(line));
		const row = rendered.findIndex(line => line.includes("7. Open link · link 2"));
		expect(row).toBeGreaterThanOrEqual(2);
		selector.handleInput(`\x1b[<0;3;${row + 1}M`);
		expect(onOpen).toHaveBeenCalledWith("https://example.test/2", "link · link 2");
		expect(onPick).not.toHaveBeenCalled();

		for (let index = 0; index < 20; index++) {
			selector.handleInput("\x1b[<65;1;1M");
			selector.render(100);
		}
		requestRender.mockClear();
		selector.handleInput("\x1b[<65;1;1M");
		expect(requestRender).not.toHaveBeenCalled();
	});
});
