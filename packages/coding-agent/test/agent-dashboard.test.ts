import { beforeAll, expect, test, vi } from "bun:test";
import { Settings } from "../src/config/settings";
import { AgentDashboard, type AgentDashboardDependencies } from "../src/modes/components/agent-dashboard";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";
import type { AgentDefinition } from "../src/task/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function agent(name: string, source: AgentDefinition["source"] = "project", revision = 1): AgentDefinition {
	return {
		name,
		description: `Synthetic ${name} agent revision ${revision}`,
		systemPrompt: `You are ${name}.`,
		source,
		filePath: source === "bundled" ? undefined : `/fixture/${source}/${name}.md`,
	};
}

function fixtureDependencies(
	discover: AgentDashboardDependencies["discover"],
	overrides: Partial<AgentDashboardDependencies> = {},
): AgentDashboardDependencies {
	return {
		discover,
		resolveDirectory: (_cwd, scope) => `/fixture/${scope}/agents`,
		stat: async () => {
			const error = new Error("absent") as NodeJS.ErrnoException;
			error.code = "ENOENT";
			throw error;
		},
		mkdir: async () => {},
		writeExclusive: async () => {},
		generate: async () => ({
			identifier: "release-reviewer",
			whenToUse: "Use this agent when a release needs review.",
			systemPrompt: "Review the release and report evidence.",
		}),
		...overrides,
	};
}

async function settle(test: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100 && !test(); attempt++) await Bun.sleep(1);
}

test("agent rows inspect before a Cancel-first persistent enabled-state change", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const flush = vi.spyOn(store, "flush");
	const dashboard = await AgentDashboard.create(
		"/fixture",
		store,
		24,
		{},
		fixtureDependencies(async () => ({ agents: [agent("duplicate"), agent("duplicate", "user")] })),
	);
	const initial = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(initial).toContain("/fixture/project/duplicate.md");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Agent details");
	expect(set).not.toHaveBeenCalled();
	dashboard.handleInput("\r");
	const review = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(review).toContain("Review disable agent");
	expect(review).toContain('Target: agent:["duplicate","project","/fixture/project/duplicate.md"]');
	dashboard.handleInput("\r");
	expect(set).not.toHaveBeenCalled();
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => flush.mock.calls.length > 0);
	expect(store.get("task.disabledAgents")).toEqual(["duplicate"]);
});

test("changed agent source renews review and persistence failure retries without false success", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	let revision = 1;
	const dashboard = await AgentDashboard.create(
		"/fixture",
		store,
		24,
		{},
		fixtureDependencies(async () => ({ agents: [agent("changing-agent", "project", revision)] })),
	);
	dashboard.handleInput("\r");
	dashboard.handleInput("\r");
	revision = 2;
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("proposal changed"));
	expect(set).not.toHaveBeenCalled();
	const flush = vi.spyOn(store, "flush").mockRejectedValueOnce(new Error("fixture disk unavailable"));
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("fixture disk unavailable"));
	expect(store.get("task.disabledAgents")).toEqual([]);
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Unresolved disable agent");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => store.get("task.disabledAgents").includes("changing-agent"));
	expect(flush.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test("model editor is prefilled, unchanged submissions do not write, and changes require review", async () => {
	const store = Settings.isolated();
	store.set("task.agentModelOverrides", { planner: "openai/existing" });
	await store.flush();
	const flush = vi.spyOn(store, "flush");
	const dashboard = await AgentDashboard.create(
		"/fixture",
		store,
		24,
		{},
		fixtureDependencies(async () => ({ agents: [agent("planner")] })),
	);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("openai/existing");
	dashboard.handleInput("\r");
	expect(flush).not.toHaveBeenCalled();
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("unchanged; nothing saved");
	dashboard.handleInput("\r");
	dashboard.handleInput("\x01");
	dashboard.handleInput("openai/replacement");
	dashboard.handleInput("\r");
	expect(Bun.stripANSI(dashboard.render(100).join("\n"))).toContain("Review agent model override");
	expect(flush).not.toHaveBeenCalled();
});

test("agent creation requires an explicit scope and writes only after a separate review", async () => {
	const store = Settings.isolated();
	const writes: Array<{ file: string; content: string }> = [];
	let created = false;
	const deps = fixtureDependencies(async () => ({ agents: created ? [agent("release-reviewer")] : [] }), {
		writeExclusive: async (file, content) => {
			writes.push({ file, content });
			created = true;
		},
	});
	const dashboard = await AgentDashboard.create("/fixture", store, 24, {}, deps);
	dashboard.handleInput("\r");
	let screen = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(screen).toContain("Choose agent scope");
	expect(screen).toContain("Cancel is selected initially");
	dashboard.handleInput("\r");
	expect(writes).toHaveLength(0);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	dashboard.handleInput("review releases");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("Review agent file creation"));
	screen = Bun.stripANSI(dashboard.render(100).join("\n"));
	expect(screen).toContain("/fixture/project/agents/release-reviewer.md");
	expect(writes).toHaveLength(0);
	dashboard.handleInput("\r");
	expect(writes).toHaveLength(0);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	dashboard.handleInput("review releases");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("Review agent file creation"));
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => writes.length === 1);
	expect(writes[0]!.file).toBe("/fixture/project/agents/release-reviewer.md");
	expect(writes[0]!.content).toContain("Use this agent when a release needs review.");
});

test("creation collision never overwrites the target", async () => {
	const write = vi.fn(async () => {});
	const dashboard = await AgentDashboard.create(
		"/fixture",
		Settings.isolated(),
		24,
		{},
		fixtureDependencies(async () => ({ agents: [] }), {
			stat: async () => ({}),
			writeExclusive: write,
		}),
	);
	dashboard.handleInput("\r");
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	dashboard.handleInput("review releases");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("Review agent file creation"));
	dashboard.handleInput("\x1b[B");
	dashboard.handleInput("\r");
	await settle(() => Bun.stripANSI(dashboard.render(100).join("\n")).includes("no longer available"));
	expect(write).not.toHaveBeenCalled();
});

test("refresh retains cached agents, ignores stale results, and reports failure", async () => {
	const pending: Array<PromiseWithResolvers<{ agents: AgentDefinition[] }>> = [];
	let initial = true;
	const dashboard = await AgentDashboard.create(
		"/fixture",
		Settings.isolated(),
		24,
		{},
		fixtureDependencies(async () => {
			if (initial) {
				initial = false;
				return { agents: [agent("initial-agent")] };
			}
			const resolver = Promise.withResolvers<{ agents: AgentDefinition[] }>();
			pending.push(resolver);
			return resolver.promise;
		}),
	);
	dashboard.handleInput("\x12");
	dashboard.handleInput("\x12");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("initial-agent");
	pending[1]!.resolve({ agents: [agent("newest-agent")] });
	await Bun.sleep(0);
	pending[0]!.resolve({ agents: [agent("stale-agent")] });
	await Bun.sleep(0);
	const refreshed = Bun.stripANSI(dashboard.render(80).join("\n"));
	expect(refreshed).toContain("newest-agent");
	expect(refreshed).not.toContain("stale-agent");
	dashboard.handleInput("\x12");
	pending[2]!.reject(new Error("fixture offline"));
	await Bun.sleep(0);
	const failed = Bun.stripANSI(dashboard.render(80).join("\n"));
	expect(failed).toContain("newest-agent");
	expect(failed).toContain("Refresh failed: fixture offline");
});

test("editable searches survive tab changes, Ctrl+C is not Back, and mouse opens details", async () => {
	const store = Settings.isolated();
	const set = vi.spyOn(store, "set");
	const dashboard = await AgentDashboard.create(
		"/fixture",
		store,
		24,
		{},
		fixtureDependencies(async () => ({ agents: [agent("alpha-agent"), agent("beta-agent", "user")] })),
	);
	dashboard.handleInput("\t");
	dashboard.handleInput("alpha");
	dashboard.handleInput("\t");
	dashboard.handleInput("beta");
	dashboard.handleInput("\x1b[Z");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Search: > alpha");
	dashboard.handleInput("\x03");
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Agent control center");
	dashboard.handleInput("\x1b");
	const lines = dashboard.render(80).map(Bun.stripANSI);
	const row = lines.findIndex(line => line.includes("alpha-agent") && line.includes("Project"));
	expect(row).toBeGreaterThan(0);
	const click = { wheel: null, leftClick: true, release: false } as never;
	dashboard.routeMouse(click, row);
	dashboard.routeMouse(click, row);
	expect(Bun.stripANSI(dashboard.render(80).join("\n"))).toContain("Agent details");
	expect(set).not.toHaveBeenCalled();
});
