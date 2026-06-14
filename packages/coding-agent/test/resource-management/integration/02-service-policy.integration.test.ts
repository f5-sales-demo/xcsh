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

describe.skipIf(!LIVE)("Integration: service_policy", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const resolved = resolveKind("service_policy");

	const policyName = uniqueName("sp");

	afterAll(() => cleanup.cleanupAll());

	it("1. create with allow_all spec — status=created", async () => {
		const manifest = buildManifest("service_policy", policyName, { allow_all_requests: {} });
		cleanup.track("service_policy", policyName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. apply with description change — status=updated", async () => {
		const manifest = buildManifest(
			"service_policy",
			policyName,
			{ allow_all_requests: {} },
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

	it("3. apply idempotent — status=unchanged", async () => {
		const manifest = buildManifest(
			"service_policy",
			policyName,
			{ allow_all_requests: {} },
			{
				description: "updated by integration test",
			},
		);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUnchanged(result);
	}, 30_000);

	it("4. get individual — metadata.name matches", async () => {
		const result = await client.get(resolved, policyName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const meta = result.resource?.metadata as Record<string, unknown> | undefined;
		expect(meta?.name).toBe(policyName);
	}, 30_000);

	it("5. list — test resource in items", async () => {
		const result = await client.get(resolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const names = result.items?.map(item => item.name) ?? [];
		expect(names).toContain(policyName);
	}, 30_000);

	it("6. diff on changed description — diff has entries", async () => {
		const manifest = buildManifest(
			"service_policy",
			policyName,
			{ allow_all_requests: {} },
			{
				description: "diff detection value",
			},
		);
		const result = await client.diff(manifest, resolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
		expect(result.diff!.changed.length).toBeGreaterThan(0);
	}, 30_000);

	it("7. delete — status=deleted", async () => {
		const result = await client.delete("service_policy", policyName, resolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("8. get after delete — not_found", async () => {
		const result = await client.get(resolved, policyName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);
});
