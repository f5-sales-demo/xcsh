import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { applyRemotePermissionProfile } from "../src/sandbox/remote-permissions";
import { createAgentSession } from "../src/sdk";
import { ContextService } from "../src/services/xcsh-context";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
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

test("status recognizes explicit environment credentials before saved-context loading", async () => {
	process.env.XCSH_API_URL = "https://example.console.ves.volterra.io";
	process.env.XCSH_API_TOKEN = "synthetic-environment-token";
	const result = await tool.execute("environment-status", { action: "status" });
	const status = result.details as { credentialSource: string; isConfigured: boolean; authStatus: string };
	expect(status.credentialSource).toBe("environment");
	expect(status.isConfigured).toBe(true);
	expect(status.authStatus).toBe("unknown");
});

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

test("reusing the same effective context validates without approval or pointer writes", async () => {
	await service.activate("alpha");
	ask();
	const contextPath = join(root, "config/contexts/alpha.json");
	const before = readFileSync(contextPath);
	const revisionBefore = service.prepareActivation("alpha").revision;
	let approvals = 0;
	const result = await tool.execute(
		"same-context",
		{ action: "activate", name: "alpha" },
		undefined,
		undefined,
		ui(async () => {
			approvals++;
			return "Allow once";
		}),
	);
	expect(approvals).toBe(0);
	expect(readFileSync(contextPath)).toEqual(before);
	expect(service.prepareActivation("alpha").revision).toBe(revisionBefore);
	expect(service.previousContextName).toBeNull();
	expect(result.details).toMatchObject({ activeContextName: "alpha", authStatus: "connected" });
});

test("explicit reactivation validates changed saved credentials without another approval", async () => {
	await service.activate("alpha");
	ask();
	const targetPath = join(root, "config/contexts/alpha.json");
	const saved = JSON.parse(readFileSync(targetPath, "utf8"));
	saved.apiToken = "synthetic-replaced-alpha";
	writeFileSync(targetPath, JSON.stringify(saved));
	let approvals = 0;
	await tool.execute(
		"changed-context",
		{ action: "activate", name: "alpha" },
		undefined,
		undefined,
		ui(async () => {
			approvals++;
			return "Allow once";
		}),
	);
	expect(approvals).toBe(0);
	expect(requests.at(-1)?.authorization).toBe("APIToken synthetic-replaced-alpha");
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

test.each(["cancel", "plan", "changed-target"])(
	"explicit activation checks %s before committing selection",
	async scenario => {
		await service.activate("alpha");
		ask();
		const abort = new AbortController();
		const original = service.activate.bind(service);
		service.activate = async (...args) => {
			if (scenario === "cancel") abort.abort();
			if (scenario === "plan") plan = true;
			if (scenario === "changed-target") {
				const file = join(root, "config/contexts/beta.json");
				const data = JSON.parse(readFileSync(file, "utf8"));
				data.apiToken = "synthetic-replaced";
				writeFileSync(file, JSON.stringify(data));
			}
			return original(...args);
		};
		await expect(tool.execute("switch", { action: "activate", name: "beta" }, abort.signal)).rejects.toThrow();
		expect(service.getStatus().activeContextName).toBe("alpha");
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
test("full SDK voice combined request activates before querying the new tenant", async () => {
	await service.activate("alpha");
	const auth = await AuthStorage.create(":memory:");
	auth.setRuntimeApiKey("openai", "synthetic-key");
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: join(root, "agent"),
		settings,
		sessionManager: SessionManager.inMemory(root),
		model,
		modelRegistry: new ModelRegistry(auth),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableLsp: false,
		toolNames: ["xcsh_context", "xcsh_api"],
	});
	let inference = 0;
	session.agent.streamFn = m => {
		const stream = new AssistantMessageEventStream();
		const turn = inference++;
		const content =
			turn === 0
				? [
						{
							type: "toolCall",
							id: "activate",
							name: "xcsh_context",
							arguments: { action: "activate", name: "beta" },
						},
					]
				: turn === 1
					? [
							{
								type: "toolCall",
								id: "query",
								name: "xcsh_api",
								arguments: {
									method: "GET",
									path: "/api/config/namespaces/{namespace}/http_loadbalancers",
									contextName: "beta",
									expandDiscovery: false,
								},
							},
						]
					: [{ type: "text", text: "verified" }];
		const message: any = {
			role: "assistant",
			content,
			model: m.id,
			provider: m.provider,
			api: m.api,
			timestamp: Date.now(),
			stopReason: turn < 2 ? "toolUse" : "stop",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason, message }));
		return stream;
	};
	try {
		session.setRealtimeMode(true, {});
		await session.prompt("Apply the beta context and list its load balancers.");
		await session.waitForIdle();
		const result: any = session.messages.find((m: any) => m.role === "toolResult" && m.toolCallId === "query");
		expect(result).toBeDefined();
		expect(result.isError).toBe(false);
		expect(
			requests.some(
				r => r.url === "https://beta.console.ves.volterra.io/api/config/namespaces/example-beta/http_loadbalancers",
			),
		).toBe(true);
		expect(requests.some(r => r.url.includes("alpha.console") && r.url.includes("http_loadbalancers"))).toBe(false);
	} finally {
		await session.dispose();
		auth.close();
	}
});

test("status returns the active session workspace rather than the host process directory", async () => {
	const result = await tool.execute("workspace-status", { action: "status" });
	expect(root).not.toBe(process.cwd());
	expect(result.details).toMatchObject({ workspace: root, activeContextName: null });
	const content = result.content[0];
	if (content.type !== "text") throw new Error("Expected text context status");
	expect(JSON.parse(content.text)).toMatchObject({ workspace: root });
	expect(service.getStatus().activeContextName).toBeNull();
	expect(requests).toHaveLength(0);
});

test("unchanged project-local context validates without a global selection approval", async () => {
	const local = join(root, ".xcsh/contexts");
	mkdirSync(local, { recursive: true });
	writeFileSync(join(local, "alpha.json"), readFileSync(join(root, "config/contexts/alpha.json")));
	writeFileSync(join(local, "active_context"), "alpha");
	await service.loadActive(root);
	ask();
	const before = service.prepareActivation("alpha").revision;
	let approvals = 0;
	const result = await tool.execute(
		"local-repeat",
		{ action: "activate", name: "alpha" },
		undefined,
		undefined,
		ui(async () => {
			approvals++;
			return "Allow once";
		}),
	);
	expect(approvals).toBe(0);
	expect(service.prepareActivation("alpha").revision).toBe(before);
	expect(result.details).toMatchObject({ activeContextSource: "local", authStatus: "connected" });
});

test("explicit named context activation under Ask executes without another permission question", async () => {
	await service.activate("alpha");
	ask();
	const activation = spyOn(service, "activate");
	const validation = spyOn(service, "validateToken");
	requests.length = 0;
	let approvals = 0;
	const result = await tool.execute(
		"explicit",
		{ action: "activate", name: "beta" },
		undefined,
		undefined,
		ui(async () => {
			approvals++;
			throw new Error("explicit activation must not ask again");
		}),
	);
	expect(approvals).toBe(0);
	expect(result.details).toMatchObject({ activeContextName: "beta", authStatus: "connected" });
	expect(activation).toHaveBeenCalledTimes(1);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(JSON.stringify(result)).not.toContain("synthetic-beta");
});
test("explicit named context activation works without an interactive approval owner", async () => {
	ask();
	const result = await tool.execute("headless-explicit", { action: "activate", name: "beta" });
	expect(result.details).toMatchObject({ activeContextName: "beta", authStatus: "connected" });
});
