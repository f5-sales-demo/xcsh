/**
 * Issue #226 — UserMessageComponent captures getMarkdownTheme() at construction
 * time and never rebuilds its Markdown child. When the global theme changes,
 * the in-viewport rendering of user messages keeps the old theme's markdown
 * styling (code blocks, quotes, headings, etc.) until the message scrolls out.
 *
 * Fix mirrors AssistantMessageComponent's override-invalidate + rebuild
 * pattern. These tests pin that contract.
 */
import { describe, expect, it } from "bun:test";
import { UserMessageComponent } from "@f5-sales-demo/xcsh/modes/components/user-message";
import { initTheme } from "@f5-sales-demo/xcsh/modes/theme/theme";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("UserMessageComponent — invalidate replaces Markdown child (issue #226)", () => {
	it("invalidate() swaps the Markdown child for a fresh instance (so new theme is captured)", async () => {
		await initTheme();
		const c = new UserMessageComponent("hello");
		// Container children layout at construction:
		//   [0] Spacer(1)
		//   [1] Markdown(text, …, getMarkdownTheme())
		expect(c.children.length).toBe(2);
		const markdownBefore = c.children[1];

		c.invalidate();

		expect(c.children.length).toBe(2);
		const markdownAfter = c.children[1];
		expect(markdownAfter).not.toBe(markdownBefore);
	});

	it("preserves the text across rebuilds", async () => {
		await initTheme();
		const c = new UserMessageComponent("hello rebuild");
		const before = stripAnsi(c.render(80).join("\n"));
		expect(before).toContain("hello rebuild");

		c.invalidate();

		const after = stripAnsi(c.render(80).join("\n"));
		expect(after).toContain("hello rebuild");
	});

	it("preserves the synthetic flag across rebuilds (dim-styled user message)", async () => {
		await initTheme();
		const plain = new UserMessageComponent("test", false);
		const synthetic = new UserMessageComponent("test", true);

		// Synthetic uses theme.fg("dim",...) instead of italic+userMessageText —
		// after invalidate the flag must still be honored.
		const syntheticBefore = synthetic.render(80).join("\n");
		synthetic.invalidate();
		const syntheticAfter = synthetic.render(80).join("\n");

		plain.invalidate();
		const plainAfter = plain.render(80).join("\n");

		// Synthetic output should differ from plain output, both before and
		// after invalidate, because the render-time color wrapping differs.
		expect(syntheticBefore).not.toBe(plainAfter);
		expect(syntheticAfter).not.toBe(plainAfter);
	});
});
