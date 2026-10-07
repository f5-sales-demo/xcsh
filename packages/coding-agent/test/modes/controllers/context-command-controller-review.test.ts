import { afterEach, beforeAll, beforeEach, expect, test, vi } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getLocalXCSHContextsDir,
	getProjectDir,
	setProjectDir,
} from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings } from "../../../src/config/settings";
import { ContextCommandController } from "../../../src/modes/controllers/context-command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { ContextService } from "../../../src/services/xcsh-context";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
let directory = "";
const originalProjectDir = getProjectDir();
const originalNamespace = process.env.XCSH_NAMESPACE;

beforeEach(async () => {
	delete process.env.XCSH_NAMESPACE;
	directory = await mkdtemp(join(tmpdir(), "xcsh-context-review-"));
	fs.mkdirSync(join(directory, "project"), { recursive: true });
	setProjectDir(join(directory, "project"));
	_resetSettingsForTest();
	await Settings.init({
		cwd: join(directory, "project"),
		agentDir: join(directory, "agent"),
		inMemory: true,
	});
	ContextService._resetForTest();
	ContextService.init(directory);
});

afterEach(async () => {
	if (originalNamespace === undefined) delete process.env.XCSH_NAMESPACE;
	else process.env.XCSH_NAMESPACE = originalNamespace;
	setProjectDir(originalProjectDir);
	ContextService._resetForTest();
	_resetSettingsForTest();
	await rm(directory, { recursive: true, force: true });
});

function harness(inputs: string[][]) {
	const screens: string[] = [];
	const invalidateIntegration = vi.fn();
	let current: Component | undefined;
	const editor = { setText: vi.fn() };
	const ctx = {
		editor,
		editorContainer: {
			clear: vi.fn(),
			addChild: vi.fn((child: Component) => {
				if (typeof child?.render === "function") current = child;
			}),
		},
		showStatus: vi.fn(),
		showError: vi.fn(),
		session: {
			extensionRunner: {
				getAllRegisteredIntegrations: () => [{ invalidate: invalidateIntegration }],
			},
		},
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		ui: { terminal: { rows: 24 }, requestRender: vi.fn(), setFocus: vi.fn() },
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				current = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(current.render(80).join("\n")));
				for (const input of inputs.shift() ?? []) current.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		invalidateIntegration,
		screens,
		controller: new ContextCommandController(ctx),
		input: (value: string) => current?.handleInput?.(value),
		text: () => Bun.stripANSI(current?.render(80).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected context review state was not rendered");
}

test("typed context creation is Cancel-first and never renders its secret", async () => {
	const secret = "SYNTHETIC_CONTEXT_SECRET";
	const h = harness([["\r"]]);
	await h.controller.handle({
		name: "context",
		args: `create demo https://demo.example.invalid ${secret} app`,
		text: "/context create",
	});
	expect(fs.existsSync(join(directory, "contexts", "demo.json"))).toBe(false);
	expect(h.screens[0]).toContain("Review context change");
	expect(h.screens[0]).toContain("context:demo");
	expect(h.screens[0]).toContain("API credential: Absent → Saved (masked)");
	expect(h.screens[0]).not.toContain(secret);
});

test("confirmed context creation persists the exact reviewed target", async () => {
	const h = harness([["\x1b[B", "\r"]]);
	await h.controller.handle({
		name: "context",
		args: "create demo https://demo.example.invalid token-value app",
		text: "/context create",
	});
	const persisted = JSON.parse(fs.readFileSync(join(directory, "contexts", "demo.json"), "utf8"));
	expect(persisted).toMatchObject({
		name: "demo",
		apiUrl: "https://demo.example.invalid",
		apiToken: "token-value",
		defaultNamespace: "app",
	});
});

test("context changes renew stale reviews before mutation", async () => {
	const service = ContextService.instance;
	const h = harness([]);
	const pending = h.controller.handle({
		name: "context",
		args: "create demo https://demo.example.invalid token-value app",
		text: "/context create",
	});
	await waitFor(() => h.screens.length === 1);
	await service.createContext({
		name: "concurrent",
		apiUrl: "https://concurrent.example.invalid",
		apiToken: "other",
		defaultNamespace: "default",
	});
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(fs.existsSync(join(directory, "contexts", "demo.json"))).toBe(false);
	h.input("\r");
	await pending;
});

test("context environment reviews mask secrets and persist only after confirmation", async () => {
	const service = ContextService.instance;
	await service.createContext({
		name: "demo",
		apiUrl: "https://demo.example.invalid",
		apiToken: "token-value",
		defaultNamespace: "default",
	});
	await service.activate("demo");
	const secret = "SYNTHETIC_ENV_SECRET";
	const cancelled = harness([["\r"]]);
	await cancelled.controller.handle({
		name: "context",
		args: `env set API_TOKEN=${secret} REGION=ca`,
		text: "/context env set",
	});
	expect(cancelled.screens[0]).not.toContain(secret);
	expect((await service.listContexts())[0].env).toBeUndefined();

	const confirmed = harness([["\x1b[B", "\r"]]);
	await confirmed.controller.handle({
		name: "context",
		args: `env set API_TOKEN=${secret} REGION=ca`,
		text: "/context env set",
	});
	expect((await service.listContexts())[0].env).toEqual({ API_TOKEN: secret, REGION: "ca" });
});

test("context namespace selection distinguishes effective state from the unchanged saved default", async () => {
	const service = ContextService.instance;
	await service.createContext({
		name: "demo",
		apiUrl: "https://demo.example.invalid",
		apiToken: "token-value",
		defaultNamespace: "saved-default",
	});
	await service.activate("demo");
	const h = harness([["\x1b[B", "\r"]]);
	await h.controller.handle({
		name: "context",
		args: "namespace runtime-only",
		text: "/context namespace runtime-only",
	});

	expect(h.screens).toHaveLength(0);
	expect(service.activeNamespace).toBe("runtime-only");
	expect((await service.listContexts()).find(context => context.name === "demo")?.defaultNamespace).toBe(
		"saved-default",
	);
});

test("unsafe context link names are rejected before any pointer path is resolved or reviewed", async () => {
	const outside = join(directory, "victim.json");
	fs.writeFileSync(outside, "unchanged");
	const h = harness([]);
	await h.controller.handle({
		name: "context",
		args: "link ../../victim",
		text: "/context link ../../victim",
	});

	expect(h.screens).toEqual([]);
	expect(h.ctx.showError).toHaveBeenCalledWith(expect.stringContaining("Invalid context name"));
	expect(fs.readFileSync(outside, "utf8")).toBe("unchanged");
	expect(fs.existsSync(getLocalXCSHContextsDir(getProjectDir()))).toBe(false);
});

test("corrupt unlink reviews and removes only the active pointer without deriving an unsafe path", async () => {
	const contextsDir = getLocalXCSHContextsDir(getProjectDir());
	fs.mkdirSync(contextsDir, { recursive: true });
	const active = getLocalXCSHActiveContextPath(getProjectDir());
	fs.writeFileSync(active, "../../victim");
	const outside = join(directory, "victim");
	fs.writeFileSync(outside, "preserved");
	const h = harness([["\x1b[B", "\r"]]);
	await h.controller.handle({ name: "context", args: "unlink", text: "/context unlink" });

	expect(h.screens[0]).toContain("Repairs a corrupt project-local active-context file");
	expect(h.screens[0]).toContain("No path is derived from the invalid contents");
	expect(h.screens[0]).not.toContain("Local context pointer");
	expect(fs.existsSync(active)).toBe(false);
	expect(fs.readFileSync(outside, "utf8")).toBe("preserved");
});

test("context unlink renews a stale pointer proposal and cancellation preserves the replacement", async () => {
	const contextsDir = getLocalXCSHContextsDir(getProjectDir());
	fs.mkdirSync(contextsDir, { recursive: true });
	const active = getLocalXCSHActiveContextPath(getProjectDir());
	const first = getLocalXCSHContextPath("first", getProjectDir());
	const second = getLocalXCSHContextPath("second", getProjectDir());
	fs.writeFileSync(active, "first");
	fs.writeFileSync(first, JSON.stringify({ name: "first" }));
	fs.writeFileSync(second, JSON.stringify({ name: "second" }));

	const h = harness([]);
	const pending = h.controller.handle({ name: "context", args: "unlink", text: "/context unlink" });
	await waitFor(() => h.screens.length === 1);
	fs.writeFileSync(active, "second");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("target changed"));
	expect(fs.readFileSync(active, "utf8")).toBe("second");
	expect(fs.existsSync(first)).toBe(true);
	expect(fs.existsSync(second)).toBe(true);
	h.input("\r");
	await pending;
});

test("wizard has one Cancel-first review and saves and activates once", async () => {
	const service = ContextService.instance;
	service.validateToken = vi.fn(async () => ({ status: "connected" as const, latencyMs: 1 }));
	const h = harness([]);
	await h.controller.handle({ name: "context", args: "create", text: "/context create" });
	h.input("https://demo.example.invalid");
	h.input("\r");
	h.input("token-value");
	h.input("\r");
	h.input("\r");
	await waitFor(() => h.text().includes("Default namespace"));
	h.input("\r");
	expect(h.text()).toContain("Review context");
	expect(h.text()).toContain("Save and activate");
	expect(h.text()).not.toContain("token-value");
	expect(fs.existsSync(join(directory, "contexts", "demo.json"))).toBe(false);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => service.getStatus().activeContextName === "demo");
	expect(h.screens.filter(screen => screen.includes("Review context"))).toHaveLength(0);
	expect(fs.existsSync(join(directory, "contexts", "demo.json"))).toBe(true);
});

test("explicit activation is immediate and leaves saved files unchanged", async () => {
	const service = ContextService.instance;
	service.validateToken = vi.fn(async () => ({ status: "connected" as const }));
	for (const name of ["first", "second"])
		await service.createContext({
			name,
			apiUrl: `https://${name}.example.invalid`,
			apiToken: `${name}-token`,
			defaultNamespace: "default",
		});
	await service.activate("first");
	const before = fs.readFileSync(join(directory, "contexts", "second.json"), "utf8");
	const h = harness([]);
	await h.controller.handle({ name: "context", args: "activate second", text: "/context activate second" });
	expect(service.getStatus().activeContextName).toBe("second");
	expect(h.screens).toHaveLength(0);
	expect(fs.readFileSync(join(directory, "contexts", "second.json"), "utf8")).toBe(before);
	expect(h.ctx.showStatus).toHaveBeenCalledWith("Selected second · namespace default · Checking", { dim: false });
});

test("documented context delete confirmation still requires Cancel-first review", async () => {
	const service = ContextService.instance;
	await service.createContext({
		name: "demo",
		apiUrl: "https://demo.example.invalid",
		apiToken: "token-value",
		defaultNamespace: "default",
	});
	const cancelled = harness([["\r"]]);
	await cancelled.controller.handle({
		name: "context",
		args: "delete demo --confirm",
		text: "/context delete demo --confirm",
	});
	expect(cancelled.screens[0]).toContain("Review context change");
	expect(cancelled.screens[0]).toContain("Permanently removed");
	expect((await service.listContexts()).map(context => context.name)).toContain("demo");

	const confirmed = harness([["\x1b[B", "\r"]]);
	await confirmed.controller.handle({
		name: "context",
		args: "delete demo --confirm",
		text: "/context delete demo --confirm",
	});
	expect((await service.listContexts()).map(context => context.name)).not.toContain("demo");
});

test("context read-only output uses the bounded shared report", async () => {
	const service = ContextService.instance;
	await service.createContext({
		name: "demo",
		apiUrl: "https://demo.example.invalid",
		apiToken: "token-value",
		defaultNamespace: "default",
	});
	const h = harness([["\x1b"]]);
	await h.controller.handle({ name: "context", args: "list", text: "/context list" });
	expect(h.screens[0]).toContain("Saved contexts");
	expect(h.screens[0]).toContain("/context list");
	expect(h.screens[0]).toContain("demo");
	expect(h.screens[0]).toContain("Esc: close");
});

test("guided Platform setup offers saved contexts instead of reopening context creation", async () => {
	const service = ContextService.instance;
	for (const name of ["zeta", "alpha"])
		await service.createContext({
			name,
			apiUrl: `https://${name}.example.invalid`,
			apiToken: `${name}-token`,
			defaultNamespace: `${name}-namespace`,
		});
	const h = harness([]);

	await h.controller.handleGuidedSetup();

	expect(h.ctx.showStatus).toHaveBeenCalledWith(
		[
			"Platform setup requires an active context for this xcsh session.",
			"Saved contexts:",
			"  /context activate alpha",
			"  /context activate zeta",
			"Run one command above. To add another context, run /context wizard.",
		].join("\n"),
	);
	expect(h.ctx.editorContainer.addChild).not.toHaveBeenCalled();
});

test("wizard cancellation writes nothing and saved editing retains unrelated fields", async () => {
	const service = ContextService.instance;
	service.validateToken = vi.fn(async () => ({ status: "connected" as const }));
	const cancelled = harness([]);
	await cancelled.controller.handle({ name: "context", args: "create", text: "/context create" });
	cancelled.input("https://draft.example.test");
	cancelled.input("\r");
	cancelled.input("synthetic-token");
	cancelled.input("\r");
	cancelled.input("\r");
	await waitFor(() => cancelled.text().includes("Default namespace"));
	cancelled.input("\r");
	cancelled.input("\r");
	expect((await service.listContexts()).length).toBe(0);
	await service.createContext({
		name: "demo",
		apiUrl: "https://demo.example.test",
		apiToken: "synthetic-original",
		defaultNamespace: "default",
		env: { XCSH_REGION: "region" },
		includeSkills: ["demo"],
	});
	const before = service.resolveTarget({ name: "demo", source: "global" });
	const editor = harness([]);
	await editor.controller.handle({ name: "context", args: "edit demo", text: "/context edit demo" });
	editor.input("\r");
	expect(editor.text()).not.toContain("synthetic-original");
	editor.input("\r");
	editor.input("\r");
	await waitFor(() => editor.text().includes("Default namespace"));
	editor.input("\r");
	editor.input("\x1b[B");
	editor.input("\x1b[B");
	editor.input("\r");
	await waitFor(() => !editor.text().includes("Saving"));
	const after = service.resolveTarget({ name: "demo", source: "global" });
	expect(after.apiToken).toBe(before.apiToken);
	expect(after.env).toEqual(before.env);
	expect(after.metadata).toEqual(before.metadata);
	expect(after.includeSkills).toEqual(before.includeSkills);
});

test("save and activate retries only activation after partial failure", async () => {
	const service = ContextService.instance;
	service.validateToken = vi.fn(async () => ({ status: "connected" as const }));
	const activate = service.activate.bind(service);
	let calls = 0;
	service.activate = vi.fn(async (name, options) => {
		calls++;
		if (calls === 1) throw new Error("synthetic activation failure");
		return activate(name, options);
	});
	const h = harness([]);
	await h.controller.handle({ name: "context", args: "create", text: "/context create" });
	h.input("https://draft.example.test");
	h.input("\r");
	h.input("synthetic-token");
	h.input("\r");
	h.input("\r");
	await waitFor(() => h.text().includes("Default namespace"));
	h.input("\r");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("synthetic activation failure"));
	const file = join(directory, "contexts", "draft.json");
	const saved = fs.readFileSync(file, "utf8");
	h.input("\r");
	await waitFor(() => service.getStatus().activeContextName === "draft");
	expect(calls).toBe(2);
	expect(fs.readFileSync(file, "utf8")).toBe(saved);
});
