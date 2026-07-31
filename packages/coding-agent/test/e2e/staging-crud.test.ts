/**
 * Staging CRUD matrix — real F5 XC API operations against the staging tenant.
 *
 * Verifies that the xcsh API client can CREATE, READ, UPDATE, and DELETE a real
 * resource on the live staging console. Runs from a VPN-connected workstation
 * only (requires XCSH_STAGING_API_URL + XCSH_STAGING_API_TOKEN); skipped in CI
 * and when the env vars are absent. Uses a standalone resource (health_check)
 * with no external dependencies, and cleans up after itself.
 *
 * Run:
 *   XCSH_STAGING_API_URL=https://example.staging.volterra.us \
 *   XCSH_STAGING_API_TOKEN=<token> \
 *   bun test test/e2e/staging-crud.test.ts
 */
import { afterAll, describe, expect, it } from "bun:test";

const API_URL = process.env.XCSH_STAGING_API_URL;
const API_TOKEN = process.env.XCSH_STAGING_API_TOKEN;
const NS = process.env.XCSH_STAGING_NAMESPACE ?? "example-corp";
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const canRun = !isCI && !!API_URL && !!API_TOKEN;

const RESOURCE = `crud-test-${Date.now()}`;
const AUTH = { Authorization: `APIToken ${API_TOKEN}` };
const JSON_HEADERS = { ...AUTH, "Content-Type": "application/json" };

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers: body ? JSON_HEADERS : AUTH,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

const hcPath = `/api/config/namespaces/${NS}/healthchecks`;
const hcSpec = (path: string, labels: Record<string, string> = {}) => ({
	metadata: { name: RESOURCE, namespace: NS, labels: { test: "crud-matrix", ...labels } },
	spec: { http_health_check: { path }, timeout: 3, interval: 15, unhealthy_threshold: 3, healthy_threshold: 1 },
});

// Clean up even on failure: delete the test resource so we don't leak.
afterAll(async () => {
	if (canRun) await api("DELETE", `${hcPath}/${RESOURCE}`).catch(() => {});
});

describe.skipIf(!canRun)("staging CRUD matrix (real F5 XC API)", () => {
	it("CREATE: a health_check resource is created", async () => {
		const { status } = await api("POST", hcPath, hcSpec("/healthz"));
		expect(status).toBe(200);
	});

	it("READ: the created resource is retrievable and has the correct name", async () => {
		const { status, data } = await api("GET", `${hcPath}/${RESOURCE}`);
		expect(status).toBe(200);
		expect((data as { metadata: { name: string } }).metadata.name).toBe(RESOURCE);
	});

	it("UPDATE: changing the path + adding a label succeeds", async () => {
		const { status } = await api("PUT", `${hcPath}/${RESOURCE}`, hcSpec("/ready", { updated: "true" }));
		expect(status).toBe(200);
	});

	it("READ-AFTER-UPDATE: the path and label reflect the update", async () => {
		const { data } = await api("GET", `${hcPath}/${RESOURCE}`);
		const d = data as { spec: { http_health_check: { path: string } }; metadata: { labels: Record<string, string> } };
		expect(d.spec.http_health_check.path).toBe("/ready");
		expect(d.metadata.labels.updated).toBe("true");
	});

	it("DELETE: the resource is removed", async () => {
		const { status } = await api("DELETE", `${hcPath}/${RESOURCE}`);
		expect(status).toBe(200);
	});

	it("VERIFY-GONE: the resource is no longer retrievable (404)", async () => {
		await new Promise(r => setTimeout(r, 2000)); // eventual consistency
		const { status } = await api("GET", `${hcPath}/${RESOURCE}`);
		expect(status).toBe(404);
	});
});
