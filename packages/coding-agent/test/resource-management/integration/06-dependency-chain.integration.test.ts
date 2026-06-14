import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	assertCreated,
	assertDeleted,
	assertUpdated,
	buildManifest,
	CleanupRegistry,
	getTenant,
	LIVE,
	makeClient,
	NAMESPACE,
	resolveKind,
	uniqueName,
} from "./_helpers";

describe.skipIf(!LIVE)("Integration: dependency-chain lifecycle", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);

	let tenant: string;

	beforeAll(async () => {
		tenant = await getTenant();
	});

	const hcName = uniqueName("chain-hc");
	const afwName = uniqueName("chain-afw");
	const opName = uniqueName("chain-op");
	const lbName = uniqueName("chain-lb");

	const resolvedHc = resolveKind("healthcheck");
	const resolvedAfw = resolveKind("app_firewall");
	const resolvedOp = resolveKind("origin_pool");
	const resolvedLb = resolveKind("http_loadbalancer");

	afterAll(() => cleanup.cleanupAll());

	// ---------- bottom-up creation ----------

	it("1. create healthcheck (HTTP, /health)", async () => {
		const manifest = buildManifest("healthcheck", hcName, {
			http_health_check: { path: "/health" },
			interval: 15,
			timeout: 5,
			healthy_threshold: 2,
			unhealthy_threshold: 2,
		});
		cleanup.track("healthcheck", hcName);
		const result = await client.create(manifest, resolvedHc, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. create app_firewall (empty spec)", async () => {
		const manifest = buildManifest("app_firewall", afwName, {});
		cleanup.track("app_firewall", afwName);
		const result = await client.create(manifest, resolvedAfw, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("3. create origin_pool referencing healthcheck", async () => {
		const manifest = buildManifest("origin_pool", opName, {
			origin_servers: [{ public_ip: { ip: "10.0.0.1" } }],
			port: 80,
			healthcheck: [
				{
					tenant,
					namespace: NAMESPACE,
					name: hcName,
				},
			],
		});
		cleanup.track("origin_pool", opName);
		const result = await client.create(manifest, resolvedOp, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("4. create http_loadbalancer referencing origin_pool", async () => {
		const manifest = buildManifest("http_loadbalancer", lbName, {
			domains: ["test.example.com"],
			http: { dns_volterra_managed: false, port: 80 },
			default_route_pools: [
				{
					pool: {
						tenant,
						namespace: NAMESPACE,
						name: opName,
					},
					weight: 1,
				},
			],
		});
		cleanup.track("http_loadbalancer", lbName);
		const result = await client.create(manifest, resolvedLb, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	// ---------- update ----------

	it("5. update http_loadbalancer domain — status=updated", async () => {
		const manifest = buildManifest("http_loadbalancer", lbName, {
			domains: ["test2.example.com"],
			http: { dns_volterra_managed: false, port: 80 },
			default_route_pools: [
				{
					pool: {
						tenant,
						namespace: NAMESPACE,
						name: opName,
					},
					weight: 1,
				},
			],
		});
		const result = await client.apply(manifest, resolvedLb, NAMESPACE);
		assertUpdated(result);
	}, 30_000);

	// ---------- get (verify update) ----------

	it("6. get http_loadbalancer — domain is test2.example.com", async () => {
		const result = await client.get(resolvedLb, lbName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const spec = result.resource?.spec as Record<string, unknown> | undefined;
		const domains = spec?.domains as string[] | undefined;
		expect(domains).toContain("test2.example.com");
	}, 30_000);

	// ---------- diff ----------

	it("7. diff http_loadbalancer with domain test3 — shows change", async () => {
		const manifest = buildManifest("http_loadbalancer", lbName, {
			domains: ["test3.example.com"],
			http: { dns_volterra_managed: false, port: 80 },
			default_route_pools: [
				{
					pool: {
						tenant,
						namespace: NAMESPACE,
						name: opName,
					},
					weight: 1,
				},
			],
		});
		const result = await client.diff(manifest, resolvedLb, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
	}, 30_000);

	// ---------- top-down deletion ----------

	it("8. delete http_loadbalancer — status=deleted", async () => {
		const result = await client.delete("http_loadbalancer", lbName, resolvedLb, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("9. delete origin_pool — status=deleted", async () => {
		const result = await client.delete("origin_pool", opName, resolvedOp, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("10. delete healthcheck and app_firewall — status=deleted", async () => {
		const hcResult = await client.delete("healthcheck", hcName, resolvedHc, NAMESPACE);
		assertDeleted(hcResult);

		const afwResult = await client.delete("app_firewall", afwName, resolvedAfw, NAMESPACE);
		assertDeleted(afwResult);
	}, 30_000);
});
