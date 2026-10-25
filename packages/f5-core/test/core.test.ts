import { describe, expect, test } from "bun:test";
import type { HttpTransportRequest } from "@f5-sales-demo/pi-resource-management";
import { type ContextSnapshot, type CoreHost, type CoreReceipt, F5Core } from "../src/index";

const manifest = () => ({
	kind: "http_loadbalancer",
	metadata: { name: "synthetic-lb", namespace: "default" },
	spec: { domains: ["example.invalid"], routes: [], origin_pools: [] },
});
function fixture() {
	let context: ContextSnapshot = {
		active: true,
		workspaceId: "workspace-a",
		contextId: "context-a",
		revision: "1",
		apiUrl: "https://example.invalid",
		namespace: "default",
	};
	const requests: HttpTransportRequest[] = [];
	const receipts: unknown[] = [];
	const resources = new Map<string, Record<string, unknown>>();
	let token = "synthetic-credential";
	let skipReadback = false;
	let responseUid = "uid-a";
	let persistenceHook: (receipt: CoreReceipt) => Promise<void> | void = () => {};
	let approve: CoreHost["approve"] = async plan => ({ approved: true, planHash: plan.hash });
	let failPersistence = false;
	let failWrite = false;
	let failCredentials = false;
	const host: CoreHost = {
		getContext: () => context,
		getCredentials: async () => {
			if (failCredentials) throw new Error("synthetic-credential");
			return { apiToken: token };
		},
		approve: (plan, signal) => approve(plan, signal),
		persist: async receipt => {
			if (failPersistence) throw Error("private-path");
			await persistenceHook(receipt);
			receipts.push(receipt);
		},
		transport: {
			request: async request => {
				requests.push(structuredClone(request));
				const name = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1)!);
				const existing = resources.get(name);
				if (request.method === "GET")
					return existing ? { httpStatus: 200, body: existing } : { httpStatus: 404, body: {} };
				if (failWrite) throw Error("synthetic-credential");
				if (request.method === "DELETE") {
					resources.delete(name);
					return { httpStatus: 200, body: {} };
				}
				const metadata = request.body!.metadata as Record<string, unknown>;
				const resource = { ...request.body, system_metadata: { uid: responseUid, resource_version: "1" } };
				if (!skipReadback) resources.set(String(metadata.name), resource);
				return { httpStatus: 200, body: resource };
			},
		},
	};
	return {
		core: new F5Core(host),
		requests,
		receipts,
		setContext: (value: Partial<ContextSnapshot>) => {
			context = { ...context, ...value };
		},
		setResource: (value: Record<string, unknown>) => {
			resources.set(String((value.metadata as Record<string, unknown>).name), value);
		},
		setToken: (value: string) => {
			token = value;
		},
		setReadbackFailure: () => {
			skipReadback = true;
		},
		setResponseUid: (value: string) => {
			responseUid = value;
		},
		setPersistenceHook: (hook: typeof persistenceHook) => {
			persistenceHook = hook;
		},
		setApproval: (value: CoreHost["approve"]) => {
			approve = value;
		},
		setPersistenceFailure: () => {
			failPersistence = true;
		},
		setWriteFailure: () => {
			failWrite = true;
		},
		setCredentialFailure: () => {
			failCredentials = true;
		},
	};
}

describe("bound specification-backed operations", () => {
	test("offline bundled specification validates actual F5 constraints", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a");
		expect((await f.core.validate(binding, [manifest()]))[0]?.valid).toBe(true);
		const invalid = manifest();
		invalid.spec = {
			...invalid.spec,
			more_option: { custom_errors: { "200": "/error.html" } },
		} as typeof invalid.spec;
		expect((await f.core.validate(binding, [invalid]))[0]?.errors.some(error => error.code === "INVALID_MAP")).toBe(
			true,
		);
		expect(f.requests).toHaveLength(0);
	});
	test("exact approval dispatches once and consumes the plan", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		expect(f.requests.every(request => request.method === "GET")).toBe(true);
		expect((await f.core.execute(binding, plan.id)).results[0]?.status).toBe("created");
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "PLAN_CONSUMED" });
		expect(f.requests.filter(request => request.method === "POST")).toHaveLength(1);
		expect(JSON.stringify(f.receipts)).not.toContain("synthetic-credential");
	});
	test("changed or canceled approvals never write", async () => {
		for (const approved of [false, true]) {
			const f = fixture(),
				binding = await f.core.bind("conversation-a"),
				plan = await f.core.plan(binding, "create", [manifest()]);
			f.setApproval(async () => ({ approved, planHash: "changed-plan" }));
			await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({
				code: approved ? "APPROVAL_MISMATCH" : "APPROVAL_CANCELED",
			});
			expect(f.requests.some(request => request.method !== "GET")).toBe(false);
		}
	});
	test("recheck context after approval and immediately before writes", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setApproval(async p => {
			f.setContext({ revision: "2" });
			return { approved: true, planHash: p.hash };
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "STALE_BINDING" });
		expect(f.requests.some(request => request.method !== "GET")).toBe(false);
	});
	test("workspace and conversation bindings cannot be substituted", async () => {
		const f = fixture(),
			a = await f.core.bind("conversation-a"),
			b = await f.core.bind("conversation-b"),
			plan = await f.core.plan(a, "create", [manifest()]);
		await expect(f.core.execute(b, plan.id)).rejects.toMatchObject({ code: "PLAN_BINDING_MISMATCH" });
		f.setContext({ workspaceId: "workspace-b" });
		await expect(f.core.validate(a, [manifest()])).rejects.toMatchObject({ code: "STALE_BINDING" });
	});
	test("remote changes invalidate an approved update", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			current = {
				metadata: manifest().metadata,
				spec: { ...manifest().spec, domains: ["old.invalid"] },
				system_metadata: { uid: "uid-a", resource_version: "1" },
			};
		f.setResource(current);
		const plan = await f.core.plan(binding, "update", [manifest()]);
		f.setApproval(async p => {
			f.setResource({ ...current, system_metadata: { uid: "uid-a", resource_version: "2" } });
			return { approved: true, planHash: p.hash };
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "STALE_RESOURCE" });
		expect(f.requests.some(request => request.method === "PUT")).toBe(false);
	});
	test("credential and persistence failures prevent dispatch", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a");
		f.setCredentialFailure();
		await expect(f.core.plan(binding, "create", [manifest()])).rejects.toMatchObject({
			code: "CREDENTIALS_UNAVAILABLE",
		});
		expect(f.requests).toHaveLength(0);
		const g = fixture(),
			bound = await g.core.bind("conversation-a"),
			plan = await g.core.plan(bound, "create", [manifest()]);
		g.setPersistenceFailure();
		await expect(g.core.execute(bound, plan.id)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
		expect(g.requests.some(r => r.method !== "GET")).toBe(false);
	});
	test("an uncertain mutation is never retried", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setWriteFailure();
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "UNCERTAIN_MUTATION" });
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "PLAN_CONSUMED" });
		expect(f.requests.filter(request => request.method === "POST")).toHaveLength(1);
	});
	test("aborted approval settles without waiting for its callback", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]),
			controller = new AbortController();
		let started!: () => void;
		const ready = new Promise<void>(resolve => {
			started = resolve;
		});
		f.setApproval(async () => {
			started();
			return await new Promise(() => {});
		});
		const executing = f.core.execute(binding, plan.id, controller.signal);
		await ready;
		controller.abort();
		await expect(executing).rejects.toMatchObject({ code: "CANCELED" });
		expect(f.requests.some(request => request.method !== "GET")).toBe(false);
	});
	test("namespace escapes and immutable selection changes are rejected", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			other = { ...manifest(), metadata: { ...manifest().metadata, namespace: "system" } };
		await expect(f.core.plan(binding, "create", [other])).rejects.toMatchObject({ code: "NAMESPACE_MISMATCH" });
		const current = {
			metadata: manifest().metadata,
			spec: { ...manifest().spec, http: {} },
			system_metadata: { uid: "uid-a", resource_version: "1" },
		};
		f.setResource(current);
		const change = { ...manifest(), spec: { ...manifest().spec, https: {} } };
		await expect(f.core.plan(binding, "update", [change])).rejects.toMatchObject({ code: "IMMUTABLE_CHANGE" });
	});
});

describe("dispatch and disclosure boundaries", () => {
	test("context change while the dispatch receipt is persisted prevents the write", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setPersistenceHook(receipt => {
			if (receipt.stage === "dispatching") f.setContext({ revision: "2" });
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "STALE_BINDING" });
		expect(f.requests.some(request => request.method !== "GET")).toBe(false);
	});
	test("credential rotation invalidates approval even if the host forgot to bump its revision", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setApproval(async value => {
			f.setToken("rotated-synthetic-credential");
			return { approved: true, planHash: value.hash };
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
		expect(f.requests.some(request => request.method !== "GET")).toBe(false);
	});
	test("a plan admits only one concurrent execution", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		const outcomes = await Promise.allSettled([f.core.execute(binding, plan.id), f.core.execute(binding, plan.id)]);
		expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(f.requests.filter(request => request.method === "POST")).toHaveLength(1);
	});
	test("HTTP success without independent resource readback is uncertain", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setReadbackFailure();
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "UNCERTAIN_MUTATION" });
		expect(f.requests.filter(request => request.method === "POST")).toHaveLength(1);
	});
	test("persistence failure after a write requires reconciliation", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setPersistenceHook(receipt => {
			if (receipt.stage === "verified") throw Error("private-path");
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({
			code: "UNCERTAIN_MUTATION",
			completed: 1,
		});
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "PLAN_CONSUMED" });
	});
	test("secret references restore only within the originating conversation binding", async () => {
		const f = fixture(),
			a = await f.core.bind("conversation-a"),
			b = await f.core.bind("conversation-b");
		const metadata = { ...manifest().metadata, annotations: { "test-secret": "synthetic-private-value" } };
		f.setResource({
			metadata,
			spec: { ...manifest().spec, domains: ["old.invalid"] },
			system_metadata: { uid: "uid-a", resource_version: "1" },
		});
		const inspected = (await f.core.inspect(a, "http_loadbalancer", "synthetic-lb")) as {
			resource: { metadata: { annotations: Record<string, string> } };
		};
		const reference = inspected.resource.metadata.annotations["test-secret"]!;
		expect(reference).toMatch(/^#[a-f0-9]{16}#$/);
		const desired = { ...manifest(), metadata: { ...metadata, annotations: { "test-secret": reference } } };
		await expect(f.core.plan(b, "update", [desired])).rejects.toMatchObject({ code: "SECRET_REFERENCE_UNAVAILABLE" });
		const plan = await f.core.plan(a, "update", [desired]);
		const result = await f.core.execute(a, plan.id);
		expect(JSON.stringify(plan)).not.toContain("synthetic-private-value");
		expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
		expect(
			(result.results[0]?.resource?.metadata as { annotations: Record<string, string> } | undefined)?.annotations[
				"test-secret"
			],
		).toBe(reference);
		expect(JSON.stringify(f.receipts)).not.toContain("synthetic-private-value");
		expect(JSON.stringify(f.requests.find(request => request.method === "PUT")?.body)).toContain(
			"synthetic-private-value",
		);
	});
	test("deletion is approved and independently verifies absence", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a");
		f.setResource({
			metadata: manifest().metadata,
			spec: manifest().spec,
			system_metadata: { uid: "uid-a", resource_version: "1" },
		});
		const plan = await f.core.plan(binding, "delete", [manifest()]);
		expect((await f.core.execute(binding, plan.id)).results[0]?.status).toBe("deleted");
		expect(f.requests.filter(request => request.method === "DELETE")).toHaveLength(1);
	});
	test("non-JSON accessors and inactive contexts are rejected without running a request", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a");
		let getterRan = false;
		const input = Object.defineProperty({}, "kind", {
			enumerable: true,
			get() {
				getterRan = true;
				return "http_loadbalancer";
			},
		});
		await expect(f.core.validate(binding, [input])).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
		expect(getterRan).toBe(false);
		f.setContext({ active: false });
		await expect(f.core.bind("conversation-b")).rejects.toMatchObject({ code: "NO_ACTIVE_CONTEXT" });
		expect(f.requests).toHaveLength(0);
	});
});

describe("complete validation and cancellation", () => {
	test("schema field types are validated offline before credentials or requests", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			invalid = { ...manifest(), spec: { ...manifest().spec, http: { port: "invalid-port" } } };
		expect((await f.core.validate(binding, [invalid]))[0]?.valid).toBe(false);
		expect(f.requests).toHaveLength(0);
	});
	test("empty remote versions cannot authorize an update", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a");
		f.setResource({
			metadata: manifest().metadata,
			spec: manifest().spec,
			system_metadata: { uid: "uid-a", resource_version: "" },
		});
		await expect(f.core.plan(binding, "update", [manifest()])).rejects.toMatchObject({
			code: "RESOURCE_IDENTITY_UNAVAILABLE",
		});
	});
	test("readback with an empty UID cannot establish mutation acceptance", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]);
		f.setResponseUid("");
		await expect(f.core.execute(binding, plan.id)).rejects.toMatchObject({ code: "UNCERTAIN_MUTATION" });
	});
	test("cancellation settles while a dispatch receipt is pending", async () => {
		const f = fixture(),
			binding = await f.core.bind("conversation-a"),
			plan = await f.core.plan(binding, "create", [manifest()]),
			controller = new AbortController();
		let started!: () => void;
		const ready = new Promise<void>(resolve => {
			started = resolve;
		});
		f.setPersistenceHook(async receipt => {
			if (receipt.stage === "dispatching") {
				started();
				await new Promise(() => {});
			}
		});
		const execution = f.core.execute(binding, plan.id, controller.signal);
		await ready;
		controller.abort();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await expect(
				Promise.race([
					execution,
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(Error("Cancellation did not settle")), 1500);
					}),
				]),
			).rejects.toMatchObject({ code: "CANCELED" });
		} finally {
			if (timer) clearTimeout(timer);
		}
		expect(f.requests.some(request => request.method !== "GET")).toBe(false);
	});
});

test("secret values cannot corrupt generated plan control identifiers", async () => {
	const f = fixture(),
		binding = await f.core.bind("conversation-a"),
		input = { ...manifest(), metadata: { ...manifest().metadata, annotations: { "test-secret": "-" } } };
	const plan = await f.core.plan(binding, "create", [input]);
	expect(plan.id).toMatch(/^[a-f0-9-]{36}$/);
	expect(plan.binding).toBe(binding.id);
	expect((await f.core.execute(binding, plan.id)).success).toBe(true);
});

test("approval plans contain the exact reviewable configuration without exposing private values", async () => {
	const f = fixture(),
		binding = await f.core.bind("conversation-a");
	const input = {
		...manifest(),
		metadata: { ...manifest().metadata, annotations: { "test-secret": "synthetic-private-value" } },
	};
	const create = await f.core.plan(binding, "create", [input]);
	const configuration = create.entries[0]!.configuration!;
	expect(configuration.spec).toEqual(input.spec);
	expect(configuration.metadata).toMatchObject({ name: input.metadata.name, namespace: "default" });
	expect(JSON.stringify(create)).not.toContain("synthetic-private-value");
	expect(JSON.stringify(create)).not.toContain("synthetic-credential");
	expect(Object.isFrozen(configuration)).toBe(true);
	let reviewed = false;
	f.setApproval(async plan => {
		expect(plan).toBe(create);
		expect(plan.entries[0]!.configuration).toEqual(configuration);
		reviewed = true;
		return { approved: true, planHash: plan.hash };
	});
	await f.core.execute(binding, create.id);
	expect(reviewed).toBe(true);
	expect(f.requests.find(request => request.method === "POST")!.body).toMatchObject({
		metadata: input.metadata,
		spec: input.spec,
	});
	const update = await f.core.plan(binding, "update", [
		{ ...input, spec: { ...input.spec, domains: ["updated.invalid"] } },
	]);
	expect(update.entries[0]!.configuration!.spec).toMatchObject({ domains: ["updated.invalid"] });
	const deletion = await f.core.plan(binding, "delete", [input]);
	expect(deletion.entries[0]!.configuration).toBeUndefined();
	expect(deletion.entries[0]!.existingConfiguration!.spec).toEqual(input.spec);
	expect(JSON.stringify(deletion)).not.toContain("synthetic-private-value");
	f.core.dispose();
});
