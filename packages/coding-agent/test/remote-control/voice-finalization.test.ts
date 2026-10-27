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

test("closure retains the first confirmed usage when duplicate terminal events arrive", async () => {
	const closure = new VoiceFinalization();
	closure.observe({ type: "session.closed", usage: { seconds: 20 }, reason: "close_requested" });
	closure.observe({ type: "session.closed", usage: { seconds: 99 }, reason: "expired" });
	expect(
		await closure.close(
			() => {},
			() => {},
			5,
		),
	).toEqual({
		confirmed: true,
		seconds: 20,
		reason: "close_requested",
	});
});

test("array envelopes and array usage cannot confirm finalization", async () => {
	for (const value of [Object.assign([], { type: "session.closed" }), { type: "session.closed", usage: [] }]) {
		const closure = new VoiceFinalization();
		expect(closure.observe(value)).toBe(false);
		expect(
			(
				await closure.close(
					() => {},
					() => {},
					5,
				)
			).confirmed,
		).toBe(false);
	}
});
