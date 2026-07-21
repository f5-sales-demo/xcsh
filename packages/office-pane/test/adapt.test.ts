import { describe, expect, test } from "bun:test";

import { CHAT_ERROR_REASONS } from "../src/core";
import { ERROR_MESSAGES, errorText, MODE_OPTIONS, turnsToMessages } from "../src/panel/adapt";
import type { AssistantTurn, Turn, UserTurn } from "../src/panel/useChatSession";

function user(id: string, text: string): UserTurn {
	return { kind: "user", id, text };
}

function assistant(id: string, text: string, over: Partial<AssistantTurn["state"]> = {}): AssistantTurn {
	return {
		kind: "assistant",
		state: { id, text, status: "done", references: [], lastSeq: text.length - 1, pending: {}, ...over },
	};
}

describe("errorText", () => {
	test("maps a classified reason to its human message", () => {
		expect(errorText("provider-5xx")).toBe(ERROR_MESSAGES["provider-5xx"]);
	});

	test("falls back to raw error text when reason is absent", () => {
		expect(errorText(undefined, "  boom  ")).toBe("boom");
	});

	test("falls back to a generic message when neither is present", () => {
		expect(errorText(undefined, "")).toBe("Something went wrong. Please try again.");
	});

	test("covers every ChatErrorReason (exhaustive map)", () => {
		for (const r of CHAT_ERROR_REASONS) {
			expect(ERROR_MESSAGES[r]).toBeTruthy();
		}
	});
});

describe("turnsToMessages", () => {
	test("maps a user turn to a user row and an assistant turn to an assistant row", () => {
		const turns: Turn[] = [user("u-1", "hello"), assistant("c-1", "hi there")];
		const msgs = turnsToMessages({ turns, status: "done" });
		expect(msgs).toEqual([
			{ id: "u-1", role: "user", text: "hello" },
			{ id: "c-1", role: "assistant", text: "hi there" },
		]);
	});

	test("a streaming assistant turn keeps its partial text and is not an error", () => {
		const turns: Turn[] = [user("u-1", "go"), assistant("c-1", "partia", { status: "streaming" })];
		const msgs = turnsToMessages({ turns, status: "streaming" });
		expect(msgs[1]).toMatchObject({ id: "c-1", role: "assistant", text: "partia" });
		expect(msgs[1].error).toBeUndefined();
	});

	test("a terminal turn error renders the classified message + retry on the last row", () => {
		const turns: Turn[] = [user("u-1", "do it"), assistant("c-1", "", { status: "error", reason: "provider-5xx" })];
		const msgs = turnsToMessages({ turns, status: "error", reason: "provider-5xx" });
		const last = msgs[msgs.length - 1];
		expect(last.error).toBe(true);
		expect(last.text).toBe(ERROR_MESSAGES["provider-5xx"]);
		expect(last.retryText).toBe("do it");
	});

	test("a connect-level error with no turns appends a synthetic error row (with retry text absent)", () => {
		const msgs = turnsToMessages({ turns: [], status: "error", reason: "bridge-disconnected" });
		expect(msgs).toHaveLength(1);
		expect(msgs[0]).toMatchObject({ role: "assistant", error: true, text: ERROR_MESSAGES["bridge-disconnected"] });
		expect(msgs[0].retryText).toBeUndefined();
	});

	test("a connect-level error after prior turns appends a synthetic error row with retry text", () => {
		const turns: Turn[] = [user("u-1", "hi"), assistant("c-1", "answer")];
		const msgs = turnsToMessages({ turns, status: "error", reason: "bridge-disconnected", error: "socket closed" });
		expect(msgs).toHaveLength(3);
		const last = msgs[msgs.length - 1];
		expect(last).toMatchObject({ role: "assistant", error: true, text: ERROR_MESSAGES["bridge-disconnected"] });
		expect(last.retryText).toBe("hi");
	});

	test("does not double-append when the last turn already carries the error", () => {
		const turns: Turn[] = [user("u-1", "x"), assistant("c-1", "", { status: "error", reason: "no-worker" })];
		const msgs = turnsToMessages({ turns, status: "error", reason: "no-worker" });
		expect(msgs).toHaveLength(2);
		expect(msgs.filter(m => m.error)).toHaveLength(1);
	});
});

describe("MODE_OPTIONS", () => {
	test("exposes every interaction mode as a labelled option for the composer", () => {
		expect(MODE_OPTIONS.map(m => m.id)).toEqual([
			"educational",
			"presentation",
			"configuration",
			"screenshot",
			"annotation",
		]);
		for (const opt of MODE_OPTIONS) {
			expect(opt.label.length).toBeGreaterThan(0);
		}
	});
});
