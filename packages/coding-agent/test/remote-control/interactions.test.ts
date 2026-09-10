import { expect, test } from "bun:test";
import Ajv from "ajv";
import { RemoteInteractions } from "../../src/remote-control/interactions";
import type { Notification } from "../../src/remote-control/session";
import { UserInteractions } from "../../src/session/user-interactions";
import resolvedSchema from "./fixtures/ServerRequestResolvedNotification.json";
import requestSchema from "./fixtures/ToolRequestUserInputParams.json";
import responseSchema from "./fixtures/ToolRequestUserInputResponse.json";

const ajv = new Ajv({ strict: false });
for (const name of ["uint64", "int64"]) ajv.addFormat(name, { type: "number", validate: Number.isSafeInteger });
const validRequest = ajv.compile(requestSchema);
const validResponse = ajv.compile(responseSchema);
const validResolved = ajv.compile(resolvedSchema);

test("tool questions use pinned request fields and settle with one owner", async () => {
	const broker = new UserInteractions();
	const events: Notification[] = [];
	const remote = new RemoteInteractions(
		broker,
		id => (id === "ask-a" ? { threadId: "thread-a", turnId: "turn-a", itemId: "item-a" } : undefined),
		event => events.push(event),
	);
	const result = broker.request(
		{ kind: "select", title: "Choose fixture", options: ["Alpha", "Beta"], toolCallId: "ask-a" },
		() => new Promise(() => {}),
	);
	const id = broker.pending()[0].id;
	expect(events).toEqual([
		{
			id,
			method: "item/tool/requestUserInput",
			params: {
				threadId: "thread-a",
				turnId: "turn-a",
				itemId: "item-a",
				isBlocking: true,
				autoResolutionMs: null,
				questions: [
					{
						id,
						header: "Question",
						question: "Choose fixture",
						isOther: false,
						isSecret: false,
						options: [
							{ label: "Alpha", description: "" },
							{ label: "Beta", description: "" },
						],
					},
				],
			},
		},
	]);
	expect(events).toEqual(remote.pending());
	expect(validRequest(events[0].params), JSON.stringify(validRequest.errors)).toBe(true);
	expect(() => remote.respond(id, { answers: { [id]: { answers: ["invented"] } } })).toThrow("Invalid answer");
	expect(remote.pending()).toHaveLength(1);
	const response = { answers: { [id]: { answers: ["Beta"] } } };
	expect(validResponse(response), JSON.stringify(validResponse.errors)).toBe(true);
	expect(remote.respond(id, response)).toEqual({ accepted: true });
	expect(await result).toBe("Beta");
	expect(remote.pending()).toEqual([]);
	expect(validResolved(events.at(-1)!.params), JSON.stringify(validResolved.errors)).toBe(true);
	expect(events.at(-1)).toEqual({ method: "serverRequest/resolved", params: { threadId: "thread-a", requestId: id } });
	expect(remote.respond(id, { answers: { [id]: { answers: ["Alpha"] } } })).toEqual({ accepted: false });
	remote.close();
});

test("only active tool prompts are published and transport closure leaves terminal input pending", async () => {
	const broker = new UserInteractions();
	const input = broker.request(
		{ kind: "input", title: "Existing question", toolCallId: "live" },
		() => new Promise(() => {}),
	);
	const admin = broker.request({ kind: "input", title: "Administrative input" }, () => new Promise(() => {}));
	const stale = broker.request(
		{ kind: "input", title: "Departed tool", toolCallId: "old" },
		() => new Promise(() => {}),
	);
	const remote = new RemoteInteractions(
		broker,
		id => (id === "live" ? { threadId: "thread-a", turnId: "turn-a", itemId: "item-a" } : undefined),
		() => {},
	);
	expect(remote.pending()).toHaveLength(1);
	expect(validRequest(remote.pending()[0].params), JSON.stringify(validRequest.errors)).toBe(true);
	expect(remote.pending()[0].params.questions).toMatchObject([{ question: "Existing question", options: null }]);
	remote.close();
	expect(broker.pending()).toHaveLength(3);
	broker.cancelAll();
	expect(await Promise.all([input, admin, stale])).toEqual([undefined, undefined, undefined]);
});

test("malformed and mismatched answers cannot resolve input; an empty answer map cancels", async () => {
	const broker = new UserInteractions();
	const remote = new RemoteInteractions(
		broker,
		() => ({ threadId: "thread-a", turnId: "turn-a", itemId: "item-a" }),
		() => {},
	);
	const input = broker.request(
		{ kind: "input", title: "Fixture input", toolCallId: "ask-a" },
		() => new Promise(() => {}),
	);
	const id = broker.pending()[0].id;
	for (const invalid of [
		null,
		[],
		{},
		{ answers: [] },
		{ answers: { wrong: { answers: ["yes"] } } },
		{ answers: { [id]: { answers: ["a", "b"] } } },
		{ answers: { [id]: { answers: [true] } } },
	]) {
		expect(() => remote.respond(id, invalid)).toThrow("Invalid answer");
	}
	expect(broker.pending()).toHaveLength(1);
	expect(remote.respond(id, { answers: {} })).toEqual({ accepted: true });
	expect(await input).toBeUndefined();
	remote.close();
});
