import { expect, test } from "bun:test";
import { messageHistoryItems, projectHistory } from "../../src/remote-control/history";
import { SessionManager } from "../../src/session/session-manager";

const text = "PLAN-MODE-OK\n\n<proposed_plan>\n1. Read the file.\n2. Check line endings.\n</proposed_plan>";
const assistant = (value: string) =>
	({
		role: "assistant",
		content: [{ type: "text", text: value }],
		timestamp: 2,
		stopReason: "stop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	}) as any;

test("plan-mode text projects a native plan item without changing canonical message", () => {
	const message = assistant(text);
	expect(
		messageHistoryItems("answer", message, null, {
			cwd: "/tmp",
			commandCallIds: [],
			collaborationMode: "plan",
		} as any),
	).toMatchObject([
		{ type: "agentMessage", id: "answer:0", text: "PLAN-MODE-OK\n\n" },
		{ type: "plan", id: "answer:0:plan:0", text: "1. Read the file.\n2. Check line endings." },
	]);
	expect(message.content[0].text).toBe(text);
});

test("durable mode boundaries fence plan projection across cold replay", () => {
	const manager = SessionManager.inMemory("/tmp/plan-history");
	manager.appendModeChange("plan");
	manager.appendMessage({ role: "user", content: "plan", timestamp: 1 } as any);
	manager.appendMessage(assistant(text));
	manager.appendModeChange("none");
	manager.appendMessage({ role: "user", content: "literal", timestamp: 3 } as any);
	manager.appendMessage(assistant(text));
	const history = projectHistory("thread", manager.getBranch());
	expect(history[0].items.filter(i => i.type === "plan")).toHaveLength(1);
	expect(history[1].items.filter(i => i.type === "plan")).toHaveLength(0);
	expect(history[1].items.at(-1)?.text).toBe(text);
});

test("default mode and fenced or incomplete plan examples stay literal", () => {
	for (const value of [
		"```xml\n" + text + "\n```",
		"<proposed_plan>\nunfinished",
		"<proposed_plan>\n</proposed_plan>",
	]) {
		expect(
			messageHistoryItems("answer", assistant(value), null, {
				cwd: "/tmp",
				commandCallIds: [],
				collaborationMode: "plan",
			} as any),
		).toMatchObject([{ type: "agentMessage", text: value }]);
	}
	expect(messageHistoryItems("answer", assistant(text))).toMatchObject([{ type: "agentMessage", text }]);
});
