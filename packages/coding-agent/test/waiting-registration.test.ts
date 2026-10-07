import { expect, test } from "bun:test";
import { RemoteInteractions } from "../src/remote-control/interactions";
import { UserInteractions } from "../src/session/user-interactions";

test("waiting question opened before its tool item publishes once registration catches up", async () => {
	const broker = new UserInteractions();
	let ready = false;
	const events: any[] = [];
	const remote = new RemoteInteractions(
		broker,
		() => (ready ? { threadId: "thread", turnId: "turn", itemId: "tool" } : undefined),
		event => events.push(event),
	);
	const response = broker.requestInput({
		title: "Format",
		toolCallId: "call",
		isBlocking: false,
		inputQuestions: [
			{ id: "format", header: "Format", question: "Format?", options: [{ label: "Compact", description: "Brief" }] },
		],
	});
	expect(remote.pending()).toEqual([]);
	ready = true;
	remote.refreshPending();
	remote.refreshPending();
	expect(remote.pending()).toHaveLength(1);
	expect(events).toHaveLength(1);
	expect(remote.pending()[0].params.isBlocking).toBe(false);
	expect(remote.respond(remote.pending()[0].id, { answers: {} })).toEqual({ accepted: true });
	expect(await response).toEqual({ answers: {} });
	expect(events.map(event => event.method)).toEqual(["item/tool/requestUserInput", "serverRequest/resolved"]);
	remote.close();
	broker.close();
});
