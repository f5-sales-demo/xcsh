import { createInterface } from "node:readline/promises";
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { machineProfileService } from "../person-profile/machine-profile";
import { resetProfileTargets } from "../person-profile/private-store";
import { personProfileService } from "../person-profile/service";

type ProfileTarget = "person" | "computer" | "all";

export default class Profile extends Command {
	static description = "Inspect or reset private person and computer profiles";
	static args = {
		action: Args.string({ description: "Profile action", options: ["status", "reset"], required: true }),
		target: Args.string({ description: "Reset target", options: ["person", "computer", "all"] }),
	};
	static flags = {
		json: Flags.boolean({ description: "Output machine-readable status", default: false }),
		yes: Flags.boolean({ description: "Confirm permanent reset", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Profile);
		if (args.action === "status") {
			if (flags.yes) throw new Error("profile status does not accept --yes");
			if (args.target) throw new Error("profile status does not accept a target");
			const result = {
				person: await personProfileService.status(),
				computer: await machineProfileService.status(),
			};
			if (flags.json) {
				process.stdout.write(`${JSON.stringify(result)}\n`);
				return;
			}
			for (const [name, status] of Object.entries(result)) {
				const details = [
					status.schemaVersion === undefined ? undefined : `schema v${status.schemaVersion}`,
					status.permissions?.file ? `file ${status.permissions.file}` : undefined,
					status.permissions?.directory ? `directory ${status.permissions.directory}` : undefined,
					status.reason,
				].filter(Boolean);
				process.stdout.write(`${name}: ${status.status}${details.length ? ` (${details.join(", ")})` : ""}\n`);
				if (status.remedy) process.stdout.write(`  remedy: ${status.remedy}\n`);
			}
			return;
		}

		const target = args.target as ProfileTarget | undefined;
		if (!target) throw new Error("profile reset requires person, computer, or all");
		if (flags.json) throw new Error("profile reset does not accept --json");
		const services =
			target === "all"
				? [personProfileService, machineProfileService]
				: [target === "person" ? personProfileService : machineProfileService];
		process.stdout.write(
			`Profiles selected for permanent reset:\n${services.map(service => `- ${service.path}`).join("\n")}\n`,
		);
		if (!flags.yes) {
			if (!process.stdin.isTTY || !process.stdout.isTTY)
				throw new Error("Non-interactive profile reset requires --yes");
			const prompt = createInterface({ input: process.stdin, output: process.stdout });
			try {
				const answer = await prompt.question('Type "reset" to continue: ');
				if (answer !== "reset") throw new Error("Profile reset cancelled");
			} finally {
				prompt.close();
			}
		}
		const results = await resetProfileTargets(services);
		for (const service of services) {
			process.stdout.write(`${service.path}: ${results.get(service.path) ? "reset" : "already missing"}\n`);
		}
	}
}
