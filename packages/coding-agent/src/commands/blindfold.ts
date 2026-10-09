import { Args, Command } from "@f5-sales-demo/pi-utils/cli";
import { writeCliOutput } from "@f5-sales-demo/pi-utils/cli-output";

import { BlindfoldService } from "../services/blindfold";
import type { ContextService } from "../services/xcsh-context";
import { blindfoldFlags, parseBlindfoldCli } from "./blindfold-args";
export async function runBlindfold(argv: string[], compatibility = false): Promise<void> {
	const args = parseBlindfoldCli(argv, compatibility, Boolean(process.stdin.isTTY));
	let context: ContextService | undefined;
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	try {
		let env: Record<string, string | undefined> = {};
		if (!args.publicKey) {
			const { Settings } = await import("../config/settings");
			const { ContextService } = await import("../services/xcsh-context");
			await Settings.init({ cwd: process.cwd() });
			context = await ContextService.getOrInit(undefined, process.cwd());
			env = { ...(Settings.instance.get("bash.environment") as Record<string, string> | undefined), ...process.env };
		}
		const service = new BlindfoldService({
			env,
			emit: content => {
				if (!args.json && !args.outputFile) writeCliOutput(process.stdout, content);
			},
		});
		const report = await service.run(args, { signal: controller.signal });
		if (args.json || args.outputFile || ["create", "replace", "ensure"].includes(report.operation))
			writeCliOutput(process.stdout, `${JSON.stringify(report, null, 2)}\n`);
	} catch (error) {
		writeCliOutput(
			process.stderr,
			`Blindfold: ${controller.signal.aborted ? "operation cancelled" : error instanceof Error ? error.message : "operation failed"}\n`,
		);
		process.exitCode = controller.signal.aborted ? 130 : 1;
	} finally {
		context?.stopRevalidation();
		process.removeListener("SIGINT", cancel);
	}
}
export default class Blindfold extends Command {
	static description = "Encrypt secrets natively and create or rotate tenant TLS certificates";
	static args = {
		operation: Args.string({
			required: true,
			description: "public-key, policy, encrypt, certificate, create, replace, ensure",
		}),
		file: Args.string({ description: "Encryption input file or - for redirected stdin" }),
	};
	static flags = blindfoldFlags;
	async run(): Promise<void> {
		await runBlindfold(this.argv);
	}
}
