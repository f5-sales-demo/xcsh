import { afterAll, describe, expect, it } from "bun:test";
import {
	assertCreated,
	assertDeleted,
	assertDryRun,
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

describe.skipIf(!LIVE)("Integration: healthcheck", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const resolved = resolveKind("healthcheck");

	const httpName = uniqueName("hc-http");
	const tcpName = uniqueName("hc-tcp");

	const httpSpec = {
		http_health_check: { path: "/healthz" },
		interval: 10,
		timeout: 3,
		healthy_threshold: 3,
		unhealthy_threshold: 3,
	};

	const tcpSpec = {
		tcp_health_check: {},
		interval: 10,
		timeout: 3,
		healthy_threshold: 3,
		unhealthy_threshold: 3,
	};

	afterAll(() => cleanup.cleanupAll());

	it("1. create HTTP healthcheck", async () => {
		const manifest = buildManifest("healthcheck", httpName, httpSpec);
		cleanup.track("healthcheck", httpName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. create TCP healthcheck", async () => {
		const manifest = buildManifest("healthcheck", tcpName, tcpSpec);
		cleanup.track("healthcheck", tcpName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("3. get individual HTTP healthcheck — metadata.name matches", async () => {
		const result = await client.get(resolved, httpName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const meta = result.resource?.metadata as Record<string, unknown> | undefined;
		expect(meta?.name).toBe(httpName);
	}, 30_000);

	it("4. list healthchecks — both test resources appear in items", async () => {
		const result = await client.get(resolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const names = result.items?.map(item => item.name) ?? [];
		expect(names).toContain(httpName);
		expect(names).toContain(tcpName);
	}, 30_000);

	it("5. apply update interval 10 -> 30 — status=updated, diff shows interval", async () => {
		const updatedSpec = { ...httpSpec, interval: 30 };
		const manifest = buildManifest("healthcheck", httpName, updatedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUpdated(result);
		if (result.status === "updated") {
			const intervalChange = result.diff.changed.find(entry => entry.path.includes("interval"));
			expect(intervalChange).toBeDefined();
		}
	}, 30_000);

	it("6. apply idempotent — status=unchanged", async () => {
		const updatedSpec = { ...httpSpec, interval: 30 };
		const manifest = buildManifest("healthcheck", httpName, updatedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUnchanged(result);
	}, 30_000);

	it("7. diff detection (change timeout) — diff.changed has entries", async () => {
		const changedSpec = { ...httpSpec, interval: 30, timeout: 10 };
		const manifest = buildManifest("healthcheck", httpName, changedSpec);
		const result = await client.diff(manifest, resolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
		expect(result.diff!.changed.length).toBeGreaterThan(0);
	}, 30_000);

	it("8. dry-run client — status=dry-run", async () => {
		const changedSpec = { ...httpSpec, interval: 30, timeout: 10 };
		const manifest = buildManifest("healthcheck", httpName, changedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE, "client");
		assertDryRun(result, "update");
	}, 30_000);

	it("9. update threshold values (healthy_threshold 3 -> 5) — status=updated", async () => {
		const updatedSpec = { ...httpSpec, interval: 30, healthy_threshold: 5 };
		const manifest = buildManifest("healthcheck", httpName, updatedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUpdated(result);
		if (result.status === "updated") {
			const thresholdChange = result.diff.changed.find(entry => entry.path.includes("healthy_threshold"));
			expect(thresholdChange).toBeDefined();
		}
	}, 30_000);

	it("10. delete HTTP healthcheck — status=deleted", async () => {
		const result = await client.delete("healthcheck", httpName, resolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("11. delete TCP healthcheck — status=deleted", async () => {
		const result = await client.delete("healthcheck", tcpName, resolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("12. get after delete — error.kind=not_found", async () => {
		const result = await client.get(resolved, httpName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	it("13. get TCP after delete — error.kind=not_found", async () => {
		const result = await client.get(resolved, tcpName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	it("14. create HTTP healthcheck for dry-run create test", async () => {
		const newName = uniqueName("hc-dryrun");
		const manifest = buildManifest("healthcheck", newName, httpSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE, "client");
		assertDryRun(result, "create");
		// Resource should not exist since it was a dry-run
		const getResult = await client.get(resolved, newName, NAMESPACE);
		expect(getResult.error).toBeDefined();
		expect(getResult.error?.kind).toBe("not_found");
	}, 30_000);

	it("15. create and verify TCP healthcheck spec fields", async () => {
		const verifyName = uniqueName("hc-verify");
		const manifest = buildManifest("healthcheck", verifyName, tcpSpec);
		cleanup.track("healthcheck", verifyName);
		const createResult = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(createResult);

		const getResult = await client.get(resolved, verifyName, NAMESPACE);
		expect(getResult.error).toBeUndefined();
		expect(getResult.resource).toBeDefined();
		const spec = getResult.resource?.spec as Record<string, unknown> | undefined;
		expect(spec?.tcp_health_check).toBeDefined();
	}, 30_000);
});
