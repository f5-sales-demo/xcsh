import { afterEach, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { ExtensionRuntime, loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { ExtensionToolWrapper, wrapRegisteredTools } from "../src/extensibility/extensions/wrapper";
import { IntegrationRegistry, integrationRegistry } from "../src/integrations/registry";
import { PersonProfileService, personProfileService } from "../src/person-profile/service";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

const base = "/tmp/xcsh-owner-fixture/.xcsh/plugins/cache/plugins";
const oldOwner = `${base}/qualification___platform___6.2.5+snapshot.${"a".repeat(16)}/src/index.ts`;
const newOwner = `${base}/qualification___platform___6.2.6+snapshot.${"b".repeat(16)}/src/index.ts`;
afterEach(() => {
	for (const owner of [oldOwner, newOwner]) {
		integrationRegistry.unregisterOwner(owner);
		personProfileService.unregisterProfileCollectorsByRegistrant(owner);
	}
});
const definition = {
	id: "owner_upgrade_fixture",
	name: "Fixture integration",
	kind: "local" as const,
	probe: async () => ({ state: "ready" as const, value: "fixture" }),
};
const collector = (name: string) => ({
	id: "owner_upgrade_profile",
	name,
	available: async () => true,
	collect: async () => ({ facts: {}, observations: [] }),
});
it("reloads a versioned installed plugin once while retaining its replacement integration, profile collector and tool", async () => {
	const auth = await AuthStorage.create(":memory:");
	try {
		const oldRuntime = new ExtensionRuntime();
		const factory =
			(value: string) =>
			(pi: Parameters<typeof loadExtensionFromFactory>[0] extends (api: infer A) => unknown ? A : never) => {
				pi.integrations.register({ ...definition, probe: async () => ({ state: "ready" as const, value }) });
				pi.personProfile.registerCollector(collector(value));
				pi.registerTool({
					name: "owner_upgrade_tool",
					label: "Fixture",
					description: "Fixture",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: value }] }),
				});
			};
		const old = await loadExtensionFromFactory(factory("old"), process.cwd(), new EventBus(), oldRuntime, oldOwner);
		const runner = new ExtensionRunner(
			[old],
			oldRuntime,
			process.cwd(),
			SessionManager.inMemory(),
			new ModelRegistry(auth),
		);
		const newRuntime = new ExtensionRuntime();
		const replacement = await loadExtensionFromFactory(
			factory("new"),
			process.cwd(),
			new EventBus(),
			newRuntime,
			newOwner,
		);
		await runner.reloadExtensions([replacement], newRuntime);
		expect((await integrationRegistry.get(definition.id)!.get()).value).toBe("new");
		expect(personProfileService.listCollectors().find(c => c.id === "owner_upgrade_profile")?.name).toBe("new");
		const registered = wrapRegisteredTools(runner.getAllRegisteredTools(), runner);
		const result = await new ExtensionToolWrapper(registered[0]!, runner).execute("fixture", {});
		expect(result.content).toEqual([{ type: "text", text: "new" }]);
		expect(integrationRegistry.unregisterOwner(oldOwner)).toBe(0);
		expect(integrationRegistry.unregisterOwner(newOwner)).toBe(1);
	} finally {
		await auth.close();
	}
});
it("updates the same versioned profile source without letting old-owner cleanup remove its replacement", () => {
	const service = new PersonProfileService("/tmp/xcsh-owner-fixture/person-never-written.json");
	service.registerProfileCollector(collector("old"), oldOwner);
	service.registerProfileCollector(collector("new"), newOwner);
	expect(service.unregisterProfileCollectorsByRegistrant(oldOwner)).toBe(0);
	expect(service.listCollectors()).toEqual([{ id: "owner_upgrade_profile", name: "new" }]);
	expect(service.unregisterProfileCollectorsByRegistrant(newOwner)).toBe(1);
});
it("preserves collisions for a different marketplace, plugin, source module or OS-user cache", () => {
	for (const owner of [
		newOwner.replace("qualification___", "other___"),
		newOwner.replace("___platform___", "___other___"),
		newOwner.replace("/src/index.ts", "/src/other.ts"),
		newOwner.replace("xcsh-owner-fixture", "another-owner"),
	]) {
		const registry = new IntegrationRegistry();
		registry.register(oldOwner, definition);
		expect(() => registry.register(owner, definition)).toThrow("already registered");
		expect(registry.unregisterOwner(owner)).toBe(0);
		expect(registry.unregisterOwner(oldOwner)).toBe(1);
	}
});

it("rebinds a versioned integration owner and preserves the new handle during old-owner retirement", () => {
	const registry = new IntegrationRegistry();
	registry.register(oldOwner, definition);
	const replacement = registry.register(newOwner, { ...definition, name: "New fixture" });
	expect(registry.unregisterOwner(oldOwner)).toBe(0);
	expect(registry.get(definition.id)).toBe(replacement);
	expect(registry.unregisterOwner(newOwner)).toBe(1);
});

it("recognizes Windows cache separators while retaining exact-path retirement", () => {
	const registry = new IntegrationRegistry();
	const old = oldOwner.replaceAll("/", String.fromCharCode(92));
	const next = newOwner.replaceAll("/", String.fromCharCode(92));
	registry.register(old, definition);
	registry.register(next, definition);
	expect(registry.unregisterOwner(old)).toBe(0);
	expect(registry.unregisterOwner(next)).toBe(1);
});
