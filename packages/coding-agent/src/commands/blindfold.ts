import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { Settings } from "../config/settings";
import { BLINDFOLD_OPERATIONS, type BlindfoldOperation, BlindfoldService } from "../services/blindfold";
import { ContextService } from "../services/xcsh-context";

export default class Blindfold extends Command {
	static description = "Encrypt secrets natively and create or rotate tenant TLS certificates";
	static args = {
		operation: Args.string({
			required: true,
			options: [...BLINDFOLD_OPERATIONS],
			description: "public-key, policy, encrypt, certificate, create, or replace",
		}),
	};
	static flags = {
		input: Flags.string({ description: "Secret file to encrypt" }),
		cert: Flags.string({ description: "PEM certificate chain" }),
		key: Flags.string({ description: "PEM private key" }),
		bundle: Flags.string({ description: "PKCS#12 .p12/.pfx bundle" }),
		name: Flags.string({ description: "Certificate resource name" }),
		namespace: Flags.string({ char: "n", description: "Certificate namespace; defaults to XCSH_NAMESPACE" }),
		policy: Flags.string({ description: "Secret policy namespace/name", default: "shared/ves-io-allow-volterra" }),
		"passphrase-env": Flags.string({
			description: "Name of an environment variable containing the input passphrase",
		}),
		"context-name": Flags.string({ description: "Expected active context; fail if different" }),
		"output-file": Flags.string({ description: "Create a new encrypted artifact or public material file (0600)" }),
		"result-file": Flags.string({ description: "Create a new JSON report (0600)" }),
		"dry-run": Flags.string({ description: "Validate without tenant writes", options: ["client"] }),
		json: Flags.boolean({ description: "Print the public JSON report" }),
	};
	async run(): Promise<void> {
		const { args, flags } = await this.parse(Blindfold);
		let context: ContextService | undefined;
		const controller = new AbortController();
		const cancel = () => controller.abort();
		process.once("SIGINT", cancel);
		try {
			await Settings.init({ cwd: process.cwd() });
			context = await ContextService.getOrInit(undefined, process.cwd());
			const env = {
				...(Settings.instance.get("bash.environment") as Record<string, string> | undefined),
				...process.env,
			};
			const service = new BlindfoldService({
				env,
				emit: content => {
					if (!flags.json && !flags["output-file"]) process.stdout.write(content);
				},
			});
			const report = await service.run(
				{
					operation: args.operation as BlindfoldOperation,
					input: flags.input,
					cert: flags.cert,
					key: flags.key,
					bundle: flags.bundle,
					name: flags.name,
					namespace: flags.namespace,
					policy: flags.policy,
					passphraseEnv: flags["passphrase-env"],
					contextName: flags["context-name"],
					outputFile: flags["output-file"],
					resultFile: flags["result-file"],
					dryRun: flags["dry-run"] as "client" | undefined,
				},
				{ signal: controller.signal },
			);
			if (flags.json || flags["output-file"] || ["create", "replace"].includes(report.operation))
				process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
			context.stopRevalidation();
		} catch (error) {
			process.stderr.write(`Blindfold: ${error instanceof Error ? error.message : "operation failed"}\n`);
			process.exitCode = 1;
		} finally {
			context?.stopRevalidation();
			process.removeListener("SIGINT", cancel);
		}
	}
}
