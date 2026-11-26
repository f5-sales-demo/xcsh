import { createInterface } from "node:readline/promises";
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import {
	inspectProfileLockRecovery,
	readProfileLockRecoveryReview,
	recoverProfileLock,
	reviewProfileLockRecovery,
} from "../person-profile/lock-recovery";
import { machineProfileService } from "../person-profile/machine-profile";
import { resetProfileTargets } from "../person-profile/private-store";
import { personProfileService } from "../person-profile/service";

type ProfileTarget = "person" | "computer" | "all";

export default class Profile extends Command {
	static description = "Inspect, reset or review recovery of private person and computer profiles";
	static args = {
		action: Args.string({
			description: "Profile action",
			options: ["status", "reset", "lock-review", "lock-recover", "lock-status"],
			required: true,
		}),
		target: Args.string({ description: "Profile target", options: ["person", "computer", "all"] }),
	};
	static flags = {
		json: Flags.boolean({ description: "Output machine-readable status", default: false }),
		yes: Flags.boolean({ description: "Confirm permanent reset", default: false }),
		"review-file": Flags.string({ description: "Private JSON review file for lock recovery" }),
		"approve-sha256": Flags.string({ description: "Approve the exact reviewed lock digest" }),
		"review-sha256": Flags.string({ description: "Inspect evidence for one consumed review digest" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Profile);
		const action = args.action;
		if (!action) throw new Error("profile requires an action");

		if (action.startsWith("lock-")) {
			if (args.target !== "person" && args.target !== "computer")
				throw new Error(`${action} requires a single person or computer target`);
			if (flags.yes) throw new Error(`${action} does not accept --yes`);
			const domain = args.target;
			const path = (domain === "person" ? personProfileService : machineProfileService).path;
			if (action === "lock-review") {
				if (!flags.json)
					throw new Error("profile lock-review requires --json to retain the complete private review");
				if (flags["review-file"] || flags["approve-sha256"] || flags["review-sha256"])
					throw new Error("profile lock-review does not accept recovery or inspection flags");
				const review = await reviewProfileLockRecovery(path, domain);
				process.stdout.write(`${JSON.stringify(review)}\n`);
				return;
			}
			if (action === "lock-status") {
				if (!flags["review-sha256"] || flags["review-file"] || flags["approve-sha256"])
					throw new Error("profile lock-status requires only --review-sha256");
				const result = await inspectProfileLockRecovery(path, domain, flags["review-sha256"]);
				process.stdout.write(
					flags.json
						? `${JSON.stringify(result)}\n`
						: `${domain}: ${result.status}; prior completion unconfirmed; active lock ${result.activeLock}\n`,
				);
				return;
			}
			if (!flags["review-file"] || !flags["approve-sha256"] || flags["review-sha256"])
				throw new Error("profile lock-recover requires --review-file and --approve-sha256");
			const review = await readProfileLockRecoveryReview(flags["review-file"], domain);
			const result = await recoverProfileLock(path, domain, review, flags["approve-sha256"]);
			process.stdout.write(
				flags.json
					? `${JSON.stringify(result)}\n`
					: `${domain}: original lock retained at ${result.retainedDirectoryPath}\n`,
			);
			return;
		}
		if (flags["review-file"] || flags["approve-sha256"] || flags["review-sha256"])
			throw new Error(`profile ${action} does not accept lock recovery flags`);
		if (action === "status") {
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
