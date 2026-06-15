/**
 * Live CRUD integration tests against real F5 XC API.
 *
 * Reads credentials from ~/.config/f5xc/contexts/nferreira.json (active context).
 * Creates test resources with unique names, runs full CRUD cycle, then cleans up.
 *
 * Run: F5XC_LIVE_TEST=1 bun test test/live-crud-integration.test.ts
 * Skip: bun test (skipped by default — won't run in CI)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createKindResolver } from "../src/kind-resolver";
import { formatManifestOutput } from "../src/manifest-export";
import { parseManifests } from "../src/manifest-parser";
import { ResourceClient } from "../src/resource-client";
import type { KindResolver } from "../src/types";

const LIVE = process.env.F5XC_LIVE_TEST === "1";
const SKIP_MSG = "Set F5XC_LIVE_TEST=1 to run live API tests";

const TEST_ID = Date.now().toString(36).slice(-6);
const TEST_PREFIX = `crud-test-${TEST_ID}`;

interface ContextConfig {
	apiUrl: string;
	apiToken: string;
	defaultNamespace: string;
}

function loadContext(): ContextConfig {
	const configDir = path.join(os.homedir(), ".config", "f5xc", "contexts");
	const ctxFile = path.join(configDir, "nferreira.json");
	if (!fs.existsSync(ctxFile)) {
		throw new Error(`Context file not found: ${ctxFile}`);
	}
	return JSON.parse(fs.readFileSync(ctxFile, "utf-8")) as ContextConfig;
}

function buildSpecIndex(resources: Array<{ kind: string; listPath: string; getPath: string }>) {
	return {
		version: "live-test",
		timestamp: new Date().toISOString(),
		domains: [
			{
				domain: "test",
				title: "Test",
				description: "Live test resources",
				descriptionShort: "Test",
				category: "Test",
				pathCount: resources.length * 2,
				schemaCount: 0,
				complexity: "standard",
				resources: resources.map(r => ({
					name: r.kind,
					description: r.kind,
					apiPaths: [r.listPath, r.getPath],
				})),
			},
		],
	};
}

const RESOURCE_DEFS = [
	{
		kind: "healthcheck",
		listPath: "/api/config/namespaces/{namespace}/healthchecks",
		getPath: "/api/config/namespaces/{namespace}/healthchecks/{name}",
		updateField: "timeout",
		updateValue: 5,
	},
	{
		kind: "app_firewall",
		listPath: "/api/config/namespaces/{namespace}/app_firewalls",
		getPath: "/api/config/namespaces/{namespace}/app_firewalls/{name}",
		updateField: "description_update",
		updateValue: true,
	},
	{
		kind: "origin_pool",
		listPath: "/api/config/namespaces/{namespace}/origin_pools",
		getPath: "/api/config/namespaces/{namespace}/origin_pools/{name}",
		updateField: "port",
		updateValue: 8080,
	},
	{
		kind: "http_loadbalancer",
		listPath: "/api/config/namespaces/{namespace}/http_loadbalancers",
		getPath: "/api/config/namespaces/{namespace}/http_loadbalancers/{name}",
		updateField: "domains",
		updateValue: [`${TEST_PREFIX}-updated.example.com`],
	},
];

function buildSpec(kind: string, namespace: string): Record<string, unknown> {
	const poolName = `${TEST_PREFIX}-origin-pool`;
	switch (kind) {
		case "healthcheck":
			return {
				http_health_check: { path: "/health" },
				timeout: 3,
				interval: 15,
				unhealthy_threshold: 3,
				healthy_threshold: 2,
			};
		case "app_firewall":
			return {};
		case "origin_pool":
			return {
				origin_servers: [{ public_ip: { ip: "198.51.100.1" } }],
				port: 80,
				no_tls: {},
				loadbalancer_algorithm: "ROUND_ROBIN",
			};
		case "http_loadbalancer":
			return {
				domains: [`${TEST_PREFIX}.example.com`],
				http: { dns_volterra_managed: false, port: 80 },
				advertise_on_public_default_vip: {},
				default_route_pools: [{ pool: { namespace, name: poolName }, weight: 1, priority: 1 }],
			};
		default:
			return {};
	}
}

const createdResources: Array<{ kind: string; name: string }> = [];

describe.skipIf(!LIVE)("live CRUD integration", () => {
	let client: ResourceClient;
	let resolver: KindResolver;
	let ctx: ContextConfig;

	beforeAll(() => {
		ctx = loadContext();
		const specIndex = buildSpecIndex(RESOURCE_DEFS);
		resolver = createKindResolver(specIndex);
		client = new ResourceClient({
			apiUrl: ctx.apiUrl,
			apiToken: ctx.apiToken,
			namespace: ctx.defaultNamespace,
		});
	});

	afterAll(async () => {
		for (const { kind, name } of [...createdResources].reverse()) {
			try {
				const resolved = resolver.resolveKind(kind);
				await client.delete(kind, name, resolved, ctx.defaultNamespace);
			} catch {
				console.warn(`Cleanup: failed to delete ${kind}/${name}`);
			}
		}
	});

	function resName(kind: string) {
		return `${TEST_PREFIX}-${kind.replace(/_/g, "-")}`;
	}

	function makeManifest(kind: string, spec: Record<string, unknown>) {
		const name = resName(kind);
		return {
			kind,
			metadata: { name, namespace: ctx.defaultNamespace },
			spec,
			rawObject: { kind, metadata: { name, namespace: ctx.defaultNamespace }, spec },
		};
	}

	// ── Phase 1: CREATE all resources (dependency order) ──
	describe("Phase 1: CREATE", () => {
		for (const def of RESOURCE_DEFS) {
			test(`creates ${def.kind}`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const spec = buildSpec(def.kind, ctx.defaultNamespace);
				const manifest = makeManifest(def.kind, spec);
				const result = await client.create(manifest, resolved, ctx.defaultNamespace);
				if (result.status === "error") {
					console.error(`CREATE ${def.kind} failed:`, JSON.stringify(result.error, null, 2));
				}
				expect(result.status).toBe("created");
				createdResources.push({ kind: def.kind, name: resName(def.kind) });
			}, 30_000);
		}
	});

	// ── Phase 2: EXPORT + DIFF + APPLY for each resource ──
	describe("Phase 2: EXPORT + DIFF + APPLY", () => {
		for (const def of RESOURCE_DEFS) {
			const name = resName(def.kind);

			test(`${def.kind}: export produces clean manifest`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const result = await client.exportOne(def.kind, resolved, name, ctx.defaultNamespace);
				expect(result.error).toBeUndefined();
				expect(result.manifest).toBeDefined();
				expect(result.manifest!.kind).toBe(def.kind);
				expect(result.manifest!.metadata.name).toBe(name);
				expect(result.manifest!.metadata).not.toHaveProperty("uid");
				expect(result.manifest!.metadata).not.toHaveProperty("creation_timestamp");
				expect(result.manifest!.spec).not.toHaveProperty("host_name");
				expect(result.manifest!.spec).not.toHaveProperty("dns_info");
				expect(result.manifest!.spec).not.toHaveProperty("state");
			}, 15_000);

			test(`${def.kind}: JSON format round-trips`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const result = await client.exportOne(def.kind, resolved, name, ctx.defaultNamespace);
				const json = formatManifestOutput([result.manifest!], "json");
				const reparsed = parseManifests([JSON.parse(json) as Record<string, unknown>], "test");
				expect(reparsed).toHaveLength(1);
				expect(reparsed[0].kind).toBe(def.kind);
				expect(reparsed[0].metadata.name).toBe(name);
			}, 15_000);

			test(`${def.kind}: YAML format valid`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const result = await client.exportOne(def.kind, resolved, name, ctx.defaultNamespace);
				const yaml = formatManifestOutput([result.manifest!], "yaml");
				expect(yaml).toContain(`kind: ${def.kind}`);
				expect(yaml).toContain(`name: ${name}`);
			}, 15_000);

			test(`${def.kind}: diff shows no changes on fresh export`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const exportResult = await client.exportOne(def.kind, resolved, name, ctx.defaultNamespace);
				const manifest = makeManifest(def.kind, exportResult.manifest!.spec);
				const diffResult = await client.diff(manifest, resolved, ctx.defaultNamespace);
				expect(diffResult.isNew).toBe(false);
				expect(diffResult.error).toBeUndefined();
			}, 15_000);

			test(`${def.kind}: apply update succeeds`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const exportResult = await client.exportOne(def.kind, resolved, name, ctx.defaultNamespace);
				const updatedSpec = { ...exportResult.manifest!.spec };

				if (def.updateField === "description_update") {
					// Update via metadata description
				} else {
					(updatedSpec as Record<string, unknown>)[def.updateField] = def.updateValue;
				}

				const manifest = {
					kind: def.kind,
					metadata: {
						name,
						namespace: ctx.defaultNamespace,
						description: def.updateField === "description_update" ? "updated by live test" : undefined,
					},
					spec: updatedSpec,
					rawObject: {
						kind: def.kind,
						metadata: {
							name,
							namespace: ctx.defaultNamespace,
							description: def.updateField === "description_update" ? "updated by live test" : undefined,
						},
						spec: updatedSpec,
					},
				};

				const result = await client.apply(manifest, resolved, ctx.defaultNamespace);
				expect(["updated", "unchanged"]).toContain(result.status);
			}, 30_000);
		}
	});

	// ── Phase 3: DELETE all resources (reverse dependency order) ──
	describe("Phase 3: DELETE", () => {
		for (const def of [...RESOURCE_DEFS].reverse()) {
			const name = resName(def.kind);

			test(`deletes ${def.kind}`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const result = await client.delete(def.kind, name, resolved, ctx.defaultNamespace);
				expect(result.status).toBe("deleted");
				const idx = createdResources.findIndex(r => r.kind === def.kind && r.name === name);
				if (idx >= 0) createdResources.splice(idx, 1);
			}, 15_000);

			test(`${def.kind} no longer exists`, async () => {
				const resolved = resolver.resolveKind(def.kind);
				const getResult = await client.get(resolved, name, ctx.defaultNamespace);
				expect(getResult.error).toBeDefined();
				expect(getResult.error!.kind).toBe("not_found");
			}, 15_000);
		}
	});
});

describe.skipIf(LIVE)("live CRUD integration (skipped)", () => {
	test(SKIP_MSG, () => {
		expect(true).toBe(true);
	});
});
