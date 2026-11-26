import { afterEach, beforeEach, expect, test, vi } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { getProjectDir, setProjectDir } from "@f5-sales-demo/pi-utils";
import { withPluginContext } from "../src/cli/plugin-cli";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { _resetShellSessionsForTest, executeBash } from "../src/exec/bash-executor";
import { createContextEnv } from "../src/services/context-env";
import {
	captureContextExecution,
	captureNextContextExecution,
	executionEnvironmentValue,
	runWithContextExecution,
} from "../src/services/context-execution";
import { ContextService } from "../src/services/xcsh-context";
import { XcshApiTool } from "../src/tools/xcsh-api";

let directory: string;
let original: Record<string, string | undefined>;
const projectDir = getProjectDir();
const originalFetch = globalThis.fetch;

beforeEach(async () => {
	original = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("XCSH_")));
	for (const key of Object.keys(process.env)) if (key.startsWith("XCSH_")) delete process.env[key];
	directory = mkdtempSync(join(tmpdir(), "xcsh-context-authority-"));
	setProjectDir(directory);
	_resetSettingsForTest();
	await Settings.init({ cwd: directory, agentDir: join(directory, "agent"), inMemory: true });
	ContextService._resetForTest();
	ContextService.init(directory);
	globalThis.fetch = vi.fn(
		async () =>
			new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
	) as unknown as typeof fetch;
	await ContextService.instance.createContext({
		name: "a",
		apiUrl: "https://tenant-a.example.invalid",
		apiToken: "synthetic-a",
		defaultNamespace: "shared",
		env: { XCSH_REGION: "region-a" },
	});
	await ContextService.instance.createContext({
		name: "b",
		apiUrl: "https://tenant-b.example.invalid",
		apiToken: "synthetic-b",
		defaultNamespace: "demo-app",
	});
});

afterEach(() => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	_resetShellSessionsForTest();
	globalThis.fetch = originalFetch;
	for (const key of Object.keys(process.env)) if (key.startsWith("XCSH_")) delete process.env[key];
	Object.assign(process.env, original);
	setProjectDir(projectDir);
	fs.rmSync(directory, { recursive: true, force: true });
});

function conflictingEnvironment(): void {
	Object.assign(process.env, {
		XCSH_API_URL: "https://inherited.example.invalid",
		XCSH_API_TOKEN: "synthetic-inherited",
		XCSH_NAMESPACE: "ns-old",
		XCSH_TENANT: "inherited",
		XCSH_USERNAME: "inherited-login",
		XCSH_CONSOLE_PASSWORD: "synthetic-password",
		XCSH_REGION: "inherited-region",
		XCSH_LOCALE: "en",
		XCSH_BROWSER_PROVIDER: "synthetic-browser",
		XCSH_PLUGIN_GIT_TIMEOUT_MS: "1234",
	});
}

test("R6 shell removes inherited and cached F5 values absent from context B", async () => {
	process.env.XCSH_USERNAME = "inherited-login";
	await ContextService.instance.activate("a");
	await executeBash("export XCSH_STALE=synthetic-stale", { cwd: directory });
	await ContextService.instance.activate("b");
	const result = await executeBash(
		`printf "%s|%s|%s" "\${XCSH_USERNAME-unset}" "\${XCSH_STALE-unset}" "\${XCSH_REGION-unset}"`,
		{ cwd: directory },
	);
	expect(result.output).toBe("unset|unset|unset");
});

test("cached shell runtime controls survive context changes when absent from the parent environment", async () => {
	await ContextService.instance.activate("a");
	await executeBash("export XCSH_PLUGIN_GIT_TIMEOUT_MS=1234", { cwd: directory });
	await ContextService.instance.activate("b");
	const result = await executeBash('printf "%s" "$XCSH_PLUGIN_GIT_TIMEOUT_MS"', { cwd: directory });
	expect(result.output).toBe("1234");
});

test("automatic saved context wins conflicting F5 inputs and preserves runtime controls", async () => {
	fs.writeFileSync(ContextService.instance.activeContextPath, "a");
	conflictingEnvironment();
	const inherited = { ...process.env };
	expect((await ContextService.instance.loadActive(directory))?.name).toBe("a");
	const snapshot = captureContextExecution(Settings.instance);
	expect(snapshot.authority).toBe("context");
	expect(snapshot.environment).toMatchObject({
		XCSH_API_URL: "https://tenant-a.example.invalid",
		XCSH_API_TOKEN: "synthetic-a",
		XCSH_NAMESPACE: "shared",
		XCSH_TENANT: "tenant-a",
		XCSH_REGION: "region-a",
		XCSH_LOCALE: "en",
		XCSH_BROWSER_PROVIDER: "synthetic-browser",
		XCSH_PLUGIN_GIT_TIMEOUT_MS: "1234",
	});
	expect(snapshot.environment.XCSH_USERNAME).toBeUndefined();
	expect(snapshot.environment.XCSH_CONSOLE_PASSWORD).toBeUndefined();
	expect(createContextEnv(Settings.instance).getNonSensitiveVars()).toEqual({ XCSH_REGION: "region-a" });
	expect(ContextService.instance.getStatus()).toMatchObject({
		activeContextName: "a",
		credentialSource: "context",
		activeContextNamespace: "shared",
		activeContextTenant: "tenant-a",
	});
	expect(process.env).toEqual(inherited);
});

test("explicit activation and preview ignore inherited F5 authority", async () => {
	conflictingEnvironment();
	expect(ContextService.instance.prepareActivation("b").namespace).toBe("demo-app");
	await ContextService.instance.activate("b");
	const env = createContextEnv(Settings.instance);
	expect(env.get("XCSH_API_TOKEN")).toBe("synthetic-b");
	expect(env.get("XCSH_USERNAME")).toBeUndefined();
	expect(env.resolvePath("/api/{namespace}/{region}")).toBe("/api/demo-app/{region}");
	expect(env.resolvePayloadVars('{"region":"$XCSH_REGION"}')).toBe('{"region":"$XCSH_REGION"}');
	expect(executionEnvironmentValue("XCSH_API_URL")).toBe("https://tenant-b.example.invalid");
});

test("matching environment values and supplied context name do not apply a saved context", async () => {
	conflictingEnvironment();
	Object.assign(process.env, {
		XCSH_API_URL: "https://tenant-a.example.invalid",
		XCSH_API_TOKEN: "synthetic-a",
		XCSH_NAMESPACE: "shared",
		XCSH_TENANT: "tenant-a",
		XCSH_REGION: "region-a",
		XCSH_CONTEXT_NAME: "a",
	});
	delete process.env.XCSH_USERNAME;
	delete process.env.XCSH_CONSOLE_PASSWORD;
	const snapshot = captureContextExecution(Settings.instance);
	expect(snapshot.authority).toBe("environment");
	expect(snapshot.environment.XCSH_API_TOKEN).toBe("synthetic-a");
	expect(ContextService.instance.getStatus().activeContextName).toBeNull();
	const tool = new XcshApiTool(
		{ settings: Settings.instance, cwd: directory } as never,
		join(directory, "spoof-cache"),
	);
	const request = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
	request.mockClear();
	const unscoped = await tool.execute("unbound-direct-call", {
		contextName: "a",
		method: "GET",
		path: "/api/web/namespaces",
	});
	expect(unscoped.isError).toBe(true);
	expect(request).not.toHaveBeenCalled();
	const result = await runWithContextExecution(snapshot, () =>
		tool.execute("spoofed-context", {
			contextName: "a",
			method: "GET",
			path: "/api/config/namespaces/{namespace}/http_loadbalancers",
		}),
	);
	expect(result.isError).toBe(true);
	expect(request).not.toHaveBeenCalled();
	await ContextService.instance.activate("a");
	const next = captureContextExecution(Settings.instance);
	expect(next.authority).toBe("context");
	expect(next.environment).toEqual(snapshot.environment);
	const accepted = await runWithContextExecution(next, () =>
		tool.execute("applied-context", { contextName: "a", method: "GET", path: "/api/web/namespaces" }),
	);
	expect(accepted.isError).not.toBe(true);
});

test("automatic local context resolves before conflicting inherited credentials", async () => {
	conflictingEnvironment();
	const local = join(directory, ".xcsh", "contexts");
	fs.mkdirSync(local, { recursive: true });
	fs.writeFileSync(
		join(local, "local.json"),
		JSON.stringify({
			name: "local",
			apiUrl: "https://local.example.invalid",
			apiToken: "synthetic-local",
			defaultNamespace: "local-ns",
		}),
	);
	fs.writeFileSync(join(local, "active_context"), "local");
	expect((await ContextService.instance.loadActive(directory))?.name).toBe("local");
	expect(ContextService.instance.getStatus()).toMatchObject({
		activeContextSource: "local",
		credentialSource: "context",
		activeContextNamespace: "local-ns",
	});
});

test("actual API and PTY targeting use the applied context and command overrides stay isolated", async () => {
	conflictingEnvironment();
	await ContextService.instance.activate("b");
	const requests: Array<{ url: string; token: string | null }> = [];
	globalThis.fetch = vi.fn(async (url, init) => {
		requests.push({ url: String(url), token: new Headers(init?.headers).get("Authorization") });
		return new Response(JSON.stringify({ items: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
	const tool = new XcshApiTool({ settings: Settings.instance, cwd: directory } as never, join(directory, "api-cache"));
	const result = await tool.execute("synthetic-read", {
		method: "GET",
		path: "/api/config/namespaces/{namespace}/http_loadbalancers",
	});
	expect(result.isError).not.toBe(true);
	expect(
		requests.some(
			request =>
				request.url === "https://tenant-b.example.invalid/api/config/namespaces/demo-app/http_loadbalancers" &&
				request.token === "APIToken synthetic-b",
		),
	).toBe(true);
	expect(requests.every(request => request.url.startsWith("https://tenant-b.example.invalid/"))).toBe(true);
	const command = `printf "%s|%s" "$XCSH_NAMESPACE" "\${XCSH_USERNAME-unset}"`;
	const snapshot = captureContextExecution(Settings.instance);
	let output = "";
	const pty = new PtySession();
	const completed = await pty.start(
		{ command, cwd: directory, env: { ...snapshot.environment }, unsetEnvPrefixes: ["XCSH_"], cols: 80, rows: 24 },
		(_error, chunk) => {
			output += chunk;
		},
	);
	expect(completed.exitCode).toBe(0);
	expect(output).toBe("demo-app|unset");
	expect(
		(await executeBash('printf "%s" "$XCSH_NAMESPACE"', { cwd: directory, env: { XCSH_NAMESPACE: "per-call" } }))
			.output,
	).toBe("per-call");
	expect((await executeBash('printf "%s" "$XCSH_NAMESPACE"', { cwd: directory })).output).toBe("demo-app");
	expect(process.env.XCSH_NAMESPACE).toBe("ns-old");
});

test("R5 fresh process preserves context authority for absent empty nonempty and dotenv inputs", async () => {
	fs.writeFileSync(ContextService.instance.activeContextPath, "b");
	const script = [
		`import { Settings } from ${JSON.stringify(join(import.meta.dir, "../src/config/settings.ts"))};`,
		`import { ContextService } from ${JSON.stringify(join(import.meta.dir, "../src/services/xcsh-context.ts"))};`,
		`import { captureContextExecution } from ${JSON.stringify(join(import.meta.dir, "../src/services/context-execution.ts"))};`,
		'globalThis.fetch = async () => new Response("{}");',
		"await Settings.init({ cwd: process.cwd(), inMemory: true });",
		"const service = ContextService.init(process.cwd()); await service.loadActive();",
		"const env = captureContextExecution(Settings.instance).environment;",
		"console.log(JSON.stringify({ namespace: env.XCSH_NAMESPACE, token: env.XCSH_API_TOKEN, missing: env.XCSH_USERNAME, authority: captureContextExecution(Settings.instance).authority }));",
		"service.stopRevalidation();",
	].join("\n");
	for (const mode of ["absent", "empty", "nonempty", "dotenv"]) {
		const env: Record<string, string | undefined> = {
			...process.env,
			PI_CODING_AGENT_DIR: join(directory, "child-agent"),
		};
		delete env.XCSH_NAMESPACE;
		delete env.XCSH_API_TOKEN;
		delete env.XCSH_USERNAME;
		if (mode === "empty") {
			env.XCSH_NAMESPACE = "";
			env.XCSH_API_TOKEN = "";
		}
		if (mode === "nonempty") {
			env.XCSH_NAMESPACE = "inherited";
			env.XCSH_API_TOKEN = "synthetic-inherited";
		}
		if (mode === "dotenv")
			fs.writeFileSync(
				join(directory, ".env"),
				"XCSH_NAMESPACE=dotenv-ns\nXCSH_API_TOKEN=synthetic-dotenv\nXCSH_USERNAME=dotenv-login\n",
			);
		const child = Bun.spawn([process.execPath, "--eval", script], {
			cwd: directory,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, status] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(status, stderr).toBe(0);
		expect(JSON.parse(stdout.trim())).toEqual({ namespace: "demo-app", token: "synthetic-b", authority: "context" });
	}
});

test("R7 delayed retries and descendants keep A while namespace and context change", async () => {
	conflictingEnvironment();
	await ContextService.instance.activate("a");
	const admitted = captureContextExecution(Settings.instance);
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	const work = runWithContextExecution(admitted, async () => {
		await gate;
		return Promise.all(
			[0, 1, 2].map(async () => {
				await Promise.resolve();
				const child = captureContextExecution(Settings.instance);
				expect(child).toBe(admitted);
				return executionEnvironmentValue("XCSH_NAMESPACE");
			}),
		);
	});
	ContextService.instance.setNamespace("default");
	expect(captureNextContextExecution(Settings.instance).environment.XCSH_NAMESPACE).toBe("default");
	await ContextService.instance.activate("b");
	expect(captureNextContextExecution(Settings.instance).environment.XCSH_NAMESPACE).toBe("demo-app");
	release();
	expect(await work).toEqual(["shared", "shared", "shared"]);
	expect(Object.isFrozen(admitted.environment)).toBe(true);
});

test("R10 plugin context replaces inherited F5 values and restores absent empty and nonempty on success and failure", async () => {
	for (const fail of [false, true]) {
		conflictingEnvironment();
		process.env.XCSH_REGION = "";
		delete process.env.XCSH_CONTEXT_NAME;
		const before = { ...process.env };
		const run = withPluginContext("b", async () => {
			expect(process.env.XCSH_API_TOKEN).toBe("synthetic-b");
			expect(process.env.XCSH_NAMESPACE).toBe("demo-app");
			expect(process.env.XCSH_USERNAME).toBeUndefined();
			expect(process.env.XCSH_REGION).toBeUndefined();
			expect(captureContextExecution(Settings.instance).authority).toBe("context");
			if (fail) throw new Error("synthetic failure");
			return "ok";
		});
		if (fail) await expect(run).rejects.toThrow("synthetic failure");
		else expect(await run).toBe("ok");
		expect(process.env).toEqual(before);
	}
});

const terraformRuntimeKeys = [
	"XCSH_TERRAFORM_EXECUTABLES_DIR",
	"XCSH_TERRAFORM_RUNTIME_DIR",
	"XCSH_TERRAFORM_SSH_CLIENTS_DIR",
];

test.each(terraformRuntimeKeys)("plugin context preserves Terraform process runtime path %s", async key => {
	await ContextService.instance.createContext({
		name: "terraform-paths",
		apiUrl: "https://terraform-paths.example.invalid",
		apiToken: "synthetic-terraform-context",
		defaultNamespace: "shared",
		env: { [key]: "/synthetic/context/path" },
	});
	for (const value of ["", "/synthetic/process/path"]) {
		for (const fail of [false, true]) {
			conflictingEnvironment();
			process.env[key] = value;
			process.env.XCSH_TERRAFORM_API_TOKEN = "synthetic-inherited-terraform-token";
			const before = { ...process.env };
			const run = withPluginContext("terraform-paths", async () => {
				expect(process.env[key]).toBe(value);
				expect(captureContextExecution(Settings.instance).environment[key]).toBe(value);
				expect(process.env.XCSH_API_TOKEN).toBe("synthetic-terraform-context");
				expect(process.env.XCSH_TERRAFORM_API_TOKEN).toBeUndefined();
				if (fail) throw new Error("synthetic Terraform probe failure");
				return "ready";
			});
			if (fail) await expect(run).rejects.toThrow("synthetic Terraform probe failure");
			else expect(await run).toBe("ready");
			expect(process.env).toEqual(before);
		}
	}
});

test("Terraform runtime paths survive context changes in execution snapshots", async () => {
	for (const key of terraformRuntimeKeys) process.env[key] = "/synthetic/process/path";
	process.env.XCSH_TERRAFORM_API_TOKEN = "synthetic-inherited-terraform-token";
	await ContextService.instance.activate("a");
	const first = captureNextContextExecution(Settings.instance);
	for (const key of terraformRuntimeKeys) expect(first.environment[key]).toBe("/synthetic/process/path");
	expect(first.environment.XCSH_TERRAFORM_API_TOKEN).toBeUndefined();
	const cached = { ...(Settings.instance.get("bash.environment") as Record<string, string>) };
	for (const key of terraformRuntimeKeys) {
		delete process.env[key];
		cached[key] = "/synthetic/cached/path";
	}
	Settings.instance.override("bash.environment", cached);
	await ContextService.instance.activate("b");
	const second = captureNextContextExecution(Settings.instance);
	for (const key of terraformRuntimeKeys) expect(second.environment[key]).toBe("/synthetic/cached/path");
	expect(second.environment.XCSH_TERRAFORM_API_TOKEN).toBeUndefined();
	expect(second.environment.XCSH_API_TOKEN).toBe("synthetic-b");
});
