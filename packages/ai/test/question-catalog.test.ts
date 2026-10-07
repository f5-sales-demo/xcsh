import { expect, test } from "bun:test";
import { fetchCodexModels } from "../src/utils/discovery/codex";

test.each([undefined, null, "", "Use catalog guidance"])(
	"catalog question descriptions preserve %j",
	async description => {
		const fetchFn = (async () =>
			Response.json({
				models: [
					{
						slug: "gpt-6.1-sol",
						experimental_supported_tools: ["send_user_message_async"],
						model_messages: {
							tools: {
								send_user_message_async: { description, parameters: '{"type":"object","properties":{}}' },
							},
						},
					},
				],
			})) as unknown as typeof fetch;
		const model = (await fetchCodexModels({ accessToken: "synthetic", clientVersion: "0.159.0", fetchFn }))!
			.models[0];
		expect(model.experimentalSupportedTools).toEqual(["send_user_message_async"]);
		expect(model.modelMessages?.requestUserInputAsyncDescription).toBe(
			typeof description === "string" ? description : undefined,
		);
		expect(model.modelMessages?.requestUserInputAsyncParameters).toBe('{"type":"object","properties":{}}');
	},
);
