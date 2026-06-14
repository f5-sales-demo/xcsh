import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { validateManifest } from "@f5xc-salesdemos/pi-resource-management";
import {
	assertCreated,
	assertDeleted,
	assertDryRun,
	assertUnchanged,
	assertUpdated,
	buildManifest,
	CleanupRegistry,
	getTenant,
	LIVE,
	makeClient,
	NAMESPACE,
	resolveKind,
	resolver,
	uniqueName,
} from "./_helpers";

describe.skipIf(!LIVE)("Integration: http_loadbalancer", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const lbResolved = resolveKind("http_loadbalancer");
	const poolResolved = resolveKind("origin_pool");
	let tenant: string;

	beforeAll(async () => {
		tenant = await getTenant();
	});

	// Supporting origin pools created in setup, deleted in cleanup
	const helperPoolName = uniqueName("hlb-pool");
	const helperPool2Name = uniqueName("hlb-pool2");
	const lbName = uniqueName("hlb");

	const helperPoolSpec = {
		origin_servers: [{ public_ip: { ip: "10.0.0.1" } }],
		port: 80,
	};

	function makePoolRef(poolName: string): Record<string, unknown> {
		return {
			pool: { name: poolName, namespace: NAMESPACE, tenant },
			weight: 1,
		};
	}

	function makeLbSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			domains: ["test.example.com"],
			http: { dns_volterra_managed: false, port: 80 },
			default_route_pools: [makePoolRef(helperPoolName)],
			...overrides,
		};
	}

	afterAll(() => cleanup.cleanupAll());

	// --- Setup: create supporting origin pool ---
	it("setup: create helper origin pool", async () => {
		const manifest = buildManifest("origin_pool", helperPoolName, helperPoolSpec);
		cleanup.track("origin_pool", helperPoolName);
		const result = await client.create(manifest, poolResolved, NAMESPACE);
		assertCreated(result);
	}, 60_000);

	// --- Core CRUD ---
	it("1. create minimal HTTP LB — assertCreated", async () => {
		const manifest = buildManifest("http_loadbalancer", lbName, makeLbSpec());
		cleanup.track("http_loadbalancer", lbName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("2. get individual — spec.domains matches", async () => {
		const result = await client.get(lbResolved, lbName, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const spec = result.resource?.spec as Record<string, unknown> | undefined;
		expect(spec?.domains).toBeDefined();
		expect(Array.isArray(spec?.domains)).toBe(true);
		const domains = spec?.domains as string[];
		expect(domains).toContain("test.example.com");
	}, 30_000);

	it("3. get list — test LB in items", async () => {
		const result = await client.get(lbResolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const names = result.items?.map(item => item.name) ?? [];
		expect(names).toContain(lbName);
	}, 30_000);

	it("4. apply add second domain — status=updated", async () => {
		const spec = makeLbSpec({
			domains: ["test.example.com", "test2.example.com"],
		});
		const manifest = buildManifest("http_loadbalancer", lbName, spec);
		const result = await client.apply(manifest, lbResolved, NAMESPACE);
		assertUpdated(result);
	}, 30_000);

	it("5. apply change description — status=updated", async () => {
		const spec = makeLbSpec({
			domains: ["test.example.com", "test2.example.com"],
		});
		const manifest = buildManifest("http_loadbalancer", lbName, spec, {
			description: "updated by integration test",
		});
		const result = await client.apply(manifest, lbResolved, NAMESPACE);
		assertUpdated(result);
	}, 30_000);

	it("6. apply idempotent — status=unchanged", async () => {
		const spec = makeLbSpec({
			domains: ["test.example.com", "test2.example.com"],
		});
		const manifest = buildManifest("http_loadbalancer", lbName, spec, {
			description: "updated by integration test",
		});
		const result = await client.apply(manifest, lbResolved, NAMESPACE);
		assertUnchanged(result);
	}, 30_000);

	it("7. diff: domain change — diff has entries", async () => {
		const spec = makeLbSpec({
			domains: ["changed.example.com"],
		});
		const manifest = buildManifest("http_loadbalancer", lbName, spec, {
			description: "updated by integration test",
		});
		const result = await client.diff(manifest, lbResolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
		expect(result.diff!.hasDifferences).toBe(true);
	}, 30_000);

	it("8. dry-run create (new name, resource doesn't exist) — dry-run(create)", async () => {
		const newName = uniqueName("hlb-dryrun");
		const spec = makeLbSpec();
		const manifest = buildManifest("http_loadbalancer", newName, spec);
		const result = await client.apply(manifest, lbResolved, NAMESPACE, "client");
		assertDryRun(result, "create");
		// Verify resource was NOT created
		const getResult = await client.get(lbResolved, newName, NAMESPACE);
		expect(getResult.error).toBeDefined();
		expect(getResult.error?.kind).toBe("not_found");
	}, 30_000);

	it("9. dry-run update (existing, changed spec) — dry-run(update)", async () => {
		const spec = makeLbSpec({ domains: ["dryrun-changed.example.com"] });
		const manifest = buildManifest("http_loadbalancer", lbName, spec, {
			description: "updated by integration test",
		});
		const result = await client.apply(manifest, lbResolved, NAMESPACE, "client");
		assertDryRun(result, "update");
	}, 30_000);

	// --- Oneof fields ---
	it("10. oneof: http mode (plain HTTP) — spec has http with port", async () => {
		const oneofName = uniqueName("hlb-http");
		const spec = makeLbSpec({
			domains: [`${oneofName}.example.com`],
			http: { dns_volterra_managed: false, port: 80 },
		});
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("11. oneof: disable_waf — spec has disable_waf: {}", async () => {
		const oneofName = uniqueName("hlb-nowaf");
		const spec = makeLbSpec({ domains: [`${oneofName}.example.com`], disable_waf: {} });
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("12. oneof: no_challenge — spec has no_challenge: {}", async () => {
		const oneofName = uniqueName("hlb-nochal");
		const spec = makeLbSpec({ domains: [`${oneofName}.example.com`], no_challenge: {} });
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("13. oneof: disable_rate_limit — spec has disable_rate_limit: {}", async () => {
		const oneofName = uniqueName("hlb-norl");
		const spec = makeLbSpec({ domains: [`${oneofName}.example.com`], disable_rate_limit: {} });
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("14. oneof: disable_bot_defense — spec has disable_bot_defense: {}", async () => {
		const oneofName = uniqueName("hlb-nobot");
		const spec = makeLbSpec({ domains: [`${oneofName}.example.com`], disable_bot_defense: {} });
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("15. oneof: disable_api_discovery — spec has disable_api_discovery: {}", async () => {
		const oneofName = uniqueName("hlb-noapid");
		const spec = makeLbSpec({ domains: [`${oneofName}.example.com`], disable_api_discovery: {} });
		const manifest = buildManifest("http_loadbalancer", oneofName, spec);
		cleanup.track("http_loadbalancer", oneofName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 30_000);

	it("16. apply switch: add disable_waf on main LB — status=updated", async () => {
		const spec = makeLbSpec({ disable_waf: {} });
		const manifest = buildManifest("http_loadbalancer", lbName, spec, {
			description: "updated with waf disabled",
		});
		const result = await client.apply(manifest, lbResolved, NAMESPACE);
		assertUpdated(result);
	}, 30_000);

	// --- Multi-pool ---
	it("17. multi-pool: default_route_pools with 2 pools — assertCreated", async () => {
		const pool2Manifest = buildManifest("origin_pool", helperPool2Name, helperPoolSpec);
		cleanup.track("origin_pool", helperPool2Name);
		const poolResult = await client.create(pool2Manifest, poolResolved, NAMESPACE);
		assertCreated(poolResult);

		const multiName = uniqueName("hlb-multi");
		const spec = makeLbSpec({
			domains: [`${multiName}.example.com`],
			default_route_pools: [makePoolRef(helperPoolName), makePoolRef(helperPool2Name)],
		});
		const manifest = buildManifest("http_loadbalancer", multiName, spec);
		cleanup.track("http_loadbalancer", multiName);
		const result = await client.create(manifest, lbResolved, NAMESPACE);
		assertCreated(result);
	}, 60_000);

	// --- Teardown ---
	it("18. delete main LB — status=deleted", async () => {
		const result = await client.delete("http_loadbalancer", lbName, lbResolved, NAMESPACE);
		assertDeleted(result);
	}, 30_000);

	it("19. get after delete — error.kind=not_found", async () => {
		const result = await client.get(lbResolved, lbName, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	// --- Validation ---
	it("20. validation: missing domains — MISSING_FIELD error", () => {
		const manifest = buildManifest("http_loadbalancer", "val-no-domains", {
			http: { dns_volterra_managed: false, port: 80 },
			default_route_pools: [makePoolRef(helperPoolName)],
		});
		const { result } = validateManifest(manifest, resolver, NAMESPACE);
		expect(result.valid).toBe(false);
		const fieldError = result.errors.find(e => e.code === "MISSING_FIELD" && e.path.includes("domains"));
		expect(fieldError).toBeDefined();
	});
});
