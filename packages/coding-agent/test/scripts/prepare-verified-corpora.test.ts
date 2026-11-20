import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareVerifiedCorpora } from "../../scripts/prepare-verified-corpora";

describe("verified current corpus preparation", () => {
	test("refreshes source identities before consumers and verifies new citations last", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "corpus-order-"));
		const events: string[] = [];
		try {
			await prepareVerifiedCorpora({
				refresh: async () => {
					await writeFile(path.join(root, "source"), "new-release");
					events.push("refresh");
				},
				generate: async name => {
					expect(await readFile(path.join(root, "source"), "utf8")).toBe("new-release");
					events.push(name);
				},
				citations: async () => {
					await writeFile(path.join(root, "citations"), "new-release");
					events.push("citations");
				},
				verify: async () => {
					expect(await readFile(path.join(root, "citations"), "utf8")).toBe("new-release");
					events.push("verify");
				},
			});
			expect(events[0]).toBe("refresh");
			expect(events.indexOf("generate-api-spec-index")).toBeLessThan(
				events.indexOf("generate-api-catalog-qmd-index"),
			);
			expect(events.indexOf("generate-documentation-index")).toBeLessThan(events.indexOf("citations"));
			expect(events.indexOf("generate-terraform-documentation-index")).toBeLessThan(events.indexOf("citations"));
			expect(events.slice(-2)).toEqual(["citations", "verify"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("failed source integrity prevents every generator and verifier", async () => {
		const events: string[] = [];
		await expect(
			prepareVerifiedCorpora({
				refresh: async () => {
					throw new Error("receipt bytes mismatch");
				},
				generate: async name => {
					events.push(name);
				},
				citations: async () => {
					events.push("citations");
				},
				verify: async () => {
					events.push("verify");
				},
			}),
		).rejects.toThrow("receipt bytes mismatch");
		expect(events).toEqual([]);
	});

	test("generator failure stops citation creation and publication verification", async () => {
		const events: string[] = [];
		await expect(
			prepareVerifiedCorpora({
				refresh: async () => {},
				generate: async name => {
					events.push(name);
					if (name === "generate-documentation-index") throw new Error("corrupt archive");
				},
				citations: async () => {
					events.push("citations");
				},
				verify: async () => {
					events.push("verify");
				},
			}),
		).rejects.toThrow("corrupt archive");
		expect(events).not.toContain("citations");
		expect(events).not.toContain("verify");
	});

	test("stale regenerated citations fail the final guard", async () => {
		await expect(
			prepareVerifiedCorpora({
				refresh: async () => {},
				generate: async () => {},
				citations: async () => {},
				verify: async () => {
					throw new Error("stale public citation source");
				},
			}),
		).rejects.toThrow("stale public citation source");
	});
});
