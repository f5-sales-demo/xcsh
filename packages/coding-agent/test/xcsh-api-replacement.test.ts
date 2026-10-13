import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { XcshApiTool } from "../src/tools/xcsh-api";

const endpoint = "/api/config/namespaces/demo-app/http_loadbalancers/demo";
const types = ["http", "https", "https_auto_cert"];
function payload(type: string) {
	return {
		metadata: { name: "demo", namespace: "demo-app" },
		spec: {
			[type]:
				type === "http"
					? { port: 80 }
					: { http_redirect: true, default_header: {}, tls_config: { default_security: {} }, no_mtls: {} },
		},
	};
}
function resource(type: string, uid = "old", version = "1"): any {
	const p = payload(type);
	return {
		...p,
		metadata: { ...p.metadata, labels: { team: "demo" } },
		system_metadata: { uid },
		resource_version: version,
		spec: { ...p.spec, domains: ["example.test"], advertise_on_public_default_vip: {}, state: "VIRTUAL_HOST_READY" },
	};
}
let nativeFetch: typeof fetch;
let directory: string;
let tool: XcshApiTool;
let current: any;
let methods: string[];
let failPost = false;
let failDelete = false;
let concurrent = false;
let lostPost = false;
let readsFail = false;
beforeEach(async () => {
	nativeFetch = globalThis.fetch;
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-replacement-"));
	methods = [];
	current = resource("http");
	failPost = false;
	failDelete = false;
	concurrent = false;
	lostPost = false;
	readsFail = false;
	tool = new XcshApiTool({
		settings: {
			get: (k: string) =>
				k === "bash.environment"
					? {
							XCSH_API_URL: "https://example.test",
							XCSH_API_TOKEN: "private-test-token",
							XCSH_CONTEXT_NAME: "demo-app",
						}
					: undefined,
		},
	} as any);
	process.env.XCSH_REPLACEMENT_STATE_DIR = directory;
	globalThis.fetch = Object.assign(
		async (url: any, init: any) => {
			const method = init?.method ?? "GET";
			if (!String(url).includes("http_loadbalancers")) return new Response("{}", { status: 200 });
			methods.push(method);
			if (method === "GET") {
				if (readsFail) return new Response("unavailable", { status: 503 });
				if (concurrent && methods.filter(m => m === "GET").length === 2) current = resource("http", "old", "2");
				return new Response(JSON.stringify(current ?? { code: 5 }), {
					status: current ? 200 : 404,
					headers: { "content-type": "application/json" },
				});
			}
			if (method === "DELETE") {
				if (failDelete) return new Response("denied", { status: 403 });
				current = null;
				return new Response("{}");
			}
			if (method === "POST") {
				if (failPost)
					return new Response(JSON.stringify({ code: 3, message: "Invalid domain private-test-token" }), {
						status: 400,
					});
				const body = JSON.parse(init.body);
				current = {
					...body,
					system_metadata: { uid: "new" },
					resource_version: "1",
					spec: { ...body.spec, state: "VIRTUAL_HOST_READY" },
				};
				if (lostPost) {
					lostPost = false;
					throw new Error("response lost");
				}
				return new Response(JSON.stringify(current));
			}
			return new Response("{}");
		},
		{ preconnect: () => {} },
	) as typeof fetch;
});
afterEach(async () => {
	globalThis.fetch = nativeFetch;
	delete process.env.XCSH_REPLACEMENT_STATE_DIR;
	await fs.rm(directory, { recursive: true, force: true });
});
const invoke = (p: any) => tool.execute("test", { method: "PUT", path: endpoint, ...p });
describe("HTTP LB replacement safety", () => {
	it("observes a committed POST after a lost response without duplicate create", async () => {
		lostPost = true;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).not.toBe(true);
		expect(methods.filter(m => m === "POST")).toHaveLength(1);
	});
	it("blocks mutation when the current GET fails", async () => {
		readsFail = true;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).toEqual(["GET"]);
	});
	it("blocks a mismatched resume ID before delete", async () => {
		const r = await invoke({
			payload: payload("https_auto_cert"),
			onImmutableSelectionChange: "recreate",
			replacementId: "../../outside",
		});
		expect(r.isError).toBe(true);
		expect(methods).toEqual([]);
	});
	it("blocks missing UID and version", async () => {
		delete current.system_metadata.uid;
		delete current.resource_version;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).not.toContain("DELETE");
	});
	it("validates target field types before deleting", async () => {
		const p = payload("http");
		current = resource("https");
		(p.spec as any).http = { port: "invalid" };
		const r = await invoke({ payload: p, onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).not.toContain("DELETE");
	});

	for (const from of types)
		for (const to of types)
			if (from !== to)
				it(`${from} to ${to} never PUTs`, async () => {
					current = resource(from);
					const result = await invoke({ payload: payload(to), onImmutableSelectionChange: "recreate" });
					expect(result.isError).not.toBe(true);
					expect(methods).toEqual(["GET", "GET", "DELETE", "GET", "POST", "GET"]);
					expect(current.spec[to]).toBeDefined();
					expect(current.spec.domains).toEqual(["example.test"]);
					expect(current.metadata.labels).toEqual({ team: "demo" });
					expect(current.system_metadata.uid).toBe("new");
				});
	it("keeps same-type child edits on PUT", async () => {
		await invoke({ payload: { ...payload("http"), spec: { http: { port: 8080 } } } });
		expect(methods).toEqual(["GET", "PUT"]);
	});
	it("requires recreation from direct callers", async () => {
		const r = await invoke({ payload: payload("https_auto_cert") });
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r)).toContain("replacement_required");
		expect(methods).toEqual(["GET"]);
	});
	for (const selection of [{}, { http: {}, https: {} }])
		it("rejects invalid selection without mutation", async () => {
			const r = await invoke({
				payload: { metadata: { name: "demo", namespace: "demo-app" }, spec: selection },
				onImmutableSelectionChange: "recreate",
			});
			expect(r.isError).toBe(true);
			expect(methods.every(m => m === "GET")).toBe(true);
		});
	it("rejects mismatched identity", async () => {
		const p = payload("https_auto_cert");
		p.metadata.name = "other";
		const r = await invoke({ payload: p, onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).not.toContain("DELETE");
	});
	it("rejects mismatched context before network", async () => {
		const r = await invoke({
			contextName: "wrong",
			payload: payload("https_auto_cert"),
			onImmutableSelectionChange: "recreate",
		});
		expect(r.isError).toBe(true);
		expect(methods).toEqual([]);
	});
	it("rejects concurrent changes before delete", async () => {
		concurrent = true;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).not.toContain("DELETE");
	});
	it("does not create after a failed DELETE", async () => {
		failDelete = true;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(methods).not.toContain("POST");
	});
	it("requires the pending ID instead of starting a new deletion", async () => {
		failPost = true;
		const first = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		failPost = false;
		const second = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(second.isError).toBe(true);
		expect(second.details?.replacementId).toBe(first.details?.replacementId);
		expect(methods.filter(m => m === "DELETE")).toHaveLength(1);
	});
	it("requires certificate readiness before reporting automatic HTTPS complete", async () => {
		const native = globalThis.fetch;
		globalThis.fetch = Object.assign(
			async (url: any, init: any) => {
				const r = await native(url, init);
				if (current?.system_metadata?.uid === "new")
					current.spec.auto_cert_info = { auto_cert_state: "DomainChallengePending" };
				return r;
			},
			{ preconnect: () => {} },
		) as typeof fetch;
		const result = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(result.isError).toBe(true);
		expect(result.details?.replacementStage).toBe("verifying");
	}, 15000);
	it("resumes a failed POST without another DELETE and masks secrets", async () => {
		failPost = true;
		const r = await invoke({ payload: payload("https_auto_cert"), onImmutableSelectionChange: "recreate" });
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r)).not.toContain("private-test-token");
		const id = (r.details as any).replacementId;
		expect(id).toBeDefined();
		const files = await fs.readdir(directory);
		expect(files.filter(f => f.endsWith(".json"))).toHaveLength(1);
		const receipt = await fs.readFile(path.join(directory, `${id}.json`), "utf8");
		expect(receipt).not.toContain("private-test-token");
		expect(receipt).not.toContain("domains");
		failPost = false;
		const repaired = await invoke({
			payload: payload("https_auto_cert"),
			onImmutableSelectionChange: "recreate",
			replacementId: id,
		});
		expect(repaired.isError).not.toBe(true);
		expect(methods.filter(m => m === "DELETE")).toHaveLength(1);
	});
});
