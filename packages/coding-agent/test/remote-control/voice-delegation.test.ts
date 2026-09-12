import { expect, test } from "bun:test";
import { isVoiceDelegation, pinnedVoiceDelegation, voiceDelegation } from "../../src/remote-control/voice-delegation";
import fixture from "./fixtures/codex-0.153.4-delegation.json";

test.each(fixture.cases.map((value, index) => ({ index, ...value })))(
	"delegation matches the pinned Rust formatter: $index",
	({ input, transcript, tail, expected }) => {
		expect(pinnedVoiceDelegation(input, transcript, tail)).toBe(expected);
	},
);

test("xcsh voice delegation requires shared project-memory lookup for self-awareness", () => {
	const input = "what do you know about me";
	const delegated = voiceDelegation(input, `user: ${input}`);

	expect(delegated).toContain(`<input>${input}</input>`);
	expect(delegated).toContain("MUST first use the read tool on memory://root/memory_summary.md");
	expect(delegated).toContain("MUST include at least one concrete, non-sensitive stored fact");
	expect(delegated).toContain("For unrelated requests, proceed normally.");
	expect(isVoiceDelegation(delegated)).toBe(true);
	expect(isVoiceDelegation(pinnedVoiceDelegation(input))).toBe(true);
});

test("xcsh voice delegation does not embed a separate memory snapshot", () => {
	const delegated = voiceDelegation("remember my role");
	expect(delegated).not.toContain("Persisted xcsh project memory about the user");
});
