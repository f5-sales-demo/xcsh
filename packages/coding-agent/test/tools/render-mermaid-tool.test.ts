import { describe, expect, it } from "bun:test";
import { RenderMermaidTool } from "@f5-sales-demo/xcsh/tools/render-mermaid";

const tool = new RenderMermaidTool({} as never);
const textOf = (r: { content: Array<{ type: string; text?: string }> }) =>
	r.content.find(c => c.type === "text")?.text ?? "";

describe("RenderMermaidTool.execute robustness", () => {
	it("renders a valid diagram", async () => {
		const r = await tool.execute("t", { mermaid: "graph LR\nA[Client] --> B[Origin]" });
		expect(textOf(r)).toContain("Client");
	});

	it("throws a clear (catchable) error for un-renderable input", async () => {
		expect(tool.execute("t", { mermaid: "this is definitely not a mermaid diagram %%%%" })).rejects.toThrow(
			/render|simpl|unsupported/i,
		);
	});

	it("rejects an oversized diagram fast instead of hanging the pathfinder", async () => {
		const huge = `graph TD\n${Array.from({ length: 2000 }, (_, i) => `N${i} --> N${i + 1}`).join("\n")}`;
		const start = Bun.nanoseconds();
		await expect(tool.execute("t", { mermaid: huge })).rejects.toThrow(/large/i);
		// The guard must short-circuit — nowhere near the ~23s OOM hang.
		expect((Bun.nanoseconds() - start) / 1e6).toBeLessThan(1000);
	});
});
