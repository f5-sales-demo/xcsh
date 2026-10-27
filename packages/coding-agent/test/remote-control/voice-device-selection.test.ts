import { expect, test } from "bun:test";
import { validateAudioPreferences } from "../../src/remote-control/voice-device-selection";

const input = { name: "Fixture microphone", channels: 2, isDefault: true };
const output = { name: "Fixture speaker", channels: 2, isDefault: true };
const catalog = { inputs: [input], outputs: [output] };
test("explicit system defaults do not silently select another named device", () => {
	expect(validateAudioPreferences(catalog, {})).toEqual({});
	expect(() => validateAudioPreferences(catalog, { microphone: "Removed microphone" })).toThrow("missing");
});
test("selection rejects duplicate names and out-of-range microphone channels", () => {
	expect(() => validateAudioPreferences({ ...catalog, inputs: [input, input] }, { microphone: input.name })).toThrow(
		"ambiguous",
	);
	for (const channel of [0, 3, 1.5])
		expect(() => validateAudioPreferences(catalog, { microphone: input.name, channel: [channel] })).toThrow(
			"valid microphone",
		);
	expect(() => validateAudioPreferences(catalog, { channel: [1] })).toThrow("selected device");
});
test("device preferences copy channel selection without retaining mutable caller arrays", () => {
	const channel = [2, 2];
	const choice = validateAudioPreferences(catalog, { microphone: input.name, speaker: output.name, channel });
	channel[0] = 1;
	expect(choice.channel).toEqual([2]);
});
