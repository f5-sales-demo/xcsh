import type { ExtensionAPI } from "../../src/extensibility/extensions/types";
/** Explicit task fixture: review/cancel never requires credentials or infrastructure. */
export default function setupFixture(pi: ExtensionAPI): void {
	pi.integrations.register({
		id: "presentation-fixture",
		name: "Synthetic presentation setup",
		plugin: "presentation-fixture",
		kind: "local",
		setup: {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [{ kind: "install", argv: ["printf", "%s\n", "synthetic setup argument"], timeoutMs: 5000 }],
			verification: [{ argv: ["true"], timeoutMs: 5000 }],
		},
		probe: async () => ({ state: "setup_required" }),
	});
}
