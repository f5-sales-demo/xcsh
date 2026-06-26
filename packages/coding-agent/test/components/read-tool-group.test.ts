import { describe, expect, it } from "bun:test";
import { ReadToolGroupComponent } from "@f5-sales-demo/xcsh/modes/components/read-tool-group";
import { initTheme } from "@f5-sales-demo/xcsh/modes/theme/theme";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("ReadToolGroupComponent — no inline status glyphs (PR #207)", () => {
	it("single-entry success render emits no ✓/✔/✗/✘/⚠/⏳", async () => {
		await initTheme();
		const group = new ReadToolGroupComponent();
		group.updateArgs({ path: "a.ts" }, "call-1");
		group.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false, "call-1");

		const rendered = group.render(80).map(stripAnsi).join("\n");
		expect(rendered).toContain("Read");
		expect(rendered).toContain("a.ts");
		expect(rendered).not.toMatch(/[✓✔✗✘⚠]/u);
		expect(rendered).not.toContain("⏳");
	});

	it("single-entry pending render emits no inline glyph", async () => {
		await initTheme();
		const group = new ReadToolGroupComponent();
		group.updateArgs({ path: "a.ts" }, "call-1");
		// no updateResult → still pending

		const rendered = group.render(80).map(stripAnsi).join("\n");
		expect(rendered).not.toMatch(/[✓✔✗✘⚠]/u);
		expect(rendered).not.toContain("⏳");
	});

	it("single-entry error render emits no inline ✘", async () => {
		await initTheme();
		const group = new ReadToolGroupComponent();
		group.updateArgs({ path: "missing.ts" }, "call-1");
		group.updateResult({ content: [{ type: "text", text: "not found" }], isError: true }, false, "call-1");

		const rendered = group.render(80).map(stripAnsi).join("\n");
		expect(rendered).not.toMatch(/[✓✔✗✘⚠]/u);
	});

	it("multi-entry render emits no inline glyph per sub-row", async () => {
		await initTheme();
		const group = new ReadToolGroupComponent();
		group.updateArgs({ path: "a.ts" }, "call-1");
		group.updateArgs({ path: "b.ts" }, "call-2");
		group.updateArgs({ path: "c.ts" }, "call-3");
		group.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false, "call-1");
		group.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false, "call-2");
		// call-3 still pending

		const rendered = group.render(80).map(stripAnsi).join("\n");
		expect(rendered).toContain("Read");
		expect(rendered).toContain("a.ts");
		expect(rendered).toContain("b.ts");
		expect(rendered).toContain("c.ts");
		expect(rendered).not.toMatch(/[✓✔✗✘⚠]/u);
		expect(rendered).not.toContain("⏳");
	});
});
