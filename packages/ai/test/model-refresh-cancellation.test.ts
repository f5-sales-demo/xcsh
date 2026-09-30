import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelCache } from "../src/model-cache";
import { createModelManager } from "../src/model-manager";
import { getBundledModel } from "../src/models";

describe("model refresh cancellation", () => {
	it("does not publish late results after cancellation", async () => {
		const controller = new AbortController();
		const pending = Promise.withResolvers<any>();
		const cacheDbPath = join(mkdtempSync(join(tmpdir(), "catalog-cancel-")), "models.db");
		const manager = createModelManager({
			providerId: "openai",
			cacheDbPath,
			fetchDynamicModels: () => pending.promise,
		});
		const refresh = manager.refresh("online", { signal: controller.signal });
		controller.abort();
		pending.resolve([getBundledModel("openai", "gpt-6.1-sol")]);
		await expect(refresh).rejects.toThrow("abort");
		expect(readModelCache("openai", 10000, Date.now, cacheDbPath)).toBeNull();
	});
	it("fences superseded concurrent refresh results", async () => {
		const pending = Promise.withResolvers<any>();
		let calls = 0;
		const cacheDbPath = join(mkdtempSync(join(tmpdir(), "catalog-fence-")), "models.db");
		const manager = createModelManager({
			providerId: "openai",
			cacheDbPath,
			fetchDynamicModels: () =>
				++calls === 1
					? pending.promise
					: Promise.resolve([{ ...getBundledModel("openai", "gpt-6.1-sol"), description: "Latest catalog" }]),
		});
		const stale = manager.refresh("online");
		await manager.refresh("online");
		pending.resolve([{ ...getBundledModel("openai", "gpt-6.1-sol"), description: "Old catalog" }]);
		await expect(stale).rejects.toThrow("superseded");
		expect(
			readModelCache("openai", 10000, Date.now, cacheDbPath)?.models.find(model => model.id === "gpt-6.1-sol")
				?.description,
		).toBe("Latest catalog");
	});
});
