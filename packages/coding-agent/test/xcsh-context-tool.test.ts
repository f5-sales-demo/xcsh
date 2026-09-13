import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { applyRemotePermissionProfile } from "../src/sandbox/remote-permissions";
import { ContextService } from "../src/services/xcsh-context";
import { XcshApiTool } from "../src/tools/xcsh-api";
import { XcshContextTool } from "../src/tools/xcsh-context";

let root: string;
let settings: Settings;
let service: ContextService;
let tool: XcshContextTool;
let plan = false;
const originalFetch = globalThis.fetch;
const env: Record<string, string | undefined> = {};
const requests: Array<{ url: string; authorization: string | null }> = [];
let httpStatus = 200;

beforeEach(async () => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	for (const key of Object.keys(process.env).filter(key => key.startsWith("XCSH_"))) {
		env[key] = process.env[key];
		delete process.env[key];
	}
	root = mkdtempSync(join(tmpdir(), "xcsh-context-tool-"));
	settings = await Settings.init({ cwd: root, agentDir: root, inMemory: true });
	service = ContextService.init(join(root, "config"));
	plan = false;
	httpStatus = 200;
	requests.length = 0;
	globalThis.fetch = (async (input, init) => {
		requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
		return Response.json({ items: [] }, { status: httpStatus });
	}) as typeof fetch;
	for (const name of ["alpha", "beta"]) {
		await service.createContext({
			name,
			apiUrl: `https://${name}.console.ves.volterra.io`,
			apiToken: `synthetic-${name}`,
			defaultNamespace: `example-${name}`,
			env: { XCSH_PRIVATE: "synthetic-private" },
			sensitiveKeys: ["XCSH_PRIVATE"],
		});
	}
	tool = new XcshContextTool({
		cwd: root,
		settings,
		getContextService: async () => service,
		getPlanModeState: () => (plan ? { enabled: true, planFilePath: join(root, "plan.md") } : undefined),
	} as never);
});

afterEach(() => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	globalThis.fetch = originalFetch;
	for (const key of Object.keys(process.env).filter(key => key.startsWith("XCSH_"))) delete process.env[key];
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) process.env[key] = value;
		delete env[key];
	}
	rmSync(root, { recursive: true, force: true });
});

function ask() {
	applyRemotePermissionProfile(settings, {
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: [root],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		},
		activePermissionProfile: { id: ":workspace" },
	});
}

function ui(select: () => Promise<string>) {
	return { hasUI: true, ui: { select } } as never;
}

test("list and status expose no credentials and do not activate or validate", async () => {
	for (const action of ["list", "status"] as const) {
		const result = await tool.execute("read", { action });
		expect(JSON.stringify(result)).not.toContain("synthetic-");
		expect(JSON.stringify(result)).not.toContain("XCSH_PRIVATE");
	}
	expect(service.getStatus().activeContextName).toBeNull();
	expect(requests).toHaveLength(0);
});

test("activation uses the slash-command service and the next existing API tool sees the new credentials", async () => {
	await service.activate("alpha");
	const api = new XcshApiTool({ settings } as never, join(root, "cache"));
	const result = await tool.execute("switch", { action: "activate", name: "beta" });
	expect(JSON.stringify(result)).not.toContain("synthetic-");
	expect(result.details).toMatchObject({ activeContextName: "beta", authStatus: "connected" });
	await api.execute("query", { method: "GET", path: "/api/config/namespaces/{namespace}/http_loadbalancers" });
	expect(requests.at(-1)).toEqual({
		url: "https://beta.console.ves.volterra.io/api/config/namespaces/example-beta/http_loadbalancers",
		authorization: "APIToken synthetic-beta",
	});
	expect(service.previousContextName).toBe("alpha");
	await tool.execute("next-turn", { action: "status" });
	expect(service.getStatus().activeContextName).toBe("beta");
});

test("unknown context leaves the previous target intact", async () => {
	await service.activate("alpha");
	await expect(tool.execute("missing", { action: "activate", name: "absent" })).rejects.toThrow("not found");
	expect(service.getStatus().activeContextName).toBe("alpha");
});

test("authentication failure reports the selected target without claiming connectivity", async () => {
	httpStatus = 401;
	const result = await tool.execute("switch", { action: "activate", name: "beta" });
	expect(result.details).toMatchObject({ activeContextName: "beta", authStatus: "auth_error" });
	expect(JSON.stringify(result)).not.toContain("synthetic-");
});

test("environment endpoint override blocks selection", async () => {
	process.env.XCSH_API_URL = "https://override.example.test";
	await expect(tool.execute("switch", { action: "activate", name: "beta" })).rejects.toThrow("XCSH_API_URL");
	expect(service.getStatus().activeContextName).not.toBe("beta");
});

test("effective credential and namespace overrides are reflected and validated", async () => {
	process.env.XCSH_API_TOKEN = "synthetic-override";
	process.env.XCSH_NAMESPACE = "override-namespace";
	const result = await tool.execute("switch", { action: "activate", name: "beta" });
	expect(result.details).toMatchObject({ credentialSource: "mixed", activeContextNamespace: "override-namespace" });
	expect(requests.every(request => request.authorization === "APIToken synthetic-override")).toBe(true);
	expect(JSON.stringify(result)).not.toContain("synthetic-");
});

test("Plan permits inspection but blocks activation", async () => {
	plan = true;
	await tool.execute("read", { action: "list" });
	await expect(tool.execute("switch", { action: "activate", name: "beta" })).rejects.toThrow("Plan mode");
});

test.each(["decline", "cancel", "plan", "changed-target", "changed-active", "allow"])(
	"Ask checks %s after approval and before commit",
	async scenario => {
		await service.activate("alpha");
		ask();
		const abort = new AbortController();
		const pending = tool.execute(
			"switch",
			{ action: "activate", name: "beta" },
			abort.signal,
			undefined,
			ui(async () => {
				if (scenario === "cancel") abort.abort();
				if (scenario === "plan") plan = true;
				if (scenario === "changed-target") {
					const file = join(root, "config/contexts/beta.json");
					const data = JSON.parse(readFileSync(file, "utf8"));
					data.apiToken = "synthetic-replaced";
					writeFileSync(file, JSON.stringify(data));
				}
				if (scenario === "changed-active") await service.activate("alpha");
				return scenario === "decline" ? "Decline" : "Allow once";
			}),
		);
		if (scenario === "allow") {
			await pending;
			expect(service.getStatus().activeContextName).toBe("beta");
		} else {
			await expect(pending).rejects.toThrow();
			expect(service.getStatus().activeContextName).toBe("alpha");
		}
	},
);

test("already cancelled request never activates", async () => {
	const abort = new AbortController();
	abort.abort();
	await expect(tool.execute("switch", { action: "activate", name: "beta" }, abort.signal)).rejects.toThrow(
		"cancelled",
	);
	expect(service.getStatus().activeContextName).toBeNull();
});

test("a scoped resource question can retain creator metadata without expanding unrelated resource types", async () => {
	await service.activate("beta");
	const api = new XcshApiTool({ settings } as never, join(root, "cache"));
	const paths: string[] = [];
	globalThis.fetch = (async (input, init) => {
		if (init?.method !== "HEAD") paths.push(new URL(String(input)).pathname);
		return Response.json({
			items: [{ name: "example-lb", namespace: "example-beta", creator_id: "synthetic-human" }],
		});
	}) as typeof fetch;
	const result = await api.execute("scoped", {
		method: "GET",
		path: "/api/config/namespaces/{namespace}/http_loadbalancers",
		params: { namespace: "example-beta" },
		expandDiscovery: false,
	});
	expect(paths).toEqual(["/api/config/namespaces/example-beta/http_loadbalancers"]);
	expect(result.content.find(c => c.type === "text")?.text).toContain('"creator_id":"synthetic-human"');
});

test("a resource query bound to the requested context cannot run against the previous tenant", async () => {
	await service.activate("alpha");
	const api = new XcshApiTool(
		{ settings, getActiveTools: () => ["xcsh_api", "xcsh_context"] } as never,
		join(root, "cache"),
	);
	requests.length = 0;
	const result = await api.execute("wrong-target", {
		method: "GET",
		path: "/api/config/namespaces/{namespace}/http_loadbalancers",
		contextName: "beta",
		expandDiscovery: false,
	});
	expect(result.isError).toBe(true);
	expect(requests).toHaveLength(0);
	expect(result.content.find(c => c.type === "text")?.text).toContain('"contextSelectionToolAvailable":true');
});

test("Ask without an approval owner cannot activate", async () => {
	ask();
	await expect(tool.execute("no-ui", { action: "activate", name: "beta" })).rejects.toThrow("approval unavailable");
	expect(service.getStatus().activeContextName).toBeNull();
});

test("late authentication results cannot mark a different selected context connected", async () => {
	await service.activate("alpha");
	let release!: (response: Response) => void;
	let held = false;
	globalThis.fetch = (async () => {
		if (!held) {
			held = true;
			return new Promise<Response>(resolve => {
				release = resolve;
			});
		}
		return Response.json({}, { status: 401 });
	}) as unknown as typeof fetch;
	const oldValidation = service.validateToken();
	await service.activate("beta");
	await service.validateToken();
	release(Response.json({ items: [] }));
	await oldValidation;
	expect(service.getStatus()).toMatchObject({ activeContextName: "beta", authStatus: "auth_error" });
});

test("batched detail reads preserve creator metadata and mixed failures instead of returning an empty inventory", async () => {
	await service.activate("beta");
	const api = new XcshApiTool({ settings } as never, join(root, "cache"));
	globalThis.fetch = (async input =>
		new URL(String(input)).pathname.endsWith("/example-denied")
			? Response.json({ message: "denied" }, { status: 403 })
			: Response.json({
					metadata: { name: "example-lb", namespace: "demo-app" },
					system_metadata: { creator_id: "synthetic-human" },
				})) as typeof fetch;
	const result = await api.execute("details", {
		method: "GET",
		contextName: "beta",
		params: { namespace: "demo-app" },
		paths: [
			"/api/config/namespaces/{namespace}/http_loadbalancers/example-lb",
			"/api/config/namespaces/{namespace}/http_loadbalancers/example-denied",
		],
	});
	const text = result.content.find(c => c.type === "text")?.text ?? "";
	expect(text).toContain('"creator_id":"synthetic-human"');
	expect(text).toContain('"status":403');
	expect(text).not.toContain("0 confirmed member");
	expect(result.details).toMatchObject({ batchSize: 2, batchSuccessCount: 1 });
});

test("a denied batch is an error, not a successful empty inventory", async () => {
	await service.activate("beta");
	const api = new XcshApiTool({ settings } as never, join(root, "cache"));
	globalThis.fetch = (async () => Response.json({ message: "denied" }, { status: 403 })) as unknown as typeof fetch;
	const result = await api.execute("denied", {
		method: "GET",
		paths: ["/api/config/namespaces/{namespace}/http_loadbalancers"],
		params: { namespace: "demo-app" },
	});
	expect(result.isError).toBe(true);
	expect(result.content.find(c => c.type === "text")?.text).toContain("403");
});

test("tenant-wide discovery propagates denied namespace queries", async () => {
	await service.activate("beta");
	const api = new XcshApiTool({ settings } as never, join(root, "cache"));
	globalThis.fetch = (async input =>
		new URL(String(input)).pathname.endsWith("/namespaces")
			? Response.json({ items: [{ name: "demo-app" }] })
			: Response.json({}, { status: 403 })) as typeof fetch;
	const result = await api.execute("denied-all", {
		method: "GET",
		paths: ["/api/config/namespaces/{namespace}/http_loadbalancers"],
		params: { namespace: "*" },
	});
	expect(result.isError).toBe(true);
	expect(result.content.find(c => c.type === "text")?.text).toContain("incomplete");
});
