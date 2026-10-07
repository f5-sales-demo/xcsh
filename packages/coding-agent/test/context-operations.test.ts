import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setProjectDir } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { captureContextExecution, runWithContextExecution } from "../src/services/context-execution";
import { executeContextOperation } from "../src/services/context-operations";
import { ContextService } from "../src/services/xcsh-context";
import { buildSessionContext, SessionManager } from "../src/session/session-manager";
import { XcshApiTool } from "../src/tools/xcsh-api";

let root: string;
let service: ContextService;
let settings: Settings;
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const env = { ...process.env };
beforeEach(async () => {
	for (const key of Object.keys(process.env)) if (key.startsWith("XCSH_")) delete process.env[key];
	root = fs.mkdtempSync(path.join(os.tmpdir(), "context-operations-"));
	setProjectDir(root);
	_resetSettingsForTest();
	ContextService._resetForTest();
	settings = await Settings.init({ cwd: root, agentDir: root, inMemory: true });
	service = ContextService.init(path.join(root, "config"));
	globalThis.fetch = (async () => Response.json({ items: [] })) as unknown as typeof fetch;
	await service.createContext({
		name: "demo",
		apiUrl: "https://a.example.test",
		apiToken: "synthetic-a",
		defaultNamespace: "global",
		env: { XCSH_REGION: "global", XCSH_PRIVATE: "private" },
		sensitiveKeys: ["XCSH_PRIVATE"],
		knowledgeSources: [{ url: "https://docs.example.test" }],
		includeSkills: ["demo"],
	});
});
afterEach(() => {
	setProjectDir(originalCwd);
	globalThis.fetch = originalFetch;
	ContextService._resetForTest();
	_resetSettingsForTest();
	for (const key of Object.keys(process.env)) if (key.startsWith("XCSH_")) delete process.env[key];
	for (const [key, value] of Object.entries(env))
		if (key.startsWith("XCSH_") && value !== undefined) process.env[key] = value;
	fs.rmSync(root, { recursive: true, force: true });
});
describe("shared context operations", () => {
	it("edits retain token, metadata, skills and knowledge; stale writes fail without changes", async () => {
		const target = { name: "demo", source: "global" as const };
		const before = service.resolveTarget(target);
		const raw = fs.readFileSync(service.targetPath(target), "utf8");
		await executeContextOperation(service, { action: "edit", target, namespace: "example-team" }, root);
		const after = service.resolveTarget(target);
		expect(after.apiToken).toBe(before.apiToken);
		expect(after.metadata).toEqual(before.metadata);
		expect(after.knowledgeSources).toEqual(before.knowledgeSources);
		expect(after.includeSkills).toEqual(before.includeSkills);
		await expect(service.saveTarget(target, before, raw)).rejects.toThrow("changed");
		expect(service.resolveTarget(target).defaultNamespace).toBe("example-team");
		expect(fs.statSync(service.targetPath(target)).mode & 0o777).toBe(0o600);
	});
	it("project pointer namespace/environment edits never write global credentials", async () => {
		const target = { name: "project", source: "local" as const };
		const globalFile = service.targetPath({ name: "demo", source: "global" });
		const before = fs.readFileSync(globalFile, "utf8");
		await executeContextOperation(service, { action: "link", target, newName: "demo" }, root);
		await executeContextOperation(service, { action: "edit", target, namespace: "example-local" }, root);
		await executeContextOperation(service, { action: "env", target, env: { XCSH_PRIVATE: "local-private" } }, root);
		await executeContextOperation(service, { action: "env", target, unset: ["XCSH_REGION"] }, root);
		const resolved = service.resolveTarget(target);
		expect(resolved.name).toBe("project");
		expect(resolved.defaultNamespace).toBe("example-local");
		expect(resolved.env?.XCSH_REGION).toBeUndefined();
		expect(JSON.stringify(await executeContextOperation(service, { action: "show", target }, root))).not.toContain(
			"local-private",
		);
		expect(fs.readFileSync(globalFile, "utf8")).toBe(before);
		await expect(
			executeContextOperation(service, { action: "edit", target, apiToken: "replacement" }, root),
		).rejects.toThrow("global");
	});
	it("bad replacement authentication writes nothing", async () => {
		const target = { name: "demo", source: "global" as const };
		const before = fs.readFileSync(service.targetPath(target), "utf8");
		globalThis.fetch = (async () => Response.json({}, { status: 403 })) as unknown as typeof fetch;
		expect(
			await executeContextOperation(service, { action: "edit", target, apiToken: "replacement" }, root),
		).toMatchObject({ status: "auth_error", failureReason: "forbidden" });
		expect(fs.readFileSync(service.targetPath(target), "utf8")).toBe(before);
	});
	it("a delayed existing API tool targets admitted A after selecting B", async () => {
		await service.activate("demo");
		const admitted = captureContextExecution(settings);
		const tool = new XcshApiTool({ settings } as never, path.join(root, "cache"));
		await service.createContext({
			name: "beta",
			apiUrl: "https://b.example.test",
			apiToken: "synthetic-b",
			defaultNamespace: "team-b",
		});
		await service.activate("beta");
		const requests: Array<{ url: string; token: string | null }> = [];
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(url), token: new Headers(init?.headers).get("Authorization") });
			return Response.json({ items: [] });
		}) as unknown as typeof fetch;
		await runWithContextExecution(admitted, async () => {
			await Promise.resolve();
			await tool.execute("delayed", {
				method: "GET",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers",
			});
		});
		expect(requests.at(-1)).toEqual({
			url: "https://a.example.test/api/config/namespaces/global/http_loadbalancers",
			token: "APIToken synthetic-a",
		});
	});
	it("restores local source and defaults old name-only session records to global", () => {
		const session = SessionManager.inMemory();
		session.appendContextChange("demo", "a", "default", "local");
		expect(session.buildSessionContext().activeContextSource).toBe("local");
		const entries = session
			.getEntries()
			.map(entry => (entry.type === "context_change" ? { ...entry, source: undefined } : entry));
		expect(buildSessionContext(entries).activeContextSource).toBe("global");
	});
});
