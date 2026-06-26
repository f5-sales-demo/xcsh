import { describe, expect, it } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { BtwPanelComponent } from "@f5-sales-demo/xcsh/modes/components/btw-panel";
import { initTheme } from "@f5-sales-demo/xcsh/modes/theme/theme";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Minimal TUI stub — BtwPanelComponent only calls requestRender() on state changes.
const stubTui = { requestRender() {} } as unknown as TUI;

describe("BtwPanelComponent", () => {
	it("running state with empty answer renders 'Waiting for response…' without a pending glyph", async () => {
		await initTheme();
		const panel = new BtwPanelComponent({ question: "What is it?", tui: stubTui });
		const rendered = panel.render(80).map(stripAnsi).join("\n");
		expect(rendered).toContain("Waiting for response…");
		expect(rendered).not.toContain("⏳");
		expect(rendered).not.toContain("⌛");
	});
});
