import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import type { ToolSession } from "../../src/tools";
import { ClassifyTool } from "../../src/tools/classify";

describe("classifier assistant tool", () => {
	it("uses explicit provider/model selection and returns typed answers", async () => {
		using _hook = hookFetch(async () => Response.json({ answers: { synthetic: { type: "noul", noul: 0.9 } } }));

		const tool = new ClassifyTool({
			modelRegistry: { getApiKeyForProvider: async () => "synthetic" },
		} as unknown as ToolSession);
		const result = await tool.execute("synthetic-call", {
			provider: "typesafe",
			model: "jev-latest",
			state: { synthetic: true },
			questions: {
				synthetic: { type: "bool", instructions: "Synthetic?", criteria: { true: "yes", false: "no" } },
			},
		});
		expect(result.details.answers.synthetic).toEqual({ type: "bool", probability: 0.9 });
		expect(result.content[0]?.text).toContain("0.9");
	});
	it("fails before transport for missing models and rejects malformed provider output", async () => {
		const tool = new ClassifyTool({} as ToolSession);
		await expect(
			tool.execute("missing", { provider: "synthetic", model: "missing", state: {}, questions: {} }),
		).rejects.toThrow("not found");
	});
});
