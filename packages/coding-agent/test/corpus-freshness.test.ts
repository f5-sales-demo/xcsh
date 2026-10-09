import { describe, expect, it } from "bun:test";
import { assertFreshCorpusSources, resolveCorpusSources } from "../scripts/corpus-sources";

const asset = { name: "manifest.json", size: 42, digest: `sha256:${"a".repeat(64)}` };
const release = (tag_name: string, overrides = {}) => ({
	tag_name,
	draft: false,
	prerelease: false,
	immutable: true,
	assets: [asset],
	...overrides,
});
function discovery(inventories: Record<string, unknown[]>) {
	return async (url: string) => {
		if (url.includes("/commits/")) return Response.json({ sha: "c".repeat(40) });
		const repo = url.split("/repos/")[1]!.split("/releases")[0]!;
		if (!(repo in inventories)) return new Response("unavailable", { status: 503 });
		return Response.json(inventories[repo]);
	};
}
const inventories = {
	"f5-sales-demo/html-to-markdown": [
		release("v99.0.0"),
		release("content-20261009T041100Z", { immutable: false }),
		release("content-20261010T041100Z", { draft: true }),
	],
	"f5-sales-demo/terraform-provider-xcsh": [
		release("v15.9.0"),
		release("documentation-v15.9.0"),
		release("v15.10.0"),
		release("documentation-v15.10.0"),
		release("v16.0.0", { prerelease: true }),
	],
	"f5-sales-demo/api-specs-enriched": [release("v12.0.3"), release("v12.0.4"), release("v13.0.0-rc.1")],
};
describe("build-time corpus freshness", () => {
	it("selects independent release families with numeric stable versions", async () => {
		const result = await resolveCorpusSources(discovery(inventories));
		expect(result.general.tag).toBe("content-20261009T041100Z");
		expect(result.terraform.tag).toBe("documentation-v15.10.0");
		expect(result.api.tag).toBe("v12.0.4");
		expect(result.general.acceptance).toBe("verified-bytes-mutable");
	});
	it("fails closed when discovery is unavailable", async () => {
		await expect(resolveCorpusSources(discovery({}))).rejects.toThrow("discovery");
	});
	it("rejects the highest provider without matching published documentation", async () => {
		await expect(
			resolveCorpusSources(
				discovery({
					...inventories,
					"f5-sales-demo/terraform-provider-xcsh": [release("v15.11.0"), release("documentation-v15.10.0")],
				}),
			),
		).rejects.toThrow("matching documentation");
	});
	it("rejects stale records and mutable digest advancement before publication", async () => {
		const result = await resolveCorpusSources(discovery(inventories));
		expect(() => assertFreshCorpusSources({ ...result, api: { ...result.api, tag: "v12.0.0" } }, result)).toThrow(
			"stale",
		);
		expect(() =>
			assertFreshCorpusSources(
				{
					...result,
					general: { ...result.general, assets: { "manifest.json": { sha256: "b".repeat(64), size_bytes: 42 } } },
				},
				result,
			),
		).toThrow("stale");
	});
	it("rejects duplicate asset identities", async () => {
		await expect(
			resolveCorpusSources(
				discovery({
					...inventories,
					"f5-sales-demo/api-specs-enriched": [release("v12.0.4", { assets: [asset, asset] })],
				}),
			),
		).rejects.toThrow("asset");
	});
});
