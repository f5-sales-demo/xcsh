import { expect, test, vi } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSupportedReasoningEfforts, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import { getAgentDir, hookFetch, setAgentDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { SelectorController } from "../src/modes/controllers/selector-controller";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import { AuthStorage } from "../src/session/auth-storage";
import { providerSelectorFixture } from "./helpers/provider-selector-fixture";

test("new LiteLLM connection loads its six model routes before browsing without changing assignments", async () => {
	initTheme();
	const previousDir = getAgentDir();
	const dir = mkdtempSync(join(tmpdir(), "connected-provider-"));
	setAgentDir(dir);
	const auth = await AuthStorage.create(join(dir, "auth.db"));
	const fixture = providerSelectorFixture();
	const configPath = join(dir, "config.yml");
	const config = "modelRoles:\n  default: litellm/gpt-5.6-terra:medium\n  smol: litellm/gpt-5.6-luna:low\n";
	writeFileSync(configPath, config);
	let unreachable = false;
	let empty = false;
	const unhook = hookFetch(async () => {
		if (unreachable) throw new Error("synthetic unavailable gateway");
		return Response.json({ data: (empty ? [] : fixture.models).map(model => ({ id: model.id })) });
	});
	try {
		const registry = new ModelRegistry(auth, join(dir, "models.yml"));
		expect(registry.getConfiguredProviderIds().has("litellm")).toBe(false);
		let active: { handleInput?(key: string): void; render(width: number): string[] } | undefined;
		const reviewScreens: string[] = [];
		const setModel = vi.fn();
		const showError = vi.fn();
		const ctx = {
			editor: { render: () => [] },
			settings: fixture.settings,
			scopedModels: [],
			editorContainer: {
				clear: () => {
					active = undefined;
				},
				addChild: (component: typeof active) => {
					active = component;
				},
			},
			chatContainer: { addChild: vi.fn() },
			ui: { terminal: { rows: 32, columns: 100 }, requestRender: vi.fn(), setFocus: vi.fn() },
			session: {
				scopedModels: [],
				modelRegistry: registry,
				settings: fixture.settings,
				model: fixture.active,
				thinkingLevel: "high",
				setModel,
				setThinkingLevel: vi.fn(),
			},
			showStatus: vi.fn(),
			showError,
			showHookCustom: (factory: any) =>
				new Promise(resolve => {
					const component = factory(ctx.ui, {}, {}, resolve);
					reviewScreens.push(Bun.stripANSI(component.render(100).join("\n")));
					component.handleInput?.("\x1b[B");
					component.handleInput?.("\r");
				}),
		} as unknown as InteractiveModeContext;
		const login = new SelectorController(ctx).showOAuthSelector("login", "litellm");
		const submit = async (value: string) => {
			for (let i = 0; i < 50 && !active; i++) await Bun.sleep(1);
			expect(active).toBeDefined();
			for (const c of value) active!.handleInput?.(c);
			active!.handleInput?.("\r");
			await Bun.sleep(0);
		};
		await submit("http://gateway.example.test");
		await submit("synthetic-uat-key");
		await login;
		expect(showError).not.toHaveBeenCalled();
		expect(reviewScreens[0]).toContain("Review LiteLLM connection");
		expect(reviewScreens[0]).toContain("Proxy endpoint: Not configured → http://gateway.example.test");
		expect(reviewScreens[0]).toContain("API credential: Not stored → Stored (masked)");
		expect(reviewScreens[0]).not.toContain("synthetic-uat-key");
		expect(Bun.stripANSI(active!.render(100).join("\n"))).toContain("Provider connected");
		expect(registry.getConfiguredProviderIds().has("litellm")).toBe(true);
		for (const model of fixture.models) expect(registry.find(model.provider, model.id)).toBeDefined();
		for (const id of ["gpt-5.6-terra", "gpt-5.6-luna"]) {
			expect(getSupportedReasoningEfforts(registry.find("litellm", id)!)).toContain(ReasoningEffort.Low);
			expect(getSupportedReasoningEfforts(registry.find("litellm", id)!)).toContain(ReasoningEffort.Medium);
		}
		if (Bun.stripANSI(active!.render(100).join("\n")).includes("Use recommended model"))
			active!.handleInput?.("\x1b[B");
		active!.handleInput?.("\r");
		await Bun.sleep(0);
		const rendered = Bun.stripANSI(active!.render(100).join("\n"));
		expect(rendered).toContain("LiteLLM");
		expect(rendered).toContain("Opus");
		expect(rendered).toContain("gpt-5.6");
		active!.handleInput?.("\x1b");
		await Bun.sleep(0);
		expect(readFileSync(configPath, "utf8")).toBe(config);
		expect(setModel).not.toHaveBeenCalled();
		unreachable = true;
		const reconnect = new SelectorController(ctx).showOAuthSelector("login", "litellm");
		await submit("");
		await submit("");
		await reconnect;
		const failed = Bun.stripANSI(active!.render(100).join("\n"));
		expect(failed).toContain("Connection saved");
		expect(failed).toContain("discovery unavailable");
		expect(failed).toContain("Retry connection");
		unreachable = false;
		active!.handleInput?.("\r");
		for (let i = 0; i < 100 && !Bun.stripANSI(active!.render(100).join("\n")).includes("Provider connected"); i++)
			await Bun.sleep(10);
		expect(Bun.stripANSI(active!.render(100).join("\n"))).toContain("Provider connected");
		empty = true;
		const reconnectEmpty = new SelectorController(ctx).showOAuthSelector("login", "litellm");
		await submit("");
		await submit("");
		await reconnectEmpty;
		expect(Bun.stripANSI(active!.render(100).join("\n"))).toContain("no models returned");
		expect(readFileSync(configPath, "utf8")).toBe(config);
		expect(setModel).not.toHaveBeenCalled();
	} finally {
		unhook[Symbol.dispose]();
		auth.close();
		setAgentDir(previousDir);
		rmSync(dir, { recursive: true, force: true });
	}
});
