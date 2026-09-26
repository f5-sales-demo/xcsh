import { describe, expect, it } from "bun:test";
import { renderCommandHelp } from "@f5-sales-demo/pi-utils/cli";
import { runOpenAIDeviceAuthLogin } from "../src/cli/openai-device-auth";
import Login from "../src/commands/login";

describe("OpenAI device-auth CLI", () => {
	it("documents the Codex-compatible command spelling", () => {
		const write = process.stdout.write;
		let output = "";
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			renderCommandHelp("xcsh", "login", Login);
		} finally {
			process.stdout.write = write;
		}
		expect(output).toContain("--device-auth");
		expect(output).toContain("openai");
	});

	it("requires an explicit OpenAI provider context", () => {
		expect(Login.args).toHaveProperty("provider");
		expect(Login.args.provider.required).toBe(true);
		expect(Login.args.provider.options).toEqual(["openai"]);
	});

	it("forces the ChatGPT OAuth helper into device mode and stores its result", async () => {
		const saved: Array<{ provider: string; credentials: unknown }> = [];
		let closed = false;
		let reported = "";

		await runOpenAIDeviceAuthLogin({
			openStore: async () => ({
				saveOAuth(provider: string, credentials: unknown) {
					saved.push({ provider, credentials });
				},
				close() {
					closed = true;
				},
			}),
			login: async options => {
				expect(options.method).toBe("device");
				options.onProgress?.("Waiting for approval in your browser…");
				return { access: "test-access", refresh: "test-refresh", expires: 1 };
			},
			onProgress(message) {
				reported = message;
			},
			onAuth() {},
			onPrompt: async () => "",
		});

		expect(saved).toEqual([
			{ provider: "openai-codex", credentials: { access: "test-access", refresh: "test-refresh", expires: 1 } },
		]);
		expect(closed).toBe(true);
		expect(reported).toContain("Waiting for approval");
	});
});
