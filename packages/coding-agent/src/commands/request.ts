import { Args, Command } from "@f5-sales-demo/pi-utils/cli";
import { runBlindfold } from "./blindfold";
export default class Request extends Command {
	static description = "Native compatibility for request secrets get-public-key, get-policy-document, encrypt";
	static args = {
		secrets: Args.string({ required: true, options: ["secrets"] }),
		operation: Args.string({ required: true, options: ["get-public-key", "get-policy-document", "encrypt"] }),
	};
	async run(): Promise<void> {
		await runBlindfold(this.argv, true);
	}
}
