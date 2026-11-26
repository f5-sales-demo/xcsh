import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { ExtensionRuntime } from "../src/extensibility/extensions/loader";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import type { Extension } from "../src/extensibility/extensions/types";
import { integrationRegistry } from "../src/integrations/registry";
import type { IntegrationHandle, IntegrationProbeResult } from "../src/integrations/types";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

describe("startup prerequisite cache", () => {
	let dir: TempDir;
	let auth: AuthStorage;
	let models: ModelRegistry;
	beforeEach(async () => {
		integrationRegistry.clear();
		dir = TempDir.createSync("@startup-prerequisite-");
		auth = await AuthStorage.create(join(dir.path(), "auth.db"));
		models = new ModelRegistry(auth);
	});
	afterEach(() => {
		integrationRegistry.clear();
		auth?.close();
		dir.removeSync();
	});
	function extension(handles: IntegrationHandle<unknown>[], bind: () => void | Promise<void>): Extension {
		return {
			path: "fixture:startup",
			resolvedPath: "fixture:startup",
			handlers: new Map([["session_start", [async () => bind()]]]),
			integrations: new Map(handles.map(h => [h.id, h])),
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
			advisories: new Map(),
		};
	}
	function runner(ext: Extension): ExtensionRunner {
		return new ExtensionRunner([ext], new ExtensionRuntime(), dir.path(), SessionManager.inMemory(), models);
	}
	function register(id: string, probe: () => Promise<IntegrationProbeResult<unknown>>, dependencies?: string[]) {
		return integrationRegistry.register("fixture:startup", { id, name: id, kind: "local", probe, dependencies });
	}
	function deferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>(r => {
			resolve = r;
		});
		return { promise, resolve };
	}

	test("re-evaluates cached authentication and blocked GCloud after session handlers bind context", async () => {
		let bound = false;
		let platformCalls = 0;
		const platform = register("platform", async () => {
			platformCalls++;
			return bound
				? { state: "ready", value: "context-bound" }
				: { state: "setup_required", reason: "not_authenticated" };
		});
		const gcloud = register("gcloud", async () => ({ state: "ready" }), ["platform"]);
		expect((await platform.get()).reason).toBe("not_authenticated");
		expect((await gcloud.get()).reason).toBe("dependency_missing");
		await runner(
			extension([platform, gcloud], () => {
				bound = true;
			}),
		).emit({ type: "session_start" });
		expect((await gcloud.get()).state).toBe("ready");
		expect((await platform.get()).value).toBe("context-bound");
		expect(platformCalls).toBe(2);
	});

	test("refreshes transitive blocked consumers after an expired authentication prerequisite", async () => {
		let bound = false;
		const platform = register("platform", async () =>
			bound ? { state: "ready" } : { state: "setup_required", reason: "expired" },
		);
		const gcloud = register("gcloud", async () => ({ state: "ready" }), ["platform"]);
		const deployment = register("deployment", async () => ({ state: "ready" }), ["gcloud"]);
		expect((await deployment.get()).reason).toBe("dependency_missing");
		await runner(
			extension([deployment, gcloud, platform], () => {
				bound = true;
			}),
		).emit({ type: "session_start" });
		expect((await deployment.get()).state).toBe("ready");
	});

	test("a genuine unauthenticated session still refuses and repeated session_start cannot bypass cooldown", async () => {
		let calls = 0;
		const platform = register("platform", async () => {
			calls++;
			return { state: "setup_required", reason: "not_authenticated" };
		});
		await platform.get();
		const r = runner(extension([platform], () => {}));
		await r.emit({ type: "session_start" });
		const failure = await platform.get();
		expect(failure.reason).toBe("not_authenticated");
		expect(calls).toBe(2);
		await Promise.all([r.emit({ type: "session_start" }), r.emit({ type: "session_start" })]);
		expect(await platform.get()).toBe(failure);
		expect(calls).toBe(2);
	});

	test("retains network, rate-limit, permission and unrelated ready snapshots", async () => {
		const states: IntegrationProbeResult<unknown>[] = [
			{ state: "error", reason: "network" },
			{ state: "rate_limited", reason: "rate_limited", retryAfterMs: 7_200_000 },
			{ state: "unavailable", reason: "permission_denied" },
			{ state: "ready", value: "terraform-local" },
		];
		const handles = states.map((state, i) => register(`service_${i}`, async () => state));
		const before = await Promise.all(handles.map(h => h.get()));
		await runner(extension(handles, () => {})).emit({ type: "session_start" });
		for (let i = 0; i < handles.length; i++) expect(await handles[i]!.get()).toBe(before[i]);
	});

	test("preserves dependency_missing caused by missing CLI or an absent integration", async () => {
		const cli = register("cli", async () => ({ state: "unavailable", reason: "cli_missing" }));
		const blocked = register("blocked", async () => ({ state: "ready" }), ["cli"]);
		const absent = register("absent", async () => ({ state: "ready" }), ["uninstalled"]);
		const before = await Promise.all([blocked.get(), absent.get()]);
		await runner(extension([cli, blocked, absent], () => {})).emit({ type: "session_start" });
		expect(await blocked.get()).toBe(before[0]);
		expect(await absent.get()).toBe(before[1]);
	});

	test("refreshes a late pre-initialization authentication result once for concurrent readers", async () => {
		let calls = 0;
		const pending = deferred<IntegrationProbeResult<unknown>>();
		const entered = deferred<void>();
		const platform = register("platform", async () => {
			if (++calls === 1) {
				entered.resolve();
				return pending.promise;
			}
			return { state: "ready", value: "new-binding" };
		});
		const first = platform.get();
		await entered.promise;
		await runner(extension([platform], () => {})).emit({ type: "session_start" });
		const second = platform.get();
		pending.resolve({ state: "setup_required", reason: "not_authenticated" });
		const snapshots = await Promise.all([first, second]);
		expect(snapshots.map(s => s.value)).toEqual(["new-binding", "new-binding"]);
		expect(snapshots[0]).toBe(snapshots[1]);
		expect(calls).toBe(2);
	});

	test.each(["network", "rate_limited"] as const)(
		"does not replay a late %s failure across initialization",
		async reason => {
			let calls = 0;
			const pending = deferred<IntegrationProbeResult<unknown>>();
			const entered = deferred<void>();
			const handle = register("service", async () => {
				calls++;
				entered.resolve();
				return pending.promise;
			});
			const first = handle.get();
			await entered.promise;
			await runner(extension([handle], () => {})).emit({ type: "session_start" });
			pending.resolve({ state: reason === "network" ? "error" : "rate_limited", reason });
			const snapshot = await first;
			expect(await handle.get()).toBe(snapshot);
			expect(calls).toBe(1);
		},
	);

	test("waits for asynchronous context binding before invalidating cached prerequisites", async () => {
		let bound = false;
		const pending = deferred<void>();
		const entered = deferred<void>();
		const platform = register("platform", async () =>
			bound ? { state: "ready" } : { state: "setup_required", reason: "not_authenticated" },
		);
		const before = await platform.get();
		const start = runner(
			extension([platform], async () => {
				entered.resolve();
				await pending.promise;
				bound = true;
			}),
		).emit({ type: "session_start" });
		await entered.promise;
		expect(await platform.get()).toBe(before);
		pending.resolve();
		await start;
		expect((await platform.get()).state).toBe("ready");
	});

	test("a replaced handle cannot read or invalidate the current owner's cache", async () => {
		const old = register("platform", async () => ({ state: "ready", value: "old-owner" }));
		integrationRegistry.unregisterOwner("fixture:startup");
		const current = integrationRegistry.register("new-owner", {
			id: "platform",
			name: "platform",
			kind: "local",
			probe: async () => ({ state: "ready", value: "new-owner" }),
		});
		const snapshot = await current.get();
		old.invalidate();
		expect(await current.get()).toBe(snapshot);
		await expect(old.get()).rejects.toThrow("registration changed");
	});

	test("late results from a removed owner cannot switch callers to its replacement", async () => {
		const pending = deferred<IntegrationProbeResult<unknown>>();
		const entered = deferred<void>();
		const old = register("platform", async () => {
			entered.resolve();
			return pending.promise;
		});
		const first = old.get();
		await entered.promise;
		integrationRegistry.unregisterOwner("fixture:startup");
		const current = integrationRegistry.register("new-owner", {
			id: "platform",
			name: "platform",
			kind: "local",
			probe: async () => ({ state: "ready", value: "replacement" }),
		});
		pending.resolve({ state: "setup_required", reason: "not_authenticated" });
		await expect(first).rejects.toThrow("registration changed");
		expect((await current.get()).value).toBe("replacement");
	});

	test("a stale runner cannot initialize a replacement registration", async () => {
		const old = register("platform", async () => ({ state: "setup_required", reason: "not_authenticated" }));
		const staleRunner = runner(extension([old], () => {}));
		integrationRegistry.unregisterOwner("fixture:startup");
		const current = integrationRegistry.register("new-owner", {
			id: "platform",
			name: "platform",
			kind: "local",
			probe: async () => ({ state: "setup_required", reason: "not_authenticated" }),
		});
		const before = await current.get();
		await staleRunner.emit({ type: "session_start" });
		expect(await current.get()).toBe(before);
	});

	test("reload initialization refreshes new handles and preserves retired owner's evidence", async () => {
		let bound = false;
		const old = register("platform", async () => ({ state: "setup_required", reason: "not_authenticated" }));
		const r = runner(extension([old], () => {}));
		const runtime = new ExtensionRuntime();
		r.initialize(runtime, {
			getModel: () => undefined,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: async () => {},
			getSystemPrompt: () => "",
		});
		await r.emit({ type: "session_start" });
		const oldSnapshot = await old.get();
		const current = register("platform", async () =>
			bound ? { state: "ready" } : { state: "setup_required", reason: "not_authenticated" },
		);
		await current.get();
		await r.reloadExtensions(
			[
				extension([current], () => {
					bound = true;
				}),
			],
			runtime,
		);
		expect((await current.get()).state).toBe("ready");
		expect(oldSnapshot.reason).toBe("not_authenticated");
		await expect(old.get()).rejects.toThrow("registration changed");
	});
});
