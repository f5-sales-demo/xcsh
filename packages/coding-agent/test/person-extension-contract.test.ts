import { expect, test } from "bun:test";
import { loadExtensionFromFactory, loadExtensions } from "../src/extensibility/extensions/loader";
import type { ExtensionAPI } from "../src/extensibility/extensions/types";
import { personProfileService } from "../src/person-profile/service";
import { EventBus } from "../src/utils/event-bus";

test("extension API exposes only canonical personProfile and scopes collector collision, reload and removal", async () => {
	const { runtime } = await loadExtensions([], process.cwd());
	const events = new EventBus();
	const id = "synthetic_extension_contract";
	const collector = {
		id,
		name: "Synthetic",
		available: async () => true,
		collect: async () => ({
			facts: {},
			observations: [
				{
					field: "givenName" as const,
					value: "Synthetic",
					source: id,
					kind: "observed" as const,
					observedAt: new Date().toISOString(),
				},
			],
		}),
	};
	personProfileService.registerProfileCollector(collector);
	let api: ExtensionAPI | undefined;
	try {
		const factory = (value: ExtensionAPI) => {
			api = value;
			value.personProfile.registerCollector(collector);
		};
		await loadExtensionFromFactory(factory, process.cwd(), events, runtime, "synthetic:owner");
		expect(typeof api!.personProfile.get).toBe("function");
		expect("loadProfile" in api!.pi).toBe(false);
		expect("registerProfileCollector" in api!).toBe(false);
		expect(
			personProfileService
				.listCollectors()
				.filter(c => c.id.startsWith(id))
				.map(c => c.id)
				.sort(),
		).toEqual([id, `${id}_extension`]);
		await loadExtensionFromFactory(factory, process.cwd(), events, runtime, "synthetic:owner");
		await expect(
			loadExtensionFromFactory(factory, process.cwd(), events, runtime, "synthetic:other"),
		).rejects.toThrow();
		await loadExtensionFromFactory(
			value => {
				api = value;
			},
			process.cwd(),
			events,
			runtime,
			"synthetic:owner",
		);
		expect(api!.personProfile.unregisterCollector(id)).toBe(false);
		expect(personProfileService.listCollectors().some(c => c.id === id)).toBe(true);
	} finally {
		personProfileService.unregisterProfileCollector(`${id}_extension`, "synthetic:owner");
		personProfileService.unregisterProfileCollector(id);
	}
});
