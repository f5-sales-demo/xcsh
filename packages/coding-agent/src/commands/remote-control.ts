import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runRemoteControl } from "../remote-control/control";
export default class RemoteControl extends Command {
	static description = "Native remote interoperability preview: enable, disable, status, pair";
	static args = { action: Args.string({ required: true, description: "enable | disable | status | pair" }) };
	static flags = { json: Flags.boolean({ description: "Machine-readable status" }) };
	async run(): Promise<void> {
		const { args } = await this.parse(RemoteControl);
		if (!args.action) throw new Error("A remote action is required");
		const result = await runRemoteControl(args.action);
		if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
	}
}
