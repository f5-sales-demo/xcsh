import { expect, test } from "bun:test";
import { voiceDelegation } from "../../src/remote-control/voice-delegation";
import fixture from "./fixtures/codex-0.153.4-delegation.json";

test.each(fixture.cases.map((value, index) => ({ index, ...value })))(
	"delegation matches the pinned Rust formatter: $index",
	({ input, transcript, tail, expected }) => {
		expect(voiceDelegation(input, transcript, tail)).toBe(expected);
	},
);
