import { describe, expect, test } from "bun:test";
import { ResourceClient } from "../src/resource-client";
import type { HttpTransport, ResourceManifest } from "../src/types";

const resolved = {
	kind: "certificate",
	domain: "certificates",
	resource: { name: "certificate", description: "Certificate", apiPaths: [] },
	paths: {
		list: "/api/config/namespaces/{namespace}/certificates",
		get: "/api/config/namespaces/{namespace}/certificates/{name}",
		create: "/api/config/namespaces/{namespace}/certificates",
		update: "/api/config/namespaces/{namespace}/certificates/{name}",
		delete: "/api/config/namespaces/{namespace}/certificates/{name}",
	},
};
const metadata = { name: "example-tls", namespace: "demo-app" };
const spec = {
	certificate_url: "string:///ZXhhbXBsZQ==",
	private_key: { blindfold_secret_info: { location: "string:///c3ludGhldGlj" } },
};
const manifest: ResourceManifest = {
	kind: "certificate",
	metadata,
	spec,
	rawObject: { kind: "certificate", metadata, spec },
};
function fixture(options: { changed?: boolean; status?: number; wrapped?: boolean } = {}) {
	const calls: Array<{ method: string; url: string }> = [];
	const transport: HttpTransport = {
		async request(req) {
			calls.push({ method: req.method, url: req.url });
			if (options.status) return { httpStatus: options.status, body: {} };
			const comparison = new URL(req.url).searchParams.get("response_format") === "2";
			const complete = {
				metadata,
				spec: options.changed
					? { ...spec, private_key: { blindfold_secret_info: { location: "string:///b2xk" } } }
					: spec,
			};
			return {
				httpStatus: 200,
				body: comparison
					? options.wrapped === false
						? complete
						: { replace_form: complete }
					: { metadata, spec: { certificate_url: spec.certificate_url, private_key: {} } },
			};
		},
	};
	return {
		calls,
		client: new ResourceClient({
			apiUrl: "https://example.test",
			apiToken: "synthetic",
			namespace: "demo-app",
			transport,
		}),
	};
}
describe("certificate manifest comparisons", () => {
	for (const operation of ["apply", "update", "diff"] as const) {
		test(`${operation} reads complete replace form without a mutation for identical ciphertext`, async () => {
			const { client, calls } = fixture();
			const result = await client[operation](manifest, resolved);
			if ("status" in result) expect(result.status).toBe("unchanged");
			else expect(result.diff?.hasDifferences).toBe(false);
			expect(calls).toHaveLength(1);
			expect(calls[0].method).toBe("GET");
			expect(new URL(calls[0].url).searchParams.get("response_format")).toBe("2");
		});
	}
	test("a changed encrypted location still requires replacement", async () => {
		const { client, calls } = fixture({ changed: true });
		expect((await client.apply(manifest, resolved)).status).toBe("updated");
		expect(calls.map(call => call.method)).toEqual(["GET", "PUT"]);
	});
	test("dry run and diff expose changed ciphertext without writing", async () => {
		const { client, calls } = fixture({ changed: true });
		expect(await client.apply(manifest, resolved, undefined, "client")).toMatchObject({
			status: "dry-run",
			action: "update",
		});
		expect((await client.diff(manifest, resolved)).diff?.hasDifferences).toBe(true);
		expect(calls.every(call => call.method === "GET")).toBe(true);
	});
	test("direct replace-form response remains supported", async () => {
		const { client } = fixture({ wrapped: false });
		expect((await client.apply(manifest, resolved)).status).toBe("unchanged");
	});
	test("404 preserves dry-run create and API failures prevent writes", async () => {
		const missing = fixture({ status: 404 });
		expect(await missing.client.apply(manifest, resolved, undefined, "client")).toMatchObject({
			status: "dry-run",
			action: "create",
		});
		const denied = fixture({ status: 403 });
		expect((await denied.client.apply(manifest, resolved)).status).toBe("error");
		expect(denied.calls).toHaveLength(1);
	});
	test("ordinary get and other kinds retain their original projection", async () => {
		const { client, calls } = fixture();
		await client.get(resolved, metadata.name);
		await client.get(resolved);
		await client.diff(manifest, { ...resolved, kind: "http_loadbalancer" });
		expect(calls.every(call => !new URL(call.url).searchParams.has("response_format"))).toBe(true);
	});
});
