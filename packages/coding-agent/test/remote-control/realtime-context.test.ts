import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { convertToLlm } from "../../src/session/messages";
import { RealtimeContext } from "../../src/session/realtime-context";

const id = "fixture-session";
function text(messages: AgentMessage[]) {
	return convertToLlm(messages)
		.flatMap(message =>
			typeof message.content === "string"
				? [message.content]
				: message.content.filter(part => part.type === "text").map(part => part.text),
		)
		.join("");
}
test("voice never observed by a turn adds no start/end messages", () => {
	const context = new RealtimeContext();
	context.update(id, true, { start: "start", end: "end" });
	context.update(id, false, { start: "start", end: "end" });
	context.beginTurn(id);
	expect(context.messages(id, [])).toEqual([]);
});
test("an active turn receives the pinned default developer instructions", () => {
	const context = new RealtimeContext();
	context.update(id, true, {});
	context.beginTurn(id);
	const messages = context.messages(id, []);
	expect(messages).toHaveLength(1);
	expect(convertToLlm(messages)[0]?.role).toBe("developer");
	expect(text(messages)).toContain("<realtime_conversation>\nRealtime conversation started.");
	expect(text(messages)).toContain("The user does not talk to you directly.");
	expect(text(messages)).toEndWith("\n</realtime_conversation>");
	expect(context.messages(id, messages)).toEqual([]);
});
test("ending voice retains the current turn's active state until a new turn", () => {
	const context = new RealtimeContext();
	context.update(id, true, { start: "start", end: "end" });
	context.beginTurn(id);
	const start = context.messages(id, []);
	context.update(id, false, { start: "start", end: "end" });
	expect(context.messages(id, start)).toEqual([]);
	context.beginTurn(id);
	const end = context.messages(id, start);
	expect(text(end)).toBe("<realtime_conversation>\nend\n</realtime_conversation>");
	expect(context.messages(id, [...start, ...end])).toEqual([]);
});
test("starting voice during a typed turn affects only the following turn", () => {
	const context = new RealtimeContext();
	context.beginTurn(id);
	context.update(id, true, { start: "start" });
	expect(context.messages(id, [])).toEqual([]);
	context.beginTurn(id);
	expect(text(context.messages(id, []))).toContain("\nstart\n");
});
test("changing instructions while active does not repeat a retained transition", () => {
	const context = new RealtimeContext();
	context.update(id, true, { start: "first" });
	context.beginTurn(id);
	const start = context.messages(id, []);
	context.update(id, true, { start: "second" });
	context.beginTurn(id);
	expect(context.messages(id, start)).toEqual([]);
	// Pruning the retained fragment requires a full reinjection with current instructions.
	expect(text(context.messages(id, []))).toContain("\nsecond\n");
});
test("an inactive turn does not restore an instruction that compaction removed", () => {
	const context = new RealtimeContext();
	context.beginTurn(id);
	expect(context.messages(id, [])).toEqual([]);
});
test("cold resume closes retained voice context with the pinned default", () => {
	const original = new RealtimeContext();
	original.update(id, true, { start: "fixture", end: "custom end" });
	original.beginTurn(id);
	const retained = original.messages(id, []);
	const resumed = new RealtimeContext();
	resumed.beginTurn(id);
	expect(text(resumed.messages(id, retained))).toContain("Realtime conversation ended.");
	expect(text(resumed.messages(id, retained))).not.toContain("custom end");
});
test("explicit empty start/end instructions preserve markers", () => {
	const context = new RealtimeContext();
	context.update(id, true, { start: "", end: "" });
	context.beginTurn(id);
	const start = context.messages(id, []);
	expect(text(start)).toBe("<realtime_conversation>\n\n</realtime_conversation>");
	context.update(id, false, { start: "", end: "" });
	context.beginTurn(id);
	expect(text(context.messages(id, start))).toBe(text(start));
});
test("new session identities cannot inherit the old active call", () => {
	const context = new RealtimeContext();
	context.update(id, true, { start: "old" });
	context.beginTurn(id);
	context.beginTurn("new-session");
	expect(context.messages("new-session", [])).toEqual([]);
	expect(context.messages(id, [])).toEqual([]);
});

test("all pinned realtime section cases match the unchanged Rust snapshot", () => {
	const snapshot = readFileSync(new URL("./fixtures/codex-0.153.4-realtime-context.snap", import.meta.url), "utf8");
	expect(createHash("sha256").update(snapshot).digest("hex")).toBe(
		"ee2065fecd5379cfe6585afdb68364adf0afc337e8d9552330fdc6384bf8a086",
	);
	type State = boolean | "unknown" | undefined;
	const cases: [State, boolean | undefined, string?][] = [
		[undefined, undefined],
		[undefined, false],
		[undefined, true],
		[false, true],
		[false, true, "custom realtime instructions"],
		[true, true],
		[true, true, "changed custom realtime instructions"],
		[true, false],
		["unknown", true],
		["unknown", false],
	];
	const label = (state: State) =>
		state === undefined ? "Absent" : state === "unknown" ? "Unknown" : JSON.stringify({ active: state });
	const rendered = cases
		.map(([previous, current, start]) => {
			const context = new RealtimeContext();
			const retained: AgentMessage[] =
				previous === undefined
					? []
					: previous === "unknown"
						? [
								{
									role: "developer",
									content: [
										{ type: "text", text: "<realtime_conversation>\nlegacy\n</realtime_conversation>" },
									],
									timestamp: 1,
								},
							]
						: [
								{
									role: "custom",
									customType: previous ? "remote-voice-start" : "remote-voice-end",
									content: "retained fixture",
									display: false,
									timestamp: 1,
								},
							];
			if (current !== undefined) {
				context.update(id, current, { start });
				context.beginTurn(id);
			}
			const messages = context.messages(id, retained);
			return `${label(previous)} -> ${label(current)}${messages.length ? " (role - developer)" : ""}\n${messages.length ? text(messages) : "None"}`;
		})
		.join("\n\n");
	expect(rendered).toBe(snapshot.slice(snapshot.indexOf("\n---\n") + 5).trimEnd());
});
