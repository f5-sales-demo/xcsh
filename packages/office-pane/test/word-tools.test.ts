/**
 * Word document tools registered through the host-tool dispatcher.
 * Mirrors powerpoint-tools.test.ts / excel-tools.test.ts: an injected WordLike
 * fake (the `Word.run` seam) drives read_document / insert_text with no Office
 * runtime.
 */
import { describe, expect, it } from "bun:test";
import { HostToolDispatcher, type HostToolResultMsg, MockTransport, type SetHostToolsMsg } from "../src/core";
import {
	createWordHostTools,
	registerWordTools,
	type WordContextLike,
	type WordLike,
	wireWordHostTools,
} from "../src/office/word-tools";

/** In-memory Word.run fake: a document body string + a selection sink. */
function fakeWord(initialText = ""): WordLike & { text: string; inserts: Array<{ text: string; location: string }> } {
	const state = { text: initialText, inserts: [] as Array<{ text: string; location: string }> };
	const body = {
		get text() {
			return state.text;
		},
		load(_p: string) {},
		insertText(text: string, location: string) {
			state.inserts.push({ text, location });
			if (location === "End") state.text += text;
			else if (location === "Start") state.text = text + state.text;
		},
	};
	const selection = {
		insertText(text: string, location: string) {
			state.inserts.push({ text, location });
		},
	};
	return {
		get text() {
			return state.text;
		},
		get inserts() {
			return state.inserts;
		},
		run: async <T>(batch: (ctx: WordContextLike) => Promise<T>): Promise<T> => {
			const ctx = {
				document: { body, getSelection: () => selection },
				sync: async () => {},
			};
			return batch(ctx as unknown as WordContextLike);
		},
	};
}

function callFrom(t: MockTransport): HostToolResultMsg | undefined {
	return t.sent.find(m => m.type === "host_tool_result") as HostToolResultMsg | undefined;
}
/** First content block's text (the native content union is TextContent | ImageContent). */
function firstText(reply?: HostToolResultMsg): string | undefined {
	const c = reply?.result.content[0];
	return c && c.type === "text" ? c.text : undefined;
}
function flush(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

describe("word-tools", () => {
	it("advertises read_document and insert_text", () => {
		const names = createWordHostTools(fakeWord())
			.map(t => t.definition.name)
			.sort();
		expect(names).toEqual(["insert_text", "read_document"]);
	});

	it("registerWordTools pushes the tools via set_host_tools", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord());
		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame?.tools.map(x => x.name).sort()).toEqual(["insert_text", "read_document"]);
		d.dispose();
	});

	it("read_document returns the body text as a content[] result", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord("Hello from the doc."));

		t.emit({ type: "host_tool_call", id: "w1", toolCallId: "t1", toolName: "read_document", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.id).toBe("w1");
		expect(reply?.isError).toBeUndefined();
		expect(firstText(reply)).toContain("Hello from the doc.");
		d.dispose();
	});

	it("insert_text appends to the end of the document by default", async () => {
		const t = new MockTransport();
		const doc = fakeWord("Start.");
		const d = new HostToolDispatcher(t);
		registerWordTools(d, doc);

		t.emit({
			type: "host_tool_call",
			id: "w2",
			toolCallId: "t2",
			toolName: "insert_text",
			arguments: { text: " Appended." },
		});
		await flush();

		expect(doc.text).toBe("Start. Appended.");
		expect(doc.inserts.at(-1)?.location).toBe("End");
		expect(callFrom(t)?.isError).toBeUndefined();
		d.dispose();
	});

	it("insert_text at the start prepends", async () => {
		const t = new MockTransport();
		const doc = fakeWord("body");
		const d = new HostToolDispatcher(t);
		registerWordTools(d, doc);

		t.emit({
			type: "host_tool_call",
			id: "w3",
			toolCallId: "t3",
			toolName: "insert_text",
			arguments: { text: "TITLE\n", location: "start" },
		});
		await flush();

		expect(doc.text).toBe("TITLE\nbody");
		expect(doc.inserts.at(-1)?.location).toBe("Start");
		d.dispose();
	});

	it("insert_text with replace-selection targets the selection with Replace", async () => {
		const t = new MockTransport();
		const doc = fakeWord("unchanged body");
		const d = new HostToolDispatcher(t);
		registerWordTools(d, doc);

		t.emit({
			type: "host_tool_call",
			id: "w4",
			toolCallId: "t4",
			toolName: "insert_text",
			arguments: { text: "replacement", location: "replace-selection" },
		});
		await flush();

		// Body text unchanged (selection sink), but a Replace insert was recorded.
		expect(doc.text).toBe("unchanged body");
		expect(doc.inserts).toContainEqual({ text: "replacement", location: "Replace" });
		expect(callFrom(t)?.isError).toBeUndefined();
		d.dispose();
	});

	it("insert_text with no text answers isError (never hangs)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord());

		t.emit({ type: "host_tool_call", id: "w5", toolCallId: "t5", toolName: "insert_text", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("text");
		d.dispose();
	});

	it("rejects an unknown location instead of silently defaulting", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord("x"));

		t.emit({
			type: "host_tool_call",
			id: "w6",
			toolCallId: "t6",
			toolName: "insert_text",
			arguments: { text: "y", location: "middle" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("location");
		d.dispose();
	});

	it("surfaces the Word error code + debugInfo when Word.run fails", async () => {
		const t = new MockTransport();
		const failing: WordLike = {
			run: async () => {
				throw { code: "GeneralException", message: "boom", debugInfo: { errorLocation: "Body.load" } };
			},
		};
		const d = new HostToolDispatcher(t);
		registerWordTools(d, failing);

		t.emit({ type: "host_tool_call", id: "w7", toolCallId: "t7", toolName: "read_document", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		const txt = firstText(reply) ?? "";
		expect(txt).toContain("read_document");
		expect(txt).toContain("GeneralException");
		expect(txt).toContain("errorLocation");
		d.dispose();
	});

	it("wireWordHostTools advertises after connect and services a host_tool_call", async () => {
		const t = new MockTransport();
		const { onConnected, dispatcher } = wireWordHostTools(t, fakeWord("doc text"));
		expect(t.sent.some(m => m.type === "set_host_tools")).toBe(false);
		onConnected();
		expect(t.sent.some(m => m.type === "set_host_tools")).toBe(true);

		t.emit({ type: "host_tool_call", id: "w8", toolCallId: "t8", toolName: "read_document", arguments: {} });
		await flush();
		expect(firstText(callFrom(t))).toContain("doc text");
		dispatcher.dispose();
	});
});
