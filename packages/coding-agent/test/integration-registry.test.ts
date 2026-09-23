import { afterEach, describe, expect, test } from "bun:test";
import { reviewAndExecuteIntegrationSetup, selectSetupIntegration } from "../src/cli/plugin-cli";
import { IntegrationRegistry } from "../src/integrations/registry";
import { describeSetupPlan, executeInstallAuthorizedSetup, executeReviewedSetup } from "../src/integrations/setup";

const ready = <T>(value: T) => ({ state: "ready" as const, value });

describe("IntegrationRegistry", () => {
	let registry: IntegrationRegistry;
	afterEach(() => registry?.clear());

	test("rejects cross-owner collisions and permits owner-scoped unregister", () => {
		registry = new IntegrationRegistry();
		registry.register("plugin:a", { id: "github", name: "GitHub", kind: "network", probe: async () => ready(1) });
		expect(() =>
			registry.register("plugin:b", { id: "github", name: "Other", kind: "network", probe: async () => ready(2) }),
		).toThrow("already registered");
		expect(registry.unregister("plugin:b", "github")).toBe(false);
		expect(registry.unregister("plugin:a", "github")).toBe(true);
	});

	test("coalesces concurrent consumers and observes the network success TTL", async () => {
		let now = 1_000;
		let probes = 0;
		registry = new IntegrationRegistry({ now: () => now });
		const handle = registry.register("plugin:a", {
			id: "github",
			name: "GitHub",
			kind: "network",
			probe: async () => {
				probes++;
				await Bun.sleep(5);
				return ready(probes);
			},
		});
		const [a, b, c] = await Promise.all([handle.get(), handle.get(), handle.get()]);
		expect([a.value, b.value, c.value]).toEqual([1, 1, 1]);
		expect(probes).toBe(1);
		now += 29 * 60_000;
		expect((await handle.get()).value).toBe(1);
		now += 60_001;
		expect((await handle.get()).value).toBe(2);
	});

	test("uses five-minute local TTL and invalidation", async () => {
		let now = 1_000;
		let probes = 0;
		registry = new IntegrationRegistry({ now: () => now });
		const handle = registry.register("plugin:a", {
			id: "terraform",
			name: "Terraform",
			kind: "local",
			probe: async () => ready(++probes),
		});
		expect((await handle.get()).value).toBe(1);
		now += 299_999;
		expect((await handle.get()).value).toBe(1);
		handle.invalidate();
		expect((await handle.get()).value).toBe(2);
	});

	test("backs failures off exponentially without exposing exception values", async () => {
		let now = 1_000;
		let probes = 0;
		registry = new IntegrationRegistry({ now: () => now });
		const handle = registry.register("plugin:a", {
			id: "azure",
			name: "Azure",
			kind: "network",
			probe: async () => {
				probes++;
				throw new Error("secret tenant value");
			},
		});
		const first = await handle.get();
		expect(first).toMatchObject({ state: "error", reason: "invalid_response", retryAt: now + 300_000 });
		expect(JSON.stringify(first)).not.toContain("secret tenant value");
		now += 299_999;
		await handle.get();
		expect(probes).toBe(1);
		now += 2;
		const second = await handle.get();
		expect(second.retryAt).toBe(now + 600_000);
	});

	test("honors rate-limit retry and a one-hour minimum", async () => {
		let now = 1_000;
		let retryAfterMs = 10_000;
		registry = new IntegrationRegistry({ now: () => now });
		const handle = registry.register("plugin:a", {
			id: "gitlab",
			name: "GitLab",
			kind: "network",
			probe: async () => ({ state: "rate_limited", reason: "rate_limited", retryAfterMs }),
		});
		expect((await handle.get()).retryAt).toBe(now + 3_600_000);
		now += 3_600_001;
		retryAfterMs = 7_200_000;
		expect((await handle.get()).retryAt).toBe(now + 7_200_000);
	});

	test("validates dependencies and rejects cycles", () => {
		registry = new IntegrationRegistry();
		registry.register("plugin:a", {
			id: "platform",
			name: "Platform",
			kind: "local",
			dependencies: ["azure"],
			probe: async () => ready(undefined),
		});
		expect(() =>
			registry.register("plugin:b", {
				id: "azure",
				name: "Azure",
				kind: "network",
				dependencies: ["platform"],
				probe: async () => ready(undefined),
			}),
		).toThrow("dependency cycle");
	});

	test("freezes reviewed setup plans and performs exactly one post-setup verification", async () => {
		let probes = 0;
		registry = new IntegrationRegistry();
		const handle = registry.register("plugin:a", {
			id: "github",
			name: "GitHub",
			kind: "network",
			setup: {
				pluginDependencies: ["platform"],
				requiredEnvironment: ["GH_HOST"],
				profileFields: ["accounts", "email"],
				steps: [{ kind: "login", argv: ["gh", "auth", "login"], timeoutMs: 120_000 }],
				verification: [{ argv: ["gh", "auth", "status"], timeoutMs: 15_000 }],
			},
			probe: async () => ready(++probes),
		});
		const plan = handle.setupPlan!;
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.steps[0].argv)).toBe(true);
		await handle.get();
		expect(probes).toBe(1);
		await handle.verifyAfterSetup(plan);
		expect(probes).toBe(2);
		expect((await handle.get()).value).toBe(2);
		expect(probes).toBe(2);
		expect(() => handle.verifyAfterSetup(structuredClone(plan))).toThrow("reviewed setup plan");
	});

	test("owner cleanup removes all registrations", () => {
		registry = new IntegrationRegistry();
		registry.register("plugin:a", { id: "one", name: "One", kind: "local", probe: async () => ready(1) });
		registry.register("plugin:a", { id: "two", name: "Two", kind: "local", probe: async () => ready(2) });
		expect(registry.unregisterOwner("plugin:a")).toBe(2);
		expect(registry.list()).toEqual([]);
	});

	test("executes only the immutable reviewed argv and verifies once", async () => {
		let probes = 0;
		registry = new IntegrationRegistry();
		const handle = registry.register("plugin:a", {
			id: "github",
			name: "GitHub",
			plugin: "github@f5-sales-demo",
			kind: "network",
			setup: {
				pluginDependencies: [],
				requiredEnvironment: ["GH_HOST"],
				profileFields: ["accounts"],
				steps: [{ kind: "login", argv: ["gh", "auth", "login"], timeoutMs: 10_000 }],
				verification: [{ argv: ["gh", "auth", "status"], timeoutMs: 5_000 }],
			},
			probe: async () => ready(++probes),
		});
		const reviewed = handle.setupPlan!;
		const seen: string[][] = [];
		const result = await executeReviewedSetup(handle, reviewed, async step => {
			seen.push([...step.argv]);
			return 0;
		});
		expect(seen).toEqual([["gh", "auth", "login"]]);
		expect(result.value).toBe(1);
		expect(probes).toBe(1);
		expect(describeSetupPlan(handle)).toContain('["gh","auth","login"]');
		expect(describeSetupPlan(handle)).toContain("GH_HOST");
	});

	test("selects the sole setup-bearing integration for a multi-integration plugin", () => {
		registry = new IntegrationRegistry();
		const account = registry.register("plugin:github", {
			id: "github",
			name: "GitHub",
			plugin: "github",
			kind: "network",
			setup: {
				pluginDependencies: [],
				requiredEnvironment: [],
				profileFields: ["accounts"],
				steps: [{ kind: "login", argv: ["gh", "auth", "login"], timeoutMs: 10_000 }],
				verification: [{ argv: ["gh", "api", "user"], timeoutMs: 5_000 }],
			},
			probe: async () => ready(undefined),
		});
		registry.register("plugin:github", {
			id: "github_email",
			name: "GitHub email",
			plugin: "github",
			kind: "network",
			probe: async () => ready(undefined),
		});
		expect(selectSetupIntegration(registry.list(), "github")).toBe(account);
	});

	test("does not execute setup or verification when the integration is already ready", async () => {
		const get = async () => ({
			id: "github",
			name: "GitHub",
			state: "ready" as const,
			checkedAt: 1,
			durationMs: 0,
		});
		const verifyAfterSetup = () => {
			throw new Error("setup must not run");
		};
		const result = await reviewAndExecuteIntegrationSetup({
			id: "github",
			name: "GitHub",
			setupPlan: {
				pluginDependencies: [],
				requiredEnvironment: [],
				profileFields: [],
				steps: [{ kind: "login", argv: ["never"], timeoutMs: 1_000 }],
				verification: [],
			},
			get,
			invalidate() {},
			verifyAfterSetup,
		});
		expect(result.state).toBe("ready");
	});

	test("install authorization executes setup once without a second confirmation", async () => {
		let executions = 0;
		const plan = {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [{ kind: "install" as const, argv: ["controller", "setup", "apply"], timeoutMs: 1_000 }],
			verification: [],
		};
		const result = await executeInstallAuthorizedSetup({
			plugin: "kvm",
			lifecycle: { setupRequired: true, setupAuthorization: "install" },
			trigger: "direct-install",
			handles: [
				{
					id: "kvm_smsv2",
					name: "KVM SMSv2",
					plugin: "kvm@f5-sales-demo",
					setupPlan: plan,
					get: async () => ({
						id: "kvm_smsv2",
						name: "KVM SMSv2",
						state: "setup_required",
						checkedAt: 1,
						durationMs: 0,
					}),
					invalidate() {},
					verifyAfterSetup: async () => ({
						id: "kvm_smsv2",
						name: "KVM SMSv2",
						state: "ready",
						checkedAt: 2,
						durationMs: 0,
					}),
				},
			],
			run: async () => {
				executions++;
				return 0;
			},
		});
		expect(result?.state).toBe("ready");
		expect(executions).toBe(1);
	});

	test.each(["bulk-install", "upgrade", "cache-refresh", "dependency-install"] as const)(
		"%s never consumes install-scoped setup authorization",
		async trigger => {
			let executions = 0;
			const result = await executeInstallAuthorizedSetup({
				plugin: "kvm",
				lifecycle: { setupRequired: true, setupAuthorization: "install" },
				trigger,
				handles: [],
				run: async () => {
					executions++;
					return 0;
				},
			});
			expect(result).toBeUndefined();
			expect(executions).toBe(0);
		},
	);
});
