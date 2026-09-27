import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { runOpenAIDeviceAuthLogin } from "../cli/openai-device-auth";

/** Authenticate ChatGPT through a device-code flow suitable for SSH and headless terminals. */
export default class Login extends Command {
	static description = "Authenticate ChatGPT using a device code";
	static args = {
		provider: Args.string({
			description: "Provider to authenticate (openai)",
			required: true,
			options: ["openai"],
		}),
	};
	static flags = {
		"device-auth": Flags.boolean({ description: "Use ChatGPT device-code authentication", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Login);
		if (args.provider !== "openai") {
			throw new Error("Device-code authentication is available only for the openai provider.");
		}
		if (!flags["device-auth"]) {
			throw new Error("Use xcsh login openai --device-auth to authenticate ChatGPT with a device code.");
		}
		await runOpenAIDeviceAuthLogin();
	}
}
