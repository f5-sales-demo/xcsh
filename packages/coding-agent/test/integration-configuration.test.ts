import { expect, test } from "bun:test";
import { reviewAndExecuteIntegrationSetup, shouldSkipIntegrationSetup } from "../src/cli/plugin-cli";
import { IntegrationRegistry } from "../src/integrations/registry";
import { executeConfigurationSetup } from "../src/integrations/setup";
import { reviewIntegrationConfiguration } from "../src/modes/components/integration-configuration";
import type { InteractiveModeContext } from "../src/modes/types";

function fixture() {
	const events: string[] = [];
	const registry = new IntegrationRegistry();
	const handle = registry.register("plugin:example", {
		id: "example",
		name: "Example",
		kind: "network",
		setup: {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [{ kind: "login", argv: ["example", "login"], timeoutMs: 1000 }],
			verification: [{ argv: ["example", "status"], timeoutMs: 1000 }],
		},
		probe: async () => ({ state: "ready" as const }),
		prepareConfiguration: async () => {
			events.push("discover");
			return {
				title: "Private configuration",
				summary: ["No records or secrets"],
				questions: [{ id: "amount", prompt: "Amount field", defaultValue: "Amount" }],
				validate: async (answers: Readonly<Record<string, string>>) => {
					events.push("validate");
					if (answers.amount !== "Amount") throw new Error("Invalid mapping");
				},
				apply: async () => {
					events.push("apply");
				},
			};
		},
	});
	return { handle, events };
}

test("authenticated configuration refresh discovers, reviews, validates and applies without login", async () => {
	const { handle, events } = fixture();
	await executeConfigurationSetup(handle, async plan => {
		events.push("review");
		expect(plan.questions[0].defaultValue).toBe("Amount");
		return { amount: "Amount" };
	});
	expect(events).toEqual(["discover", "review", "validate", "apply"]);
});

test("terminal setup refreshes configuration on a ready integration without running login", async () => {
	const { handle, events } = fixture();
	await reviewAndExecuteIntegrationSetup(handle, { reviewConfiguration: async () => ({ amount: "Amount" }) });
	expect(events).toEqual(["discover", "validate", "apply"]);
});

test("TUI configuration collects answers and reviews them before applying", async () => {
	const { handle, events } = fixture();
	let prompts = 0;
	const ctx = {
		showHookCustom: async () => {
			events.push(++prompts === 1 ? "input" : "review");
			return prompts === 1 ? "Amount" : "succeeded";
		},
	} as unknown as InteractiveModeContext;
	await reviewIntegrationConfiguration(ctx, handle, async (_ctx, _title, action) => {
		events.push("review");
		const current = await action.resolve();
		if (!current) throw new Error("Missing review");
		await action.execute(current.target, AbortSignal.timeout(1000));
		return "succeeded";
	});
	expect(events).toEqual(["discover", "input", "validate", "review", "validate", "apply"]);
});

test("TUI cancellation and failed writes do not report success", async () => {
	const { handle, events } = fixture();
	const ctx = { showHookCustom: async () => undefined } as unknown as InteractiveModeContext;
	await expect(reviewIntegrationConfiguration(ctx, handle)).rejects.toThrow("cancelled");
	expect(events).not.toContain("apply");
	const registry = new IntegrationRegistry();
	const failing = registry.register("fail", {
		id: "fail",
		name: "Fail",
		kind: "network",
		probe: async () => ({ state: "ready" }),
		prepareConfiguration: async () => ({
			title: "Failure",
			summary: [],
			questions: [],
			validate: async () => {},
			apply: async () => {
				throw new Error("Write failed");
			},
		}),
	});
	await expect(executeConfigurationSetup(failing, async () => ({}))).rejects.toThrow("Write failed");
});

test("cancelled and invalid configuration reviews never apply", async () => {
	const { handle, events } = fixture();
	await expect(executeConfigurationSetup(handle, async () => undefined)).rejects.toThrow("cancelled");
	expect(events).toEqual(["discover"]);
	await expect(executeConfigurationSetup(handle, async () => ({ amount: "Guessed" }))).rejects.toThrow("Invalid");
	expect(events).not.toContain("apply");
});

test("a superseded discovery plan cannot replace configuration", async () => {
	const { handle, events } = fixture();
	const first = await handle.prepareConfiguration!();
	await handle.prepareConfiguration!();
	await expect(first.apply({ amount: "Amount" })).rejects.toThrow("changed");
	expect(events).not.toContain("apply");
});

test("legacy integrations do not invoke configuration review", async () => {
	const registry = new IntegrationRegistry();
	const handle = registry.register("legacy", {
		id: "legacy",
		name: "Legacy",
		kind: "local",
		probe: async () => ({ state: "ready" }),
	});
	expect(handle.prepareConfiguration).toBeUndefined();
	await executeConfigurationSetup(handle, async () => {
		throw new Error("Unexpected review");
	});
});

test("configuration cannot run before authentication or after cancellation", async () => {
	const registry = new IntegrationRegistry();
	const handle = registry.register("offline", {
		id: "offline",
		name: "Offline",
		kind: "network",
		probe: async () => ({ state: "setup_required" }),
		prepareConfiguration: async () => {
			throw new Error("Unexpected discovery");
		},
	});
	await expect(executeConfigurationSetup(handle, async () => ({}))).rejects.toThrow("ready");
	const { handle: ready } = fixture();
	await expect(executeConfigurationSetup(ready, async () => ({}), AbortSignal.abort())).rejects.toThrow();
});

test("an unavailable configuration integration never prepares OAuth to repair a network failure", async () => {
	const registry = new IntegrationRegistry();
	const handle = registry.register("network", {
		id: "network",
		name: "Network",
		kind: "network",
		setup: {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [{ kind: "login", argv: ["example", "login"], timeoutMs: 1000 }],
			verification: [{ argv: ["example", "status"], timeoutMs: 1000 }],
		},
		probe: async () => ({ state: "unavailable", reason: "network" }),
		prepareSetup: async () => {
			throw new Error("Unexpected OAuth preparation");
		},
		prepareConfiguration: async () => {
			throw new Error("Unexpected discovery");
		},
	});
	await expect(reviewAndExecuteIntegrationSetup(handle)).rejects.toThrow("authentication could not be verified");
});

test("failed discovery invalidates cached authentication so the next setup can verify an expired session", async () => {
	let expired = false;
	const registry = new IntegrationRegistry();
	const handle = registry.register("refresh", {
		id: "refresh",
		name: "Refresh",
		kind: "network",
		probe: async () => (expired ? { state: "setup_required", reason: "expired" } : { state: "ready" }),
		prepareConfiguration: async () => {
			expired = true;
			throw new Error("Session expired");
		},
	});
	expect((await handle.get()).state).toBe("ready");
	await expect(handle.prepareConfiguration!()).rejects.toThrow("expired");
	expect((await handle.get()).reason).toBe("expired");
});

test("CLI setup enters configuration review for a ready configurable integration", async () => {
	const { handle, events } = fixture();
	const current = await handle.get();
	expect(shouldSkipIntegrationSetup(current.state, false, Boolean(handle.prepareConfiguration))).toBe(false);
	expect(shouldSkipIntegrationSetup(current.state, false, false)).toBe(true);
	await reviewAndExecuteIntegrationSetup(handle, { reviewConfiguration: async () => ({ amount: "Amount" }) });
	expect(events).toEqual(["discover", "validate", "apply"]);
});
