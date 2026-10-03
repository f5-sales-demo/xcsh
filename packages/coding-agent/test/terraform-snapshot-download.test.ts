import { expect, test } from "bun:test";
import { fetchTerraformSnapshot } from "../scripts/terraform-snapshot-download";

test("snapshot transport retries transient failures and returns the successful response", async () => {
	const statuses = [500, 503, 200];
	const delays: number[] = [];
	let calls = 0;
	const response = await fetchTerraformSnapshot("https://example.test/asset", undefined, {
		fetch: async () => {
			calls++;
			return new Response("asset", { status: statuses.shift()! });
		},
		sleep: async ms => {
			delays.push(ms);
		},
	});
	expect(calls).toBe(3);
	expect(delays).toEqual([500, 1000]);
	expect(await response.text()).toBe("asset");
});
test("snapshot transport retries network failures but bounds attempts", async () => {
	let calls = 0;
	await expect(
		fetchTerraformSnapshot("https://example.test/asset", undefined, {
			fetch: async () => {
				calls++;
				throw new TypeError("fetch failed");
			},
			sleep: async () => {},
		}),
	).rejects.toThrow("fetch failed");
	expect(calls).toBe(4);
});
test("snapshot transport does not retry permanent HTTP failures", async () => {
	let calls = 0;
	const response = await fetchTerraformSnapshot("https://example.test/asset", undefined, {
		fetch: async () => {
			calls++;
			return new Response("missing", { status: 404 });
		},
		sleep: async () => {
			throw new Error("unexpected retry");
		},
	});
	expect(calls).toBe(1);
	expect(response.status).toBe(404);
});
test("snapshot transport returns the final transient HTTP failure for caller validation", async () => {
	let calls = 0;
	const response = await fetchTerraformSnapshot("https://example.test/asset", undefined, {
		fetch: async () => {
			calls++;
			return new Response("unavailable", { status: 500 });
		},
		sleep: async () => {},
	});
	expect(calls).toBe(4);
	expect(response.status).toBe(500);
});
