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

describe.skipIf(!LIVE)("Integration: idempotency", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);

	const resolvedAfw = resolveKind("app_firewall");
	const resolvedOp = resolveKind("origin_pool");

	afterAll(() => cleanup.cleanupAll());

	it("1. app_firewall: apply same manifest 3x → created, unchanged, unchanged", async () => {
		const name = uniqueName("idem-afw");
		const manifest = buildManifest("app_firewall", name, {});
		cleanup.track("app_firewall", name);

		const r1 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(r1);

		const r2 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertUnchanged(r2);

		const r3 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertUnchanged(r3);
	}, 30_000);

	it("2. origin_pool: apply same manifest 3x → created, unchanged, unchanged", async () => {
		const name = uniqueName("idem-op");
		const spec = {
			origin_servers: [{ public_ip: { ip: "10.0.1.20" } }],
			port: 80,
		};
		const manifest = buildManifest("origin_pool", name, spec);
		cleanup.track("origin_pool", name);

		const r1 = await client.apply(manifest, resolvedOp, NAMESPACE);
		assertCreated(r1);

		const r2 = await client.apply(manifest, resolvedOp, NAMESPACE);
		assertUnchanged(r2);

		const r3 = await client.apply(manifest, resolvedOp, NAMESPACE);
		assertUnchanged(r3);
	}, 30_000);

	it("3. server-added defaults: empty spec stays unchanged on re-apply", async () => {
		const name = uniqueName("idem-defaults");
		const manifest = buildManifest("app_firewall", name, {});
		cleanup.track("app_firewall", name);

		const createResult = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(createResult);

		// Server adds fields like monitoring, default_detection_settings, etc.
		// filterToManifestKeys should ignore them — re-apply with same empty spec
		const reapplyResult = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertUnchanged(reapplyResult);
	}, 30_000);

	it("4. labels: apply with labels, re-apply same labels → unchanged", async () => {
		const name = uniqueName("idem-labels");
		const manifest = buildManifest(
			"app_firewall",
			name,
			{},
			{
				labels: { env: "test" },
			},
		);
		cleanup.track("app_firewall", name);

		const r1 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(r1);

		const r2 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertUnchanged(r2);
	}, 30_000);

	it("5. description: apply with description, re-apply same → unchanged", async () => {
		const name = uniqueName("idem-desc");
		const manifest = buildManifest(
			"app_firewall",
			name,
			{},
			{
				description: "idempotency test description",
			},
		);
		cleanup.track("app_firewall", name);

		const r1 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(r1);

		const r2 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertUnchanged(r2);
	}, 30_000);

	it("6. delete then re-apply (recreate cycle) → created", async () => {
		const name = uniqueName("idem-recreate");
		const manifest = buildManifest("app_firewall", name, {});
		cleanup.track("app_firewall", name);

		// Create
		const r1 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(r1);

		// Delete
		const del = await client.delete("app_firewall", name, resolvedAfw, NAMESPACE);
		assertDeleted(del);

		// Re-apply — should create again, not error or unchanged
		const r2 = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(r2);
	}, 30_000);

	it("7. rapid sequential applies: create then apply 5x → all unchanged", async () => {
		const name = uniqueName("idem-rapid");
		const manifest = buildManifest("app_firewall", name, {});
		cleanup.track("app_firewall", name);

		const create = await client.apply(manifest, resolvedAfw, NAMESPACE);
		assertCreated(create);

		for (let i = 0; i < 5; i++) {
			const result = await client.apply(manifest, resolvedAfw, NAMESPACE);
			assertUnchanged(result);
		}
	}, 30_000);

	it("8. apply description change then revert → updated, then updated back", async () => {
		const name = uniqueName("idem-revert");
		const originalManifest = buildManifest(
			"app_firewall",
			name,
			{},
			{
				description: "original description",
			},
		);
		cleanup.track("app_firewall", name);

		const r1 = await client.apply(originalManifest, resolvedAfw, NAMESPACE);
		assertCreated(r1);

		// Change description
		const changedManifest = buildManifest(
			"app_firewall",
			name,
			{},
			{
				description: "changed description",
			},
		);
		const r2 = await client.apply(changedManifest, resolvedAfw, NAMESPACE);
		assertUpdated(r2);

		// Revert to original description
		const r3 = await client.apply(originalManifest, resolvedAfw, NAMESPACE);
		assertUpdated(r3);
		if (r3.status === "updated") {
			const descChange = r3.diff.changed.find(entry => entry.path.includes("description"));
			expect(descChange).toBeDefined();
		}
	}, 30_000);
});
