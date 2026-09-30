import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModels } from "../src/models";
import { xaiModelManagerOptions, xiaomiModelManagerOptions } from "../src/provider-models/openai-compat";

describe("pinned upstream provider transports", () => {
	it("uses Responses for xAI while retaining its provider identity", async () => {
		using _hook = hookFetch(async () => Response.json({ data: [{ id: "grok-synthetic" }] }));
		const models = await xaiModelManagerOptions({ apiKey: "synthetic" }).fetchDynamicModels?.();
		expect(models?.[0]).toMatchObject({ provider: "xai", api: "openai-responses" });
		for (const model of getBundledModels("xai")) expect(model.api).toBe("openai-responses");
	});
	it("uses Xiaomi's completion route for catalog discovery", async () => {
		let url = "";
		using _hook = hookFetch(async input => {
			url = String(input);
			return Response.json({ data: [{ id: "mimo-synthetic" }] });
		});
		const models = await xiaomiModelManagerOptions({ apiKey: "synthetic" }).fetchDynamicModels?.();
		expect(url).toBe("https://api.xiaomimimo.com/v1/models");
		expect(models?.[0]).toMatchObject({ provider: "xiaomi", api: "openai-completions" });
		for (const model of getBundledModels("xiaomi")) expect(model.api).toBe("openai-completions");
	});
});
