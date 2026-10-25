import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOLS, type ToolSession } from "../src/tools";
import { enforcePlanModeWrite } from "../src/tools/plan-mode-guard";

function fixture(applies = true) {
	let state: { enabled: boolean } | undefined;
	let changes = 0;
	const session = {
		cwd: "/tmp/xcsh-plan-fixture",
		hasUI: false,
		getPlanModeState: () => state,
		enterPlanMode: async () => {
			changes++;
			if (applies) state = { enabled: true };
		},
	} as unknown as ToolSession;
	return { session, changes: () => changes };
}

async function tool(session: ToolSession) {
	expect(BUILTIN_TOOLS.enter_plan_mode).toBeFunction();
	const result = await BUILTIN_TOOLS.enter_plan_mode(session);
	expect(result).not.toBeNull();
	return result!;
}

describe("headless Plan-mode control", () => {
	test("enters actual mode and activates the existing write guard", async () => {
		const f = fixture();
		const result = await (await tool(f.session)).execute("enter", { action: "enter" });
		expect(result.details).toMatchObject({ mode: "plan" });
		expect(() => enforcePlanModeWrite(f.session, "outside-plan.txt")).toThrow("Plan mode");
	});

	test("status is read-only and repeated entry is idempotent", async () => {
		const f = fixture();
		const t = await tool(f.session);
		expect((await t.execute("status", { action: "status" })).details).toMatchObject({ mode: "default" });
		expect(f.changes()).toBe(0);
		await t.execute("one", { action: "enter" });
		await t.execute("two", { action: "enter" });
		expect(f.changes()).toBe(1);
	});

	test("rejects false mode acknowledgements", async () => {
		const f = fixture(false);
		await expect((await tool(f.session)).execute("enter", { action: "enter" })).rejects.toThrow("Plan mode");
	});

	test("does not advertise control without an actual runtime callback", async () => {
		const f = fixture();
		delete (f.session as unknown as Record<string, unknown>).enterPlanMode;
		expect(BUILTIN_TOOLS.enter_plan_mode).toBeFunction();
		expect(await BUILTIN_TOOLS.enter_plan_mode(f.session)).toBeNull();
	});

	test("cannot escape Plan mode through a default-mode argument", async () => {
		const f = fixture();
		const t = await tool(f.session);
		await t.execute("enter", { action: "enter" });
		await expect(t.execute("escape", { action: "default" })).rejects.toThrow();
		expect(f.session.getPlanModeState?.()?.enabled).toBe(true);
	});
});

test("runtime Plan entry persists across reopening without changing the model or reasoning", async () => {
	const { Agent } = await import("@f5-sales-demo/pi-agent-core");
	const { getBundledModel, Effort } = await import("@f5-sales-demo/pi-ai");
	const { TempDir } = await import("@f5-sales-demo/pi-utils");
	const { AgentSession } = await import("../src/session/agent-session");
	const { SessionManager } = await import("../src/session/session-manager");
	const { AuthStorage } = await import("../src/session/auth-storage");
	const { ModelRegistry } = await import("../src/config/model-registry");
	const { Settings } = await import("../src/config/settings");
	const temp = TempDir.createSync("xcsh-plan-runtime-");
	const auth = await AuthStorage.create(":memory:");
	const manager = SessionManager.create(temp.path(), temp.path());
	const model = getBundledModel("openai-codex", "gpt-6-astra")!;
	const agent = new Agent({ initialState: { model, thinkingLevel: Effort.High, tools: [], messages: [] } });
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	try {
		await session.enterPlanModeFromTool();
		await session.enterPlanModeFromTool();
		expect(session.getPlanModeState()?.enabled).toBe(true);
		expect(manager.getBranch().filter(row => row.type === "mode_change")).toHaveLength(1);
		expect(agent.state.model).toBe(model);
		expect(agent.state.thinkingLevel).toBe(Effort.High);
		manager.appendMessage({ role: "user", content: "Fixture Plan entry", timestamp: 1 });
		await manager.ensureOnDisk();
		await manager.flush();
		const reopened = await SessionManager.open(manager.getSessionFile()!);
		try {
			expect(reopened.buildSessionContext().mode).toBe("plan");
		} finally {
			await reopened.close();
		}
	} finally {
		await session.dispose();
		await manager.close();
		auth.close();
		temp.removeSync();
	}
});

test("entering Plan mode returns immediate card persistence guidance without weakening write guards", async () => {
	const f = fixture();
	const result = await (await tool(f.session)).execute("enter", { action: "enter" });
	expect(result.details).toEqual({ mode: "plan" });
	expect(JSON.stringify(result.content)).toContain("persisted in conversation history");
	expect(JSON.stringify(result.content)).toContain("Do not write a project file");
	expect(() => enforcePlanModeWrite(f.session, "outside-plan.txt")).toThrow("Plan mode");
});
