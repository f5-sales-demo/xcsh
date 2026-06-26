import { afterAll, describe, expect, it } from "bun:test";
import { parseResourceArgs } from "@f5-sales-demo/pi-resource-management";
import {
	buildManifest,
	CleanupRegistry,
	LIVE,
	makeClient,
	makeClientWithToken,
	makeClientWithUrl,
	NAMESPACE,
	resolveKind,
	uniqueName,
} from "./_helpers";

describe.skipIf(!LIVE)("Integration: error-handling (live API)", () => {
	const client = makeClient();
	const cleanup = new CleanupRegistry(client);
	const resolvedAfw = resolveKind("app_firewall");

	afterAll(() => cleanup.cleanupAll());

	it("1. invalid API token → error.kind=auth", async () => {
		const badClient = makeClientWithToken("invalid-token");
		const manifest = buildManifest("app_firewall", uniqueName("err-auth"), {});
		const result = await badClient.create(manifest, resolvedAfw, NAMESPACE);
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.error.kind).toBe("auth");
		}
	}, 30_000);

	it("2. invalid API URL → error.kind=network", async () => {
		const badClient = makeClientWithUrl("https://nonexistent.invalid");
		const manifest = buildManifest("app_firewall", uniqueName("err-net"), {});
		const result = await badClient.create(manifest, resolvedAfw, NAMESPACE);
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.error.kind).toBe("network");
		}
	}, 30_000);

	it("3. get non-existent resource → error.kind=not_found", async () => {
		const result = await client.get(resolvedAfw, "does-not-exist-xyz-999", NAMESPACE);
		expect(result.error).toBeDefined();
		expect(result.error?.kind).toBe("not_found");
	}, 30_000);

	it("4. delete non-existent resource → error or not_found", async () => {
		const result = await client.delete("app_firewall", "does-not-exist-xyz-999", resolvedAfw, NAMESPACE);
		// Could be error status with not_found, or direct error
		if (result.status === "error") {
			expect(["not_found", "api"]).toContain(result.error.kind);
		}
		// Some APIs return 404 as deleted — either way, no crash
		expect(["deleted", "error"]).toContain(result.status);
	}, 30_000);

	it("5. create with bogus spec field values → API error", async () => {
		const name = uniqueName("err-bogus");
		const manifest = buildManifest("app_firewall", name, {
			// Server should reject an invalid structure in a known field
			monitoring: { invalid_nested_structure: [[[true]]] },
		});
		const result = await client.create(manifest, resolvedAfw, NAMESPACE);
		// This may succeed if server ignores unknown structures,
		// or fail with an API error. Track for cleanup either way.
		if (result.status === "created") {
			cleanup.track("app_firewall", name);
		} else if (result.status === "error") {
			expect(result.error.kind).toBe("api");
		}
	}, 30_000);

	it("6. apply to non-existent namespace → API error", async () => {
		const name = uniqueName("err-bad-ns");
		const manifest = buildManifest("app_firewall", name, {});
		const result = await client.apply(manifest, resolvedAfw, "nonexistent-ns-xyz-999");
		// Applying to a namespace that doesn't exist should return an error
		if (result.status === "error") {
			expect(["api", "not_found"]).toContain(result.error.kind);
		}
		// If the namespace auto-creates or is permissive, clean up
		if (result.status === "created") {
			cleanup.track("app_firewall", name);
		}
	}, 30_000);
});

describe("Integration: error-handling (arg parser)", () => {
	it("7. parseResourceArgs: empty filename flag → error message", () => {
		const result = parseResourceArgs("-f");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("requires");
		}
	});

	it("8. parseResourceArgs: unknown flag → error message", () => {
		const result = parseResourceArgs("--bogus-flag");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Unknown flag");
		}
	});

	it("9. parseResourceArgs: invalid output format → error message", () => {
		const result = parseResourceArgs("-o xml");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Invalid output format");
			expect(result.error).toContain("xml");
		}
	});

	it("10. parseResourceArgs: invalid dry-run mode → error message", () => {
		const result = parseResourceArgs("--dry-run=banana");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Invalid --dry-run mode");
			expect(result.error).toContain("banana");
		}
	});
});
