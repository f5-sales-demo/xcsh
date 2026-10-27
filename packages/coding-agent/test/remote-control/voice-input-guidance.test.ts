import { expect, test } from "bun:test";
import { voiceInputText } from "../../src/remote-control/voice-input";

test("pending app review does not request another spoken confirmation", () => {
	const text = voiceInputText(
		{
			method: "item/tool/requestUserInput",
			params: {
				turnId: "turn",
				questions: [
					{
						id: "install",
						header: "Approval",
						question: "Install example plugin?",
						options: [{ label: "Allow once" }, { label: "Decline" }],
					},
				],
				isBlocking: true,
			},
		} as any,
		"call",
	);
	expect(text).toContain("Do not ask a second spoken confirmation");
	expect(text).toContain("never treat spoken yes or no as approval");
	const request = JSON.parse(text.split("\n\n")[1]);
	expect(request.questions[0].options).toEqual([{ label: "Allow once" }, { label: "Decline" }]);
	expect(request.call_id).toBe("call");
});
