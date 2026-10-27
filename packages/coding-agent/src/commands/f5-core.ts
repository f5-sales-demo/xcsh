import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { writeCliOutput } from "@f5-sales-demo/pi-utils/cli-output";
import { getCapabilities, kindResolver } from "@f5-sales-demo/xcsh-f5-core";

/** Optional editor enrichment handshake. No profile, credentials or model initialization. */
export default class F5CoreCapabilities extends Command {
	static description = "Inspect the versioned F5 core capability contract";
	static args = { operation: Args.string({ required: true, options: ["capabilities", "discover"] }) };
	static flags = { json: Flags.boolean({ description: "Return the machine-readable capability handshake" }) };
	async run(): Promise<void> {
		const { args, flags } = await this.parse(F5CoreCapabilities);
		// Advertise only operations actually exposed by this CLI wire interface.
		const capabilities = { ...getCapabilities(), capabilities: ["discovery"] };
		if (args.operation === "discover") {
			const kinds = kindResolver.getAllKnownKinds();
			writeCliOutput(
				process.stdout,
				`${flags.json ? JSON.stringify({ ...capabilities, kinds }) : kinds.join("\n")}\n`,
			);
			return;
		}
		writeCliOutput(
			process.stdout,
			`${
				flags.json
					? JSON.stringify(capabilities)
					: `${capabilities.protocol} v${capabilities.version}; specification ${capabilities.specificationVersion}\n${capabilities.capabilities.join(", ")}`
			}\n`,
		);
	}
}
