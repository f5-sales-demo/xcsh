import { beforeAll, expect, test, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import {
	MCPCommandController,
	type MCPCommandDependencies,
} from "../../../src/modes/controllers/mcp-command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function harness(inputs: string[][], dependencies: Partial<MCPCommandDependencies> = {}) {
	const screens: string[] = [];
	let current: Component | undefined;
	const ctx = {
		editor: { onEscape: undefined, addToHistory: vi.fn(), setText: vi.fn() },
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
		chatContainer: { addChild: vi.fn() },
		ui: { terminal: { rows: 24 }, setFocus: vi.fn(), requestRender: vi.fn() },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookInput: vi.fn(async () => undefined),
		openHttpUrl: vi.fn(async () => ({ ok: true as const })),
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
		controller: new MCPCommandController(ctx, dependencies),
		input: (value: string) => current?.handleInput?.(value),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected Smithery state was not reached");
}

test("Smithery browser login is Cancel-first and creates no remote session on cancel", async () => {
	const createSession = vi.fn(async () => ({ sessionId: "session-1", authUrl: "https://smithery.test/auth/1" }));
	const h = harness([["\r"]], {
		getSmitheryLoginUrl: () => "https://smithery.test",
		createSmitheryCliAuthSession: createSession,
	});

	await h.controller.handle("/mcp smithery-login");
	expect(createSession).not.toHaveBeenCalled();
	expect(h.ctx.openHttpUrl).not.toHaveBeenCalled();
	expect(h.screens[0]).toContain("Review Smithery browser login");
	expect(h.screens[0]).toContain("short-lived remote Smithery authorization session");
});

test("Smithery browser login reviews remote work and credential persistence separately", async () => {
	const secret = "SYNTHETIC_SMITHERY_SECRET";
	let savedKey: string | undefined;
	const h = harness(
		[
			["\x1b[B", "\r"],
			["\x1b[B", "\r"],
		],
		{
			getSmitheryLoginUrl: () => "https://smithery.test",
			createSmitheryCliAuthSession: vi.fn(async () => ({
				sessionId: "session-1",
				authUrl: "https://smithery.test/auth/session-1",
			})),
			pollSmitheryCliAuthSession: vi.fn(async () => ({ status: "success" as const, apiKey: secret })),
			searchSmitheryRegistry: vi.fn(async () => []),
			getSmitheryApiKey: vi.fn(async () => savedKey),
			saveSmitheryApiKey: vi.fn(async value => {
				savedKey = value;
			}),
			sleep: vi.fn(async () => {}),
		},
	);

	await h.controller.handle("/mcp smithery-login");
	expect(h.ctx.openHttpUrl).toHaveBeenCalledWith("https://smithery.test/auth/session-1");
	expect(savedKey).toBe(secret);
	expect(h.screens).toHaveLength(2);
	expect(h.screens[0]).toContain("Remote authorization session");
	expect(h.screens[1]).toContain("Review Smithery credential save");
	expect(h.screens.every(screen => !screen.includes(secret))).toBe(true);
});

test("Escape does not interrupt Smithery work but app.interrupt aborts it", async () => {
	let started = false;
	let aborted = false;
	const h = harness([["\x1b[B", "\r"]], {
		getSmitheryLoginUrl: () => "https://smithery.test",
		createSmitheryCliAuthSession: signal =>
			new Promise((_resolve, reject) => {
				started = true;
				signal?.addEventListener("abort", () => {
					aborted = true;
					reject(new DOMException("aborted", "AbortError"));
				});
			}),
	});

	const pending = h.controller.handle("/mcp smithery-login");
	await waitFor(() => started);
	h.input("\x1b");
	expect(aborted).toBe(false);
	h.input("\x03");
	await pending;
	expect(aborted).toBe(true);
	expect(h.ctx.openHttpUrl).not.toHaveBeenCalled();
	expect(h.ctx.showWarning).not.toHaveBeenCalled();
});

test("a duplicate Smithery login is rejected while the first review is active", async () => {
	const h = harness([], { getSmitheryLoginUrl: () => "https://smithery.test" });
	const first = h.controller.handle("/mcp smithery-login");
	await waitFor(() => h.screens.length === 1);
	await h.controller.handle("/mcp smithery-login");
	expect(h.ctx.showStatus).toHaveBeenCalledWith(
		"Smithery authentication is already active; duplicate request ignored.",
	);
	h.input("\r");
	await first;
});
