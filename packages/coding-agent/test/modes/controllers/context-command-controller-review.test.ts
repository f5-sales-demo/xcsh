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

test("context namespace review distinguishes effective state from the unchanged saved default", async () => {
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

	expect(h.screens[0]).toContain("current process only");
	expect(h.screens[0]).toContain("Effective namespace: saved-default → runtime-only");
	expect(h.screens[0]).toContain("Saved default namespace: saved-default → saved-default (unchanged)");
	expect(h.screens[0]).toContain("No context file is written");
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

test("context wizard retries only activation after a create-then-activate partial failure", async () => {
	const service = ContextService.instance;
	service.validateToken = vi.fn(async () => ({ status: "connected" as const, latencyMs: 1 }));
	const activate = service.activate.bind(service);
	let activationAttempts = 0;
	service.activate = vi.fn(async name => {
		activationAttempts++;
		if (activationAttempts === 1) throw new Error("synthetic activation failure");
		return activate(name);
	});

	const h = harness([]);
	await h.controller.handle({ name: "context", args: "wizard", text: "/context wizard" });
	h.input("https://demo.example.invalid");
	h.input("\r");
	h.input("token-value");
	h.input("\r");
	h.input("\r");
	await waitFor(() => h.text().includes("Step 5: Default Namespace"));
	for (let step = 0; step < 3; step++) h.input("\r");
	h.input("\r");
	h.input("\r");
	await waitFor(() => h.screens.length === 1);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("synthetic activation failure"));

	const contextPath = join(directory, "contexts", "demo.json");
	const saved = fs.readFileSync(contextPath, "utf8");
	expect(service.getStatus().activeContextName).toBeNull();
	expect(activationAttempts).toBe(1);

	// The first retry revalidates the now-saved context and requires review of
	// the activation-only proposal. The second confirmation performs only that
	// unresolved step; the context file remains byte-identical.
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.text()).toContain("The context file is already saved");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => service.getStatus().activeContextName === "demo");
	expect(fs.readFileSync(contextPath, "utf8")).toBe(saved);
	expect(activationAttempts).toBe(2);
});

test("context activation and direct-name switching are Cancel-first before replacing persisted state", async () => {
	const service = ContextService.instance;
	for (const name of ["first", "second"])
		await service.createContext({
			name,
			apiUrl: `https://${name}.example.invalid`,
			apiToken: `${name}-token`,
			defaultNamespace: `${name}-namespace`,
		});
	await service.activate("first");
	const firstPath = join(directory, "contexts", "first.json");
	const secondPath = join(directory, "contexts", "second.json");
	const before = [fs.readFileSync(firstPath, "utf8"), fs.readFileSync(secondPath, "utf8")];

	const cancelled = harness([["\r"]]);
	await cancelled.controller.handle({
		name: "context",
		args: "activate second",
		text: "/context activate second",
	});
	expect(cancelled.screens[0]).toContain("Review context change");
	expect(cancelled.screens[0]).toContain("Active context: first → second");
	expect(service.getStatus().activeContextName).toBe("first");
	expect([fs.readFileSync(firstPath, "utf8"), fs.readFileSync(secondPath, "utf8")]).toEqual(before);

	const confirmed = harness([["\x1b[B", "\r"]]);
	await confirmed.controller.handle({ name: "context", args: "second", text: "/context second" });
	expect(confirmed.screens[0]).toContain("context-activation:second");
	expect(service.getStatus().activeContextName).toBe("second");
	expect([fs.readFileSync(firstPath, "utf8"), fs.readFileSync(secondPath, "utf8")]).toEqual(before);
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
	expect(h.screens[0]).toContain("F5 XC contexts");
	expect(h.screens[0]).toContain("/context list · saved configuration and current runtime state");
	expect(h.screens[0]).toContain("demo");
	expect(h.screens[0]).toContain("Esc: close");
});
