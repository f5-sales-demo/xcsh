import { afterAll, describe, expect, it } from "bun:test";
import { validateManifest } from "@f5-sales-demo/pi-resource-management";
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
	resolver,
	uniqueName,
} from "./_helpers";

describe.skipIf(!LIVE)("Integration: origin_pool", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const resolved = resolveKind("origin_pool");

	const ipPoolName = uniqueName("op-ip");
	const dnsPoolName = uniqueName("op-dns");

	const ipPoolSpec = {
		origin_servers: [{ public_ip: { ip: "10.0.1.20" } }],
		port: 80,
	};

	const dnsPoolSpec = {
		origin_servers: [{ public_name: { dns_name: "backend.example.com" } }],
		port: 443,
	};

	afterAll(() => cleanup.cleanupAll());

	it("1. create with IP origin server", async () => {
		const manifest = buildManifest("origin_pool", ipPoolName, ipPoolSpec);
		cleanup.track("origin_pool", ipPoolName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. create with DNS origin server", async () => {
		const manifest = buildManifest("origin_pool", dnsPoolName, dnsPoolSpec);
		cleanup.track("origin_pool", dnsPoolName);
		const result = await client.create(manifest, resolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("3. get individual — spec.origin_servers and spec.port match", async () => {
		const result = await client.get(resolved, ipPoolName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const spec = result.resource?.spec as Record<string, unknown> | undefined;
		expect(spec?.origin_servers).toBeDefined();
		expect(Array.isArray(spec?.origin_servers)).toBe(true);
		expect(spec?.port).toBeDefined();
	}, 30_000);

	it("4. get list — both test pools in items", async () => {
		const result = await client.get(resolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const names = result.items?.map(item => item.name) ?? [];
		expect(names).toContain(ipPoolName);
		expect(names).toContain(dnsPoolName);
	}, 30_000);

	it("5. apply change port 80 -> 8080 — status=updated", async () => {
		const updatedSpec = { ...ipPoolSpec, port: 8080 };
		const manifest = buildManifest("origin_pool", ipPoolName, updatedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUpdated(result);
		if (result.status === "updated") {
			const portChange = result.diff.changed.find(entry => entry.path.includes("port"));
			expect(portChange).toBeDefined();
		}
	}, 30_000);

	it("6. apply idempotent — status=unchanged", async () => {
		const updatedSpec = { ...ipPoolSpec, port: 8080 };
		const manifest = buildManifest("origin_pool", ipPoolName, updatedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUnchanged(result);
	}, 30_000);

	it("7. diff: port change detected — diff has entries", async () => {
		const changedSpec = { ...ipPoolSpec, port: 9090 };
		const manifest = buildManifest("origin_pool", ipPoolName, changedSpec);
		const result = await client.diff(manifest, resolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
		expect(result.diff!.changed.length).toBeGreaterThan(0);
	}, 30_000);

	it("8. dry-run on modified spec — status=dry-run(update)", async () => {
		const changedSpec = { ...ipPoolSpec, port: 9999 };
		const manifest = buildManifest("origin_pool", ipPoolName, changedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE, "client");
		assertDryRun(result, "update");
	}, 30_000);

	it("9. apply add second origin server to array — status=updated", async () => {
		const expandedSpec = {
			...ipPoolSpec,
			port: 8080,
			origin_servers: [{ public_ip: { ip: "10.0.1.20" } }, { public_ip: { ip: "10.0.1.21" } }],
		};
		const manifest = buildManifest("origin_pool", ipPoolName, expandedSpec);
		const result = await client.apply(manifest, resolved, NAMESPACE);
		assertUpdated(result);
	}, 30_000);

	it("10. delete IP pool — status=deleted", async () => {
		const result = await client.delete("origin_pool", ipPoolName, resolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("11. delete DNS pool — status=deleted", async () => {
		const result = await client.delete("origin_pool", dnsPoolName, resolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("12. get after delete — error.kind=not_found", async () => {
		const result = await client.get(resolved, ipPoolName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	it("13. validation: missing origin_servers — MISSING_FIELD error", () => {
		const manifest = buildManifest("origin_pool", "val-no-servers", { port: 80 });
		const { result } = validateManifest(manifest, resolver, NAMESPACE);
		expect(result.valid).toBe(false);
		const fieldError = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("origin_servers"));
		expect(fieldError).toBeDefined();
	});

	it("14. validation: missing port — MISSING_FIELD error", () => {
		const manifest = buildManifest("origin_pool", "val-no-port", {
			origin_servers: [{ public_ip: { ip: "10.0.1.20" } }],
		});
		const { result } = validateManifest(manifest, resolver, NAMESPACE);
		expect(result.valid).toBe(false);
		const fieldError = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("port"));
		expect(fieldError).toBeDefined();
	});
});
