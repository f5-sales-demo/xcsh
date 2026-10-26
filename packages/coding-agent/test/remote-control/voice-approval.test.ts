import { expect, test } from "bun:test";
import { type VoiceApproval, VoiceApprovalGate } from "../../src/remote-control/voice-approval";

const request: VoiceApproval = {
	chatId: "chat",
	workspace: "/fixture/workspace",
	requestId: "approval",
	revision: 1,
	title: "Run the fixture command",
	secret: false,
	eligible: true,
	identity: "owner-generation-1",
};
function fixture() {
	let pending = [{ ...request }];
	const decisions: string[] = [];
	const gate = new VoiceApprovalGate(
		() => pending,
		(_id, decision) => {
			if (!pending.length) return false;
			decisions.push(decision);
			pending = [];
			return true;
		},
	);
	gate.assistantCompleted("Run the fixture command?");
	return {
		gate,
		decisions,
		set: (requests: VoiceApproval[]) => {
			pending = requests;
		},
	};
}
test("completed caller approval requires current announced action and actual playback, then resolves once", () => {
	const f = fixture();
	expect(f.gate.callerCompleted("yes", "user", true)).toBe(false);
	expect(f.gate.playbackCompleted("approval", 1)).toBe(true);
	expect(f.gate.callerCompleted("yes", "user", true)).toBe(true);
	expect(f.gate.callerCompleted("yes", "user", true)).toBe(false);
	expect(f.decisions).toEqual(["accept"]);
});
test.each(["workspace", "requestId", "identity", "chatId", "title"] as const)(
	"changed %s invalidates speech approval",
	field => {
		const f = fixture();
		f.gate.playbackCompleted("approval", 1);
		f.set([{ ...request, [field]: "changed" }]);
		expect(f.gate.callerCompleted("yes", "user", true)).toBe(false);
	},
);
test("partial, assistant, echoed, ambiguous, stale, concurrent and secret speech cannot authorize", () => {
	for (const [text, role, complete, echoed] of [
		["yes", "user", false, false],
		["yes", "assistant", true, false],
		["yes", "user", true, true],
		["yes or no", "user", true, false],
	] as const) {
		const f = fixture();
		f.gate.playbackCompleted("approval", 1);
		expect(f.gate.callerCompleted(text, role, complete, echoed)).toBe(false);
	}
	for (const pending of [
		[{ ...request, revision: 2 }],
		[{ ...request, secret: true }],
		[{ ...request }, { ...request, requestId: "second" }],
		[],
	]) {
		const f = fixture();
		f.gate.playbackCompleted("approval", 1);
		f.set(pending);
		expect(f.gate.callerCompleted("yes", "user", true)).toBe(false);
	}
});
test("assistant suggestions containing an approval word cannot be accepted from microphone echoes", () => {
	const f = fixture();
	f.gate.assistantCompleted("Run the fixture command. Say yes.");
	f.gate.playbackCompleted("approval", 1);
	expect(f.gate.callerCompleted("yes", "user", true)).toBe(false);
});

test("a completed selection uses exactly a current announced option and resolves once", () => {
	let pending = [{ ...request, kind: "select" as const, options: ["First", "Second"] }];
	const received: string[] = [];
	const gate = new VoiceApprovalGate(
		() => pending,
		(_id, value) => {
			received.push(value);
			pending = [];
			return true;
		},
	);
	gate.assistantCompleted("Run the fixture command?");
	gate.playbackCompleted("approval", 1);
	expect(gate.callerCompleted("third", "user", true)).toBe(false);
	expect(gate.callerCompleted("second", "user", true)).toBe(true);
	expect(received).toEqual(["Second"]);
});
