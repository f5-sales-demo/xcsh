import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	EMBEDDED_PROVIDER_VERSION,
	ProviderReleaseLookup,
	selectLatestStable,
} from "../../src/internal-urls/provider-release";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const response = (...versions: string[]) => Response.json({ versions: versions.map(version => ({ version })) });
const lookup = (deps = {}) => new ProviderReleaseLookup({ embeddedVersion: "15.2.0", cachePath: null, ...deps });

describe("provider release discovery", () => {
	it("keeps packaged metadata equal to the reviewed documentation pin", async () => {
		const pin = await Bun.file(
			path.resolve(import.meta.dir, "../../../../tools/terraform-documentation-release.json"),
		).json();
		expect(EMBEDDED_PROVIDER_VERSION).toBe(pin.provider_version.replace(/^v/, ""));
	});
	it("orders stable semantic versions and excludes prereleases", () => {
		expect(
			selectLatestStable({ versions: ["15.2.0", "15.10.0", "16.0.0-rc.1", "15.9.9"].map(version => ({ version })) }),
		).toBe("15.10.0");
		expect(
			selectLatestStable({
				versions: [{ version: "99999999999999999999.0.0" }, { version: "100000000000000000000.0.0" }],
			}),
		).toBe("100000000000000000000.0.0");
	});
	it.each([
		{},
		{ versions: [] },
		{ versions: [{ version: 3 }] },
		{ versions: [{ version: "15.02.0" }] },
		{ versions: [{ version: "16.0.0-beta" }] },
	])("rejects malformed or stable-free responses: %j", value => {
		expect(() => selectLatestStable(value)).toThrow();
	});
	it("deduplicates concurrent requests then refreshes the unchanged lookup for a newer release", async () => {
		let calls = 0;
		const service = lookup({
			fetch: async () => {
				calls++;
				await Bun.sleep(5);
				return response(calls === 1 ? "15.2.0" : "15.3.0");
			},
		});
		const results = await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
		expect(calls).toBe(1);
		expect(results.every(item => item.latestVersion === "15.2.0" && item.freshness === "fresh")).toBe(true);
		expect((await service.latest()).latestVersion).toBe("15.2.0");
		expect(calls).toBe(1);
		expect((await service.refresh()).latestVersion).toBe("15.3.0");
	});
	it("persists only successful lookups and falls back across restarts", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "provider-release-"));
		dirs.push(dir);
		const cachePath = path.join(dir, "latest.json");
		const verified = await lookup({ cachePath, fetch: async () => response("15.3.0") }).refresh();
		const offline = await lookup({
			cachePath,
			fetch: async () => {
				throw new Error("offline");
			},
		}).refresh();
		expect(offline.latestVersion).toBe("15.3.0");
		expect(offline.lookedUpAt).toBe(verified.lookedUpAt);
		expect(offline.embeddedDocumentationVersion).toBe("15.2.0");
		expect(offline.freshness).toBe("cached");
		expect(offline.lookupFailure).toContain("offline");
	});
	it("bounds a fetch that ignores cancellation and falls back to embedded metadata", async () => {
		const result = await lookup({ timeoutMs: 5, fetch: () => new Promise<Response>(() => {}) }).refresh();
		expect(result.latestVersion).toBe("15.2.0");
		expect(result.freshness).toBe("embedded");
		expect(result.lookedUpAt).toBeNull();
		expect(result.lookupFailure).toContain("timed out");
	});
	it("bounds response-body decoding and treats malformed JSON as failure", async () => {
		const service = lookup({
			timeoutMs: 5,
			fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response,
		});
		expect((await service.refresh()).lookupFailure).toContain("timed out");
		expect((await lookup({ fetch: async () => new Response("not json") }).refresh()).freshness).toBe("embedded");
	});
	it("cancels one waiter without cancelling other concurrent callers", async () => {
		const controller = new AbortController();
		let calls = 0;
		const service = lookup({
			fetch: async () => {
				calls++;
				await Bun.sleep(20);
				return response("15.3.0");
			},
		});
		const cancelled = service.refresh(controller.signal);
		const remaining = service.refresh();
		controller.abort();
		await expect(cancelled).rejects.toThrow();
		expect((await remaining).latestVersion).toBe("15.3.0");
		expect(calls).toBe(1);
	});
	it("does not publish a cancelled lookup and supports a new turn immediately", async () => {
		const controller = new AbortController();
		let calls = 0;
		const service = lookup({
			fetch: async () => {
				calls++;
				if (calls === 1) await Bun.sleep(50);
				return response("15.3.0");
			},
		});
		const cancelled = service.refresh(controller.signal);
		controller.abort();
		await expect(cancelled).rejects.toThrow();
		expect((await service.refresh()).freshness).toBe("fresh");
		expect(calls).toBe(2);
	});
	it("ignores corrupt or foreign cache metadata", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "provider-release-"));
		dirs.push(dir);
		const cachePath = path.join(dir, "latest.json");
		await Bun.write(
			cachePath,
			JSON.stringify({ version: "99.0.0", sourceUrl: "https://example.com", lookedUpAt: new Date().toISOString() }),
		);
		expect((await lookup({ cachePath, fetch: async () => response("bad") }).refresh()).freshness).toBe("embedded");
	});
});
