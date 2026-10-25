import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runRemoteControl } from "../remote-control/control";
import { presentRemoteResult } from "../remote-control/pairing-presentation";
export default class RemoteControl extends Command {
	static description =
		"Native remote interoperability preview: enable, restart, disable, status, pair, clients, revoke";
	static args = {
		action: Args.string({
			required: true,
			description: "enable | restart | disable | status | pair | clients | revoke",
		}),
		clientId: Args.string({ description: "Client identity to revoke (from clients output)" }),
	};
	static flags = {
		json: Flags.boolean({ description: "Machine-readable output (pairing challenges are sensitive)" }),
		cursor: Flags.string({ description: "Client-list pagination cursor" }),
		limit: Flags.integer({ description: "Client-list page size (1–100)" }),
		order: Flags.string({ description: "Client-list order", options: ["asc", "desc"] }),
	};
	async run(): Promise<void> {
		const { args, flags } = await this.parse(RemoteControl);
		if (!args.action) throw new Error("A remote action is required");
		if (
			args.action === "pair" &&
			!flags.json &&
			(!process.stdout.isTTY || !process.stdin.isTTY || process.env.TERM === "dumb")
		)
			throw new Error("QR pairing requires an interactive terminal; use --json for machine-readable challenges.");
		if (args.clientId && args.action !== "revoke" && args.action !== "worker")
			throw new Error("A client identity applies only to revoke");
		if (args.action !== "clients" && (flags.cursor != null || flags.limit != null || flags.order != null))
			throw new Error("Pagination flags apply only to clients");
		const result = await runRemoteControl(args.action, {
			clientId: args.action === "revoke" ? args.clientId : undefined,
			workerSocket: args.action === "worker" ? args.clientId : undefined,
			cwd: args.action === "enable" ? process.cwd() : undefined,
			cursor: flags.cursor,
			limit: flags.limit,
			order: flags.order as "asc" | "desc" | undefined,
		});
		await presentRemoteResult(args.action, result, Boolean(flags.json));
	}
}
