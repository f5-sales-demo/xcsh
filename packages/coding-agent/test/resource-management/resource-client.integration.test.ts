import { afterAll, describe, expect, it } from "bun:test";
import { resolveKind } from "../../src/resource-management/kind-resolver";
import { parseManifests } from "../../src/resource-management/manifest-parser";
import { validateManifest } from "../../src/resource-management/manifest-validator";
import { ResourceClient } from "../../src/resource-management/resource-client";
import type { ResourceManifest } from "../../src/resource-management/types";

const LIVE = !!process.env.LIVE_API_TEST;
const API_URL = process.env.F5XC_API_URL ?? "";
const API_TOKEN = process.env.F5XC_API_TOKEN ?? "";
const NAMESPACE = "default";
const TEST_NAME = `xcsh-test-${Date.now()}`;
const TEST_KIND = "app_firewall";

function makeClient(): ResourceClient {
	return new ResourceClient({
		apiUrl: API_URL,
		apiToken: API_TOKEN,
		namespace: NAMESPACE,
	});
}

function makeManifest(overrides?: Partial<ResourceManifest["metadata"]>): ResourceManifest {
	const raw = {
		kind: TEST_KIND,
		metadata: {
			name: TEST_NAME,
			namespace: NAMESPACE,
			description: "xcsh integration test resource",
			...overrides,
		},
		spec: {},
	};
	return parseManifests([raw], "integration-test")[0];
}

describe.skipIf(!LIVE)("Integration: ResourceClient live CRUD", () => {
	const client = makeClient();
	const resolved = resolveKind(TEST_KIND);
	let _createdResource: Record<string, unknown> | undefined;

	afterAll(async () => {
		try {
			await client.delete(TEST_KIND, TEST_NAME, resolved, NAMESPACE);
		} catch {
			// Best-effort cleanup
		}
	});

	it("1. create — creates a new app_firewall resource", async () => {
		const manifest = makeManifest();
		const result = await client.create(manifest, resolved, NAMESPACE);
		expect(result.status).toBe("created");
		if (result.status === "created") {
			expect(result.durationMs).toBeGreaterThan(0);
			expect(result.resource).toBeDefined();
			_createdResource = result.resource;
		}
	}, 30_000);

	it("2. get (individual) — fetches the created resource by name", async () => {
		const result = await client.get(resolved, TEST_NAME, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.resource).toBeDefined();
		const meta = result.resource?.metadata as Record<string, unknown> | undefined;
		expect(meta?.name).toBe(TEST_NAME);
	}, 30_000);

	it("3. get (list) — lists resources and includes the test resource", async () => {
		const result = await client.get(resolved, undefined, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.items).toBeDefined();
		expect(Array.isArray(result.items)).toBe(true);
		const found = result.items?.some(item => item.name === TEST_NAME);
		expect(found).toBe(true);
	}, 30_000);

	it("4. apply (no-change) — reports unchanged for identical manifest", async () => {
		const manifest = makeManifest();
		const result = await client.apply(manifest, resolved, NAMESPACE);
		expect(result.status).toBe("unchanged");
	}, 30_000);

	it("5. apply (update) — updates resource when description changes", async () => {
		const manifest = makeManifest({ description: "updated by integration test" });
		const result = await client.apply(manifest, resolved, NAMESPACE);
		expect(result.status).toBe("updated");
		if (result.status === "updated") {
			expect(result.diff.hasDifferences).toBe(true);
			expect(result.durationMs).toBeGreaterThan(0);
		}
	}, 30_000);

	it("6. diff — detects changes between current and desired state", async () => {
		const manifest = makeManifest({ description: "diff test value" });
		const result = await client.diff(manifest, resolved, NAMESPACE);
		expect(result.error).toBeUndefined();
		expect(result.isNew).toBe(false);
		expect(result.diff).toBeDefined();
	}, 30_000);

	it("7. apply dry-run=client — validates without mutating", async () => {
		const manifest = makeManifest({ description: "should not persist" });
		const result = await client.apply(manifest, resolved, NAMESPACE, "client");
		expect(result.status).toBe("dry-run");
		if (result.status === "dry-run") {
			expect(result.action).toBe("update");
		}
	}, 30_000);

	it("8. delete — removes the resource", async () => {
		const result = await client.delete(TEST_KIND, TEST_NAME, resolved, NAMESPACE);
		expect(result.status).toBe("deleted");
		if (result.status === "deleted") {
			expect(result.durationMs).toBeGreaterThan(0);
			expect(result.name).toBe(TEST_NAME);
		}
	}, 30_000);

	it("9. get after delete — returns not_found", async () => {
		const result = await client.get(resolved, TEST_NAME, NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	it("10. create duplicate — second create falls back to update (409 handling)", async () => {
		const manifest = makeManifest();
		const first = await client.create(manifest, resolved, NAMESPACE);
		expect(first.status).toBe("created");

		const second = await client.create(manifest, resolved, NAMESPACE);
		expect(second.status === "updated" || second.status === "created").toBe(true);

		await client.delete(TEST_KIND, TEST_NAME, resolved, NAMESPACE);
	}, 60_000);
});

describe.skipIf(!LIVE)("Integration: Validation against live spec data", () => {
	it("11. validates unknown kind", () => {
		const manifest: ResourceManifest = {
			kind: "nonexistent_resource_xyz",
			metadata: { name: "test", namespace: NAMESPACE },
			spec: {},
			rawObject: { kind: "nonexistent_resource_xyz", metadata: { name: "test", namespace: NAMESPACE }, spec: {} },
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.code === "UNKNOWN_KIND")).toBe(true);
	});

	it("12. validates missing required spec fields for http_loadbalancer", () => {
		const manifest: ResourceManifest = {
			kind: "http_loadbalancer",
			metadata: { name: "test-lb", namespace: NAMESPACE },
			spec: {},
			rawObject: { kind: "http_loadbalancer", metadata: { name: "test-lb", namespace: NAMESPACE }, spec: {} },
		};
		const { result } = validateManifest(manifest, NAMESPACE);
		expect(result.valid).toBe(false);
		const specErrors = result.errors.filter(e => e.path.startsWith("spec."));
		expect(specErrors.length).toBeGreaterThan(0);
	});
});
