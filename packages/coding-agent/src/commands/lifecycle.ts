import * as path from "node:path";
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runHerdrAcceptanceAction } from "../lifecycle/herdr-acceptance-control";
import { nativeLifecycleContract } from "../lifecycle/native-acceptance";
import {
	NATIVE_LIFECYCLE_SCENARIOS,
	type NativeLifecycleScenario,
	runNativeLifecycleAcceptance,
} from "../lifecycle/native-acceptance-driver";

/** Print the versioned producer contract consumed by native lifecycle drivers. */
export default class Lifecycle extends Command {
	static description = "Describe or execute the producer-native lifecycle acceptance driver";
	static args = { action: Args.string({ description: "Owner-private acceptance-action" }) };

	static flags = {
		request: Flags.string({ description: "Owner-private acceptance action request file" }),
		json: Flags.boolean({ description: "Print the machine-readable contract", default: false }),
		scenario: Flags.string({
			description: `Execute one native scenario (${NATIVE_LIFECYCLE_SCENARIOS.join(", ")})`,
		}),
		model: Flags.string({ description: "Normally configured model used by the native child" }),
		"session-dir": Flags.string({ description: "Fresh absolute directory for child sessions and fixtures" }),
		continuation: Flags.string({ description: "PTY continuation label for await-continue" }),
		timeout: Flags.integer({ description: "Scenario timeout in milliseconds", default: 90_000 }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Lifecycle);
		if (!flags.json) throw new Error("xcsh lifecycle requires --json");
		if (args.action) {
			if (args.action !== "acceptance-action" || !flags.request || flags.scenario)
				throw new Error("Use xcsh lifecycle acceptance-action --request <file> --json");
			process.stdout.write(`${JSON.stringify(await runHerdrAcceptanceAction(flags.request))}\n`);
			return;
		}
		if (flags.request) throw new Error("--request requires acceptance-action");
		if (!flags.scenario) {
			process.stdout.write(`${JSON.stringify(nativeLifecycleContract())}\n`);
			return;
		}
		if (!NATIVE_LIFECYCLE_SCENARIOS.includes(flags.scenario as NativeLifecycleScenario)) {
			throw new Error(`Unsupported native lifecycle scenario: ${flags.scenario}`);
		}
		if (!flags.model) throw new Error("--model is required when --scenario is used");
		if (!flags["session-dir"] || !path.isAbsolute(flags["session-dir"])) {
			throw new Error("--session-dir must be an absolute path when --scenario is used");
		}
		const receipt = await runNativeLifecycleAcceptance({
			scenario: flags.scenario as NativeLifecycleScenario,
			model: flags.model,
			sessionDir: flags["session-dir"],
			timeoutMs: flags.timeout,
			continuation: flags.continuation,
		});
		process.stdout.write(`${JSON.stringify(receipt)}\n`);
	}
}
