import { expect, test } from "bun:test";
import { VoiceFinalization } from "../../src/remote-control/voice-finalization";

test("closure receiver is installed before close is sent; transport remains alive until final usage", async () => {
	const closure = new VoiceFinalization();
	const order: string[] = [];
	const result = await closure.close(
		() => {
			order.push("sent");
			closure.observe({ type: "session.closed", usage: { seconds: 20 }, reason: "close_requested" });
		},
		() => {
			order.push("cleaned");
		},
		50,
	);
	expect(order).toEqual(["sent", "cleaned"]);
	expect(result).toEqual({ confirmed: true, seconds: 20, reason: "close_requested" });
});

test("malformed final usage, lost transport and timeouts remain unconfirmed", async () => {
	for (const mode of ["malformed", "lost", "timeout"]) {
		const closure = new VoiceFinalization();
		const result = await closure.close(
			() => {
				if (mode === "malformed") closure.observe({ type: "session.closed", usage: { seconds: -1 } });
				if (mode === "lost") closure.lost();
			},
			() => {},
			5,
		);
		expect(result.confirmed).toBe(false);
	}
});

test("subscription closure can be confirmed without a usage field; usage remains unobserved", async () => {
	const closure = new VoiceFinalization();
	const receipt = await closure.close(
		() => {
			closure.observe({ type: "session.closed" });
		},
		() => {},
		5,
	);
	expect(receipt).toEqual({ confirmed: true, usageConfirmed: false });
});
