import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { _resetShellSessionsForTest } from "../src/exec/bash-executor";
import { createAgentSession } from "../src/sdk";
import { SecretObfuscator } from "../src/secrets";
import { SessionManager } from "../src/session/session-manager";
import type { ToolSession } from "../src/tools";
import { XcshApiTool } from "../src/tools/xcsh-api";

describe("native API credential output masking", () => {
	const token = "SYNTHETIC-NATIVE-API-TOKEN";
	const configuredSecret = "SYNTHETIC-CONFIGURED-SECRET";
	let cacheDir: string;
	let server: ReturnType<typeof Bun.serve>;
	let requests: Array<{ method: string; authorization: string | null }>;
	let environment: Record<string, string>;
	let prior: Record<string, string | undefined>;
	const keys = ["XCSH_API_URL", "XCSH_API_TOKEN", "XCSH_NAMESPACE"];
	beforeEach(async () => {
		prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
		for (const key of keys) delete process.env[key];
		cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "native-api-masking-"));
		requests = [];
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				requests.push({ method: request.method, authorization: request.headers.get("authorization") });
				if (request.method === "HEAD") return new Response(null);
				const url = new URL(request.url);
				const body = await request.text();
				if (url.pathname.endsWith("/error")) return Response.json({ message: token }, { status: 400 });
				if (url.pathname.endsWith("/detail")) return Response.json({ echo: token, configuredSecret });
				if (body) return Response.json({ metadata: { name: token }, echo: token }, { status: 201 });
				return Response.json({ items: [{ name: token, namespace: "default" }], configuredSecret, echo: token });
			},
		});
		environment = { XCSH_API_URL: server.url.origin, XCSH_API_TOKEN: token, XCSH_NAMESPACE: "default" };
	});
	afterEach(async () => {
		server.stop(true);
		for (const key of keys) {
			if (prior[key] === undefined) delete process.env[key];
			else process.env[key] = prior[key];
		}
		await fs.rm(cacheDir, { recursive: true, force: true });
	});
	function tool(withObfuscator = true): XcshApiTool {
		return new XcshApiTool(
			{
				settings: { get: (key: string) => (key === "bash.environment" ? environment : undefined) },
				obfuscator: withObfuscator
					? new SecretObfuscator([{ type: "plain", content: configuredSecret }])
					: undefined,
			} as unknown as ToolSession,
			cacheDir,
		);
	}
	it("authenticates with the environment token while masking echoed response values", async () => {
		Object.assign(process.env, environment);
		const result = await tool().execute("single", { method: "GET", path: "/list", expandDiscovery: false });
		expect(requests.find(request => request.method === "GET")?.authorization).toBe(`APIToken ${token}`);
		expect(result.details?.status).toBe(200);
		expect(JSON.stringify(result)).not.toContain(token);
		expect(JSON.stringify(result)).not.toContain(configuredSecret);
	});
	it("masks context credentials in mutation labels, resolved payloads and errors without an obfuscator", async () => {
		const api = tool(false);
		const result = await api.execute("mutation", { method: "POST", path: "/list", payload: { echo: token } });
		expect(requests.find(request => request.method === "POST")?.authorization).toBe(`APIToken ${token}`);
		expect(result.details?.status).toBe(201);
		expect(JSON.stringify(result)).not.toContain(token);
		const error = await api.execute("error", { method: "GET", path: "/error", expandDiscovery: false });
		expect(error.isError).toBe(true);
		expect(JSON.stringify(error)).not.toContain(token);
	});
	it("masks batch results and the cache before persistence, including cache hits", async () => {
		const api = tool();
		const paths = ["/api/config/namespaces/default/http_loadbalancers"];
		const result = await api.execute("batch", { method: "GET", paths, params: { namespace: "default" } });
		expect(JSON.stringify(result)).not.toContain(token);
		const files = await fs.readdir(cacheDir);
		expect(files).toHaveLength(1);
		const cached = await fs.readFile(path.join(cacheDir, files[0]), "utf8");
		expect(cached).not.toContain(token);
		const before = requests.filter(request => request.method === "GET").length;
		const hit = await tool().execute("cache-hit", { method: "GET", paths, params: { namespace: "default" } });
		expect(requests.filter(request => request.method === "GET")).toHaveLength(before);
		expect(JSON.stringify(hit)).not.toContain(token);
	});
	it("masks detailed batch responses and HTTP errors", async () => {
		const result = await tool().execute("details", { method: "GET", paths: ["/detail", "/error"] });
		expect(result.details?.status).toBe(207);
		expect(JSON.stringify(result)).not.toContain(token);
		expect(JSON.stringify(result)).not.toContain(configuredSecret);
	});
	it("shares SDK environment masking with shell tools, including streamed output", async () => {
		Object.assign(process.env, environment);
		_resetSettingsForTest();
		const settings = await Settings.init({ inMemory: true, cwd: cacheDir, agentDir: cacheDir });
		settings.override("sandbox.enabled", false);
		settings.override("bash.environment", environment);
		const { session } = await createAgentSession({
			cwd: cacheDir,
			agentDir: cacheDir,
			settings,
			sessionManager: SessionManager.inMemory(cacheDir),
			toolNames: ["bash"],
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});
		try {
			const bash = session.agent.state.tools.find(tool => tool.name === "bash")!;
			const updates: unknown[] = [];
			const result = await bash.execute(
				"sdk-shell",
				{
					command:
						'curl --silent --show-error "$XCSH_API_URL/detail" --header "Authorization: APIToken $XCSH_API_TOKEN"',
				},
				undefined,
				update => updates.push(update),
			);
			expect(requests.find(request => request.method === "GET")?.authorization).toBe(`APIToken ${token}`);
			expect(JSON.stringify(result)).not.toContain(token);
			expect(JSON.stringify(updates)).not.toContain(token);
		} finally {
			await session.dispose();
			_resetShellSessionsForTest();
			_resetSettingsForTest();
		}
	});
});
