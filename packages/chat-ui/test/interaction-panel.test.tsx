import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InteractionPanel, type InteractionTransport } from "../src/interactions/InteractionPanel";
import type { InteractionCommand } from "../src/interactions/transport";
function harness() {
 const sent: InteractionCommand[] = [];
 let receive = (_message: unknown) => {};
 const transport: InteractionTransport = { send: message => { sent.push(message); }, onMessage: callback => { receive = callback; return () => {}; } };
 const identity = { sessionId: "s", threadId: "t", turnId: "u", itemId: "i", generation: 1 };
 const request = { id: "r", identity, kind: "request_user_input", title: "Scope", inputQuestions: [{ id: "scope", header: "Scope", question: "Which scope?", options: [{ label: "Small (Recommended)", description: "Less work" }, { label: "Large", description: "More work" }], isOther: true }] };
 return { transport, sent, request, receive: (message: unknown) => act(() => receive(message)) };
}
test("replayed snapshots retain notes and highlighting never sends an answer", async () => {
 const h = harness();
 render(<InteractionPanel transport={h.transport} />);
 h.receive({ type: "interaction_snapshot", sessionId: "s", revision: 1, pending: [h.request] });
 expect(h.sent).toEqual([{ type: "interaction_snapshot" }]);
 fireEvent.change(screen.getByRole("textbox"), { target: { value: "雪\nKeep small" } });
 h.receive({ type: "interaction_snapshot", sessionId: "s", revision: 1, pending: [structuredClone(h.request)] });
 expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("雪\nKeep small");
 expect(h.sent).toHaveLength(1);
 fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
 const command = h.sent.at(-1)!;
 expect(command).toMatchObject({ type: "interaction_respond", requestId: "r", identity: h.request.identity, value: { answers: { scope: { answers: ["Small (Recommended)", "user_note: 雪\nKeep small"] } } } });
 await act(async () => {
  if (command.type === "interaction_respond") h.receive({ type: "interaction_receipt", responseId: command.responseId, accepted: true });
 });
 h.receive({ type: "interaction_event", revision: 2, event: { type: "resolved", interaction: h.request, reason: "answered" } });
 expect(screen.queryByText("Which scope?")).toBeNull();
 h.receive({ type: "interaction_snapshot", sessionId: "s", revision: 1, pending: [h.request] });
 expect(screen.queryByText("Which scope?")).toBeNull();
});
test("transport changes clear previous conversation questions before reconnect", () => {
 const a = harness(), b = harness();
 const view = render(<InteractionPanel transport={a.transport} />);
 a.receive({ type: "interaction_snapshot", sessionId: "s", revision: 1, pending: [a.request] });
 expect(screen.getByText("Which scope?")).toBeDefined();
 view.rerender(<InteractionPanel transport={b.transport} />);
	expect(screen.queryByText("Which scope?")).toBeNull();
});

test("a new session accepts its lower revision snapshot on the same transport", () => {
	const h = harness();
	render(<InteractionPanel transport={h.transport} />);
	h.receive({ type: "interaction_snapshot", sessionId: "old", revision: 9, pending: [h.request] });
	expect(screen.getByText("Which scope?")).toBeDefined();
	h.receive({ type: "interaction_snapshot", sessionId: "new", revision: 0, pending: [] });
	expect(screen.queryByText("Which scope?")).toBeNull();
});

test("secret questions use a masked input while retaining the submitted value", () => {
	const h = harness();
	render(<InteractionPanel transport={h.transport} />);
	h.receive({
		type: "interaction_snapshot",
		sessionId: "s",
		revision: 1,
		pending: [
			{
				...h.request,
				inputQuestions: [
					{ id: "token", header: "Token", question: "Enter token", options: null, isSecret: true },
				],
			},
		],
	});
	const input = screen.getByLabelText("Type your answer (optional)") as HTMLInputElement;
	expect(input.type).toBe("password");
	fireEvent.change(input, { target: { value: "secret-value" } });
	fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
	expect(h.sent.at(-1)).toMatchObject({
		type: "interaction_respond",
		value: { answers: { token: { answers: ["user_note: secret-value"] } } },
	});
});

test("same-context implementation requests transcript follow before sending the decision", async () => {
	const h = harness();
	const order: string[] = [];
	h.transport.send = message => {
		order.push(message.type);
		h.sent.push(message);
	};
	render(<InteractionPanel transport={h.transport} onFollowTranscript={() => order.push("follow")} />);
	h.receive({
		type: "interaction_snapshot",
		sessionId: "s",
		revision: 0,
		pending: [],
		plan: { id: "p", itemId: "i", revision: 1, markdown: "Plan", status: "pending" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Yes, implement this plan" }));
	expect(order.slice(-2)).toEqual(["follow", "plan_decide"]);
});
