import { expect, test } from "bun:test";
import { ExtensionRuntime, loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import { EventBus } from "../src/utils/event-bus";

test("setup extension factory receives an isolated environment settings reader", async () => {
	let observed: unknown;
	const settings = { get: (key: string) => (key === "bash.environment" ? { XCSH_NAMESPACE: "fixture" } : undefined) };
	await loadExtensionFromFactory(
		pi => {
			observed = (pi as any).settings?.get("bash.environment");
		},
		"/tmp",
		new EventBus(),
		new ExtensionRuntime(),
		"fixture-settings",
		settings,
	);
	expect(observed).toEqual({ XCSH_NAMESPACE: "fixture" });
});
