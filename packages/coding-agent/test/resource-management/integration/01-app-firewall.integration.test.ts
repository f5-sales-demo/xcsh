import { afterAll, describe, expect, it } from "bun:test";
import {
	assertCreated,
	assertDeleted,
	assertUnchanged,
	assertUpdated,
	buildManifest,
	CleanupRegistry,
	LIVE,
	makeClient,
	NAMESPACE,
	resolveKind,
	uniqueName,
} from "./_helpers";

describe.skipIf(!LIVE)("Integration: app_firewall", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const resolved = resolveKind("app_firewall");

	const baseName = uniqueName("afw");
	const disabledName = uniqueName("afw-disabled");

	afterAll(() => cleanup.cleanupAll());

	it("1. create with empty spec — status=created", async () => {
		const manifest = buildManifest("app_firewall", baseName, {});
		cleanup.track("app_firewall", baseName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. get shows server-added defaults — spec has keys like monitoring, default_detection_settings", async () => {
		const result = await client.get(resolved, baseName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const spec = result.resource?.spec as Record<string, unknown> | undefined;
		expect(spec).toBeDefined();
		// Server adds default fields to app_firewall spec
		const specKeys = Object.keys(spec ?? {});
		expect(specKeys.length).toBeGreaterThan(0);
	}, 30_000);

	it("3. apply idempotent — status=unchanged (filterToManifestKeys handles server defaults)", async () => {
		const manifest = buildManifest("app_firewall", baseName, {});
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUnchanged(result);
	}, 30_000);

	it("4. apply with description change — status=updated", async () => {
		const manifest = buildManifest(
			"app_firewall",
			baseName,
			{},
			{
				description: "updated by integration test",
			},
		);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUpdated(result);
		if (result.status === "updated") {
			const descChange = result.diff.changed.find(entry => entry.path.includes("description"));
			expect(descChange).toBeDefined();
		}
	}, 30_000);

	it("5. diff between current and changed description — diff has entries", async () => {
		const manifest = buildManifest(
			"app_firewall",
			baseName,
			{},
			{
				description: "diff detection value",
			},
		);
		const result = await client.diff(manifest, resolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
	}, 30_000);

	it("6. create duplicate (409 handling) — second create falls back to update", async () => {
		const manifest = buildManifest("app_firewall", baseName, {});
		const result = await client.create(manifest, resolved, NAMESPACE);
		// 409 triggers fallback to update
		expect(result.status === "updated" || result.status === "created").toBe(true);
	}, 30_000);

	it("7. create with disable=true — status=created", async () => {
		const manifest = buildManifest(
			"app_firewall",
			disabledName,
			{},
			{
				disable: true,
			},
		);
		cleanup.track("app_firewall", disabledName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);

		// Verify disable flag was set
		const getResult = await client.get(resolved, disabledName, NAMESPACE);
		expect(getResult.error).toBeUndefined();
		const meta = getResult.resource?.metadata as Record<string, unknown> | undefined;
		expect(meta?.disable).toBe(true);
	}, 30_000);

	it("8. get list — test resources appear in items", async () => {
		const result = await client.get(resolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const names = result.items?.map(item => item.name) ?? [];
		expect(names).toContain(baseName);
		expect(names).toContain(disabledName);
	}, 30_000);

	it("9. delete resources — status=deleted", async () => {
		const result1 = await client.delete("app_firewall", baseName, resolved, NAMESPACE);
		assertDeleted(result1);

		const result2 = await client.delete("app_firewall", disabledName, resolved, NAMESPACE);
		assertDeleted(result2);
	}, 30_000);

	it("10. get after delete — error.kind=not_found", async () => {
		const result = await client.get(resolved, baseName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");

		const result2 = await client.get(resolved, disabledName, NAMESPACE);
		expect(result2.error).toBeDefined();
		expect(result2.error?.kind).toBe("not_found");
	}, 30_000);
});
