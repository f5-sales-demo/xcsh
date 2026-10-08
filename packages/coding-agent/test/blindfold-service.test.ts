import { describe, expect, test } from "bun:test";
import { BlindfoldService } from "../src/services/blindfold";

const env = {
	XCSH_API_URL: "https://example-tenant.console.ves.volterra.io",
	XCSH_API_TOKEN: "private-token-marker",
	XCSH_NAMESPACE: "example-ns",
};
const material = {
	location: "string:///encrypted-marker",
	certificateUrl: "string:///public-cert",
	fingerprint: "public-fingerprint",
	tenant: "example-tenant",
	expiresAt: "future",
	algorithm: "RSA",
};
const publicKey = {
	data: { tenant: "example-tenant", key_version: 1, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
};
const policy = { data: { tenant: "example-tenant", policy_id: "101" } };
function fixture(existing?: Record<string, unknown>, uncertain = false) {
	const calls: string[] = [];
	let saved = existing;
	const fetcher = async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push(`${method} ${url}`);
		if (url.includes("get_public_key")) return Response.json(publicKey);
		if (url.includes("get_policy_document")) return Response.json(policy);
		if (method === "GET") return saved ? Response.json(saved) : Response.json({}, { status: 404 });
		saved = JSON.parse(String(init?.body));
		if (uncertain) throw new Error("private-token-marker encrypted-marker");
		return Response.json({});
	};
	const service = new BlindfoldService({ env, fetch: fetcher, prepare: () => material });
	return {
		service,
		calls,
		get saved() {
			return saved;
		},
	};
}
const args = { operation: "create" as const, cert: "cert.pem", key: "key.pem", name: "example-cert" };
describe("Blindfold service safety", () => {
	test("client dry run performs no tenant writes and returns only public report", async () => {
		const f = fixture();
		const r = await f.service.run({ ...args, dryRun: "client" });
		expect(r.status).toBe("dry-run");
		expect(f.calls.every(x => x.startsWith("GET"))).toBe(true);
		expect(JSON.stringify(r)).not.toContain("encrypted-marker");
	});
	test("create verifies readback and clear keys are absent", async () => {
		const f = fixture();
		const r = await f.service.run(args);
		expect(r.status).toBe("accepted");
		expect(f.saved?.spec).toEqual({
			certificate_url: material.certificateUrl,
			private_key: { blindfold_secret_info: { location: material.location } },
		});
		expect(JSON.stringify(r)).not.toContain("encrypted-marker");
		expect(r.readiness).toBe("unverified");
	});
	test("collision and absent replace fail before write", async () => {
		const f = fixture({ metadata: { name: "example-cert" }, spec: {} });
		await expect(f.service.run(args)).rejects.toThrow("already exists");
		expect(f.calls.every(x => x.startsWith("GET"))).toBe(true);
		await expect(fixture().service.run({ ...args, operation: "replace" })).rejects.toThrow("does not exist");
	});
	test("rotation preserves metadata and options", async () => {
		const f = fixture({
			metadata: {
				name: "example-cert",
				namespace: "example-ns",
				labels: { owner: "example" },
				description: "retain",
			},
			spec: { custom_option: true, certificate_url: "old", private_key: { clear_secret_info: { url: "old" } } },
		});
		await f.service.run({ ...args, operation: "replace" });
		expect(f.saved?.metadata).toMatchObject({ labels: { owner: "example" }, description: "retain" });
		expect(f.saved?.spec).toMatchObject({ custom_option: true });
		expect(JSON.stringify(f.saved)).not.toContain("clear_secret_info");
	});
	test("replacement requests one certificate response format selector", async () => {
		const f = fixture({ metadata: { name: "example-cert" }, spec: {} });
		await f.service.run({ ...args, operation: "replace" });
		for (const call of f.calls.filter(x => x.startsWith("GET ") && x.includes("/certificates/")))
			expect(new URL(call.slice(4)).searchParams.getAll("response_format")).toEqual(["2"]);
	});
	test("uncertain write reconciles by read without retry", async () => {
		const f = fixture(undefined, true);
		const r = await f.service.run(args);
		expect(r.status).toBe("accepted");
		expect(f.calls.filter(x => x.startsWith("POST"))).toHaveLength(1);
	});
	test("missing credentials, tenant mismatch and cancellation fail closed", async () => {
		await expect(new BlindfoldService({ env: {} }).run(args)).rejects.toThrow("credentials");
		const f = fixture();
		await expect(f.service.run(args, { signal: AbortSignal.abort() })).rejects.toThrow("cancelled");
		expect(f.calls).toHaveLength(0);
		await expect(
			new BlindfoldService({
				env: { ...env, XCSH_API_URL: "https://other.console.ves.volterra.io" },
				fetch: async url =>
					Response.json(
						url.includes("get_policy_document")
							? { data: { ...policy.data, tenant: "example-other" } }
							: publicKey,
					),
				prepare: () => material,
			}).run(args),
		).rejects.toThrow("tenant");
	});
	test("Plan Mode blocks deploy and artifacts before I/O", async () => {
		const f = fixture();
		await expect(f.service.run(args, { planMode: true })).rejects.toThrow("Plan mode");
		await expect(
			f.service.run({ operation: "public-key", outputFile: "public.json" }, { planMode: true }),
		).rejects.toThrow("Plan mode");
		expect(f.calls).toHaveLength(0);
	});
	test("denied policy does not echo API response", async () => {
		const f = new BlindfoldService({
			env,
			fetch: async () => Response.json({ message: "private-token-marker" }, { status: 403 }),
			prepare: () => material,
		});
		await expect(f.run(args)).rejects.toThrow("HTTP 403");
	});
});

describe("Blindfold output and API response safety", () => {
	test("consumes F5 replace-form responses without returning encrypted material", async () => {
		let saved: Record<string, unknown> | undefined;
		const urls: string[] = [];
		const service = new BlindfoldService({
			env,
			prepare: () => material,
			fetch: async (url, init) => {
				urls.push(url);
				if (url.includes("get_public_key")) return Response.json(publicKey);
				if (url.includes("get_policy_document")) return Response.json(policy);
				if (init?.method === "POST") {
					saved = JSON.parse(String(init.body));
					return Response.json({});
				}
				return saved
					? Response.json({ replace_form: saved, spec: { private_key: { blindfold_secret_info_internal: null } } })
					: Response.json({}, { status: 404 });
			},
		});
		const report = await service.run(args);
		expect(report.status).toBe("accepted");
		expect(JSON.stringify(report)).not.toContain("encrypted-marker");
		expect(urls.filter(v => v.includes("/certificates/")).every(v => v.endsWith("response_format=2"))).toBe(true);
	});
	test("rejects denied and rate-limited writes without retry or echoed secrets", async () => {
		for (const status of [403, 429]) {
			const calls: string[] = [];
			const service = new BlindfoldService({
				env,
				prepare: () => material,
				fetch: async (url, init) => {
					calls.push(init?.method ?? "GET");
					if (url.includes("get_public_key")) return Response.json(publicKey);
					if (url.includes("get_policy_document")) return Response.json(policy);
					return Response.json(
						{ message: "private-token-marker encrypted-marker" },
						{ status: init?.method === "POST" ? status : 404 },
					);
				},
			});
			await expect(service.run(args)).rejects.toThrow("outcome unresolved");
			expect(calls.filter(v => v === "POST")).toHaveLength(1);
		}
	});
	test("publishes new encrypted files as 0600 and refuses overwrite", async () => {
		const fs = await import("node:fs/promises"),
			os = await import("node:os"),
			path = await import("node:path");
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "blindfold-artifact-"));
		try {
			const destination = path.join(root, "manifest.json"),
				f = fixture();
			const report = await f.service.run({ ...args, operation: "certificate", outputFile: destination });
			expect((await fs.stat(destination)).mode & 0o777).toBe(0o600);
			expect(await fs.readFile(destination, "utf8")).toContain("encrypted-marker");
			expect(JSON.stringify(report)).not.toContain("encrypted-marker");
			await expect(f.service.run({ ...args, operation: "certificate", outputFile: destination })).rejects.toThrow(
				"destination must be new",
			);
			expect(await fs.readdir(root)).toEqual(["manifest.json"]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
