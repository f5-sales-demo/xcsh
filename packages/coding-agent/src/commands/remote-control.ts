import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runRemoteControl } from "../remote-control/control";
export default class RemoteControl extends Command {
	static description = "Native remote interoperability preview: enable, disable, status, pair, clients, revoke";
	static args = {
		action: Args.string({ required: true, description: "enable | disable | status | pair | clients | revoke" }),
		clientId: Args.string({ description: "Client identity to revoke (from clients output)" }),
	};
	static flags = {
		json: Flags.boolean({ description: "Machine-readable status" }),
		cursor: Flags.string({ description: "Client-list pagination cursor" }),
		limit: Flags.integer({ description: "Client-list page size (1–100)" }),
		order: Flags.string({ description: "Client-list order", options: ["asc", "desc"] }),
	};
	async run(): Promise<void> {
		const { args, flags } = await this.parse(RemoteControl);
		if (!args.action) throw new Error("A remote action is required");
		if (args.clientId && args.action !== "revoke") throw new Error("A client identity applies only to revoke");
		if (args.action !== "clients" && (flags.cursor != null || flags.limit != null || flags.order != null))
			throw new Error("Pagination flags apply only to clients");
		const result = await runRemoteControl(args.action, {
			clientId: args.clientId,
			cursor: flags.cursor,
			limit: flags.limit,
			order: flags.order as "asc" | "desc" | undefined,
		});
		if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
	}
}
