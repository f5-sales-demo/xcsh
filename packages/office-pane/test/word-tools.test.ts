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

/**
 * Structural metadata for the {@link fakeWord} mock — the higher-order surfaces
 * (#2216 Word depth tools) the flat body-text store can't express: styled
 * paragraphs, comments, tracked changes, the section count, and the current
 * selection text.
 */
interface FakeWordMeta {
	/** Styled paragraphs, in document order. */
	paragraphs?: { text: string; style: string }[];
	/** Document comments. */
	comments?: { content: string; authorName: string }[];
	/** Tracked changes (revisions). */
	trackedChanges?: { text: string; type: string; author: string }[];
	/** Number of sections (defaults to 1). */
	sectionCount?: number;
	/** The current selection's text. */
	selection?: string;
}

/**
 * In-memory Word.run fake: a document body string + a selection sink, plus the
 * optional structural surfaces (paragraphs, comments, tracked changes, sections,
 * selection text) the depth tools read. `inserts` records `insertText` calls and
 * `paragraphInserts` records `insertParagraph` calls (from body or selection).
 */
function fakeWord(
	initialText = "",
	meta: FakeWordMeta = {},
): WordLike & {
	text: string;
	inserts: Array<{ text: string; location: string }>;
	paragraphInserts: Array<{ text: string; location: string }>;
} {
	const state = {
		text: initialText,
		inserts: [] as Array<{ text: string; location: string }>,
		paragraphInserts: [] as Array<{ text: string; location: string }>,
	};
	const paragraphs = {
		items: (meta.paragraphs ?? []).map(p => ({ ...p })),
		load(_p: string) {},
	};
	const comments = {
		items: (meta.comments ?? []).map(c => ({ ...c })),
		load(_p: string) {},
	};
	const trackedChanges = {
		items: (meta.trackedChanges ?? []).map(tc => ({ ...tc })),
		load(_p: string) {},
	};
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
		insertParagraph(text: string, location: string) {
			state.paragraphInserts.push({ text, location });
		},
		paragraphs,
		getComments: () => comments,
		getTrackedChanges: () => trackedChanges,
	};
	const sections = {
		items: Array.from({ length: meta.sectionCount ?? 1 }, () => ({})),
		load(_p: string) {},
	};
	const selection = {
		text: meta.selection ?? "",
		load(_p: string) {},
		insertText(text: string, location: string) {
			state.inserts.push({ text, location });
		},
		insertParagraph(text: string, location: string) {
			state.paragraphInserts.push({ text, location });
		},
	};
	return {
		get text() {
			return state.text;
		},
		get inserts() {
			return state.inserts;
		},
		get paragraphInserts() {
			return state.paragraphInserts;
		},
		run: async <T>(batch: (ctx: WordContextLike) => Promise<T>): Promise<T> => {
			const ctx = {
				document: { body, getSelection: () => selection, sections },
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
	const ALL_TOOL_NAMES = [
		"get_comments",
		"get_document_info",
		"get_tracked_changes",
		"insert_paragraph",
		"insert_text",
		"read_document",
		"read_paragraphs",
		"read_selection",
	];

	it("advertises the full Word tool catalog", () => {
		const names = createWordHostTools(fakeWord())
			.map(t => t.definition.name)
			.sort();
		expect(names).toEqual(ALL_TOOL_NAMES);
	});

	it("registerWordTools pushes the tools via set_host_tools", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord());
		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame?.tools.map(x => x.name).sort()).toEqual(ALL_TOOL_NAMES);
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

	it("get_document_info summarizes structure, headings, comments and tracked changes", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(
			d,
			fakeWord("The quick brown fox jumps", {
				paragraphs: [
					{ text: "Title", style: "Heading 1" },
					{ text: "Subhead", style: "Heading 2" },
					{ text: "Body text here", style: "Normal" },
				],
				comments: [{ content: "fix this", authorName: "Reviewer" }],
				trackedChanges: [{ text: "insert", type: "Added", author: "Editor" }],
				sectionCount: 2,
			}),
		);

		t.emit({ type: "host_tool_call", id: "d1", toolCallId: "t1", toolName: "get_document_info", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		const info = JSON.parse(firstText(reply) ?? "{}");
		expect(info.wordCount).toBe(5);
		expect(info.sectionCount).toBe(2);
		expect(info.paragraphCount).toBe(3);
		expect(info.hasComments).toBe(true);
		expect(info.hasTrackedChanges).toBe(true);
		expect(info.headings).toEqual([
			{ text: "Title", level: 1 },
			{ text: "Subhead", level: 2 },
		]);
		d.dispose();
	});

	it("get_document_info reports empty structure for a plain document", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord("", { paragraphs: [{ text: "", style: "Normal" }] }));

		t.emit({ type: "host_tool_call", id: "d2", toolCallId: "t2", toolName: "get_document_info", arguments: {} });
		await flush();

		const info = JSON.parse(firstText(callFrom(t)) ?? "{}");
		expect(info.wordCount).toBe(0);
		expect(info.sectionCount).toBe(1);
		expect(info.hasComments).toBe(false);
		expect(info.hasTrackedChanges).toBe(false);
		expect(info.headings).toEqual([]);
		d.dispose();
	});

	it("read_paragraphs returns indexed paragraphs with styles", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(
			d,
			fakeWord("", {
				paragraphs: [
					{ text: "One", style: "Heading 1" },
					{ text: "Two", style: "Normal" },
					{ text: "Three", style: "Normal" },
				],
			}),
		);

		t.emit({ type: "host_tool_call", id: "p1", toolCallId: "t1", toolName: "read_paragraphs", arguments: {} });
		await flush();

		const paras = JSON.parse(firstText(callFrom(t)) ?? "[]");
		expect(paras).toEqual([
			{ index: 0, text: "One", style: "Heading 1" },
			{ index: 1, text: "Two", style: "Normal" },
			{ index: 2, text: "Three", style: "Normal" },
		]);
		d.dispose();
	});

	it("read_paragraphs honors startIndex and count", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(
			d,
			fakeWord("", {
				paragraphs: [
					{ text: "a", style: "Normal" },
					{ text: "b", style: "Normal" },
					{ text: "c", style: "Normal" },
					{ text: "d", style: "Normal" },
				],
			}),
		);

		t.emit({
			type: "host_tool_call",
			id: "p2",
			toolCallId: "t2",
			toolName: "read_paragraphs",
			arguments: { startIndex: 1, count: 2 },
		});
		await flush();

		const paras = JSON.parse(firstText(callFrom(t)) ?? "[]");
		expect(paras).toEqual([
			{ index: 1, text: "b", style: "Normal" },
			{ index: 2, text: "c", style: "Normal" },
		]);
		d.dispose();
	});

	it("read_selection returns the current selection text", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord("full body", { selection: "selected phrase" }));

		t.emit({ type: "host_tool_call", id: "s1", toolCallId: "t1", toolName: "read_selection", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		expect(firstText(reply)).toContain("selected phrase");
		d.dispose();
	});

	it("get_comments returns comments with authors", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(
			d,
			fakeWord("", {
				comments: [
					{ content: "first note", authorName: "Alice" },
					{ content: "second note", authorName: "Bob" },
				],
			}),
		);

		t.emit({ type: "host_tool_call", id: "c1", toolCallId: "t1", toolName: "get_comments", arguments: {} });
		await flush();

		const comments = JSON.parse(firstText(callFrom(t)) ?? "[]");
		expect(comments).toEqual([
			{ content: "first note", author: "Alice" },
			{ content: "second note", author: "Bob" },
		]);
		d.dispose();
	});

	it("get_tracked_changes returns revisions with type and author", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(
			d,
			fakeWord("", {
				trackedChanges: [
					{ text: "added", type: "Added", author: "Alice" },
					{ text: "removed", type: "Deleted", author: "Bob" },
				],
			}),
		);

		t.emit({ type: "host_tool_call", id: "tc1", toolCallId: "t1", toolName: "get_tracked_changes", arguments: {} });
		await flush();

		const changes = JSON.parse(firstText(callFrom(t)) ?? "[]");
		expect(changes).toEqual([
			{ text: "added", type: "Added", author: "Alice" },
			{ text: "removed", type: "Deleted", author: "Bob" },
		]);
		d.dispose();
	});

	it("insert_paragraph appends at the end by default", async () => {
		const t = new MockTransport();
		const doc = fakeWord("body");
		const d = new HostToolDispatcher(t);
		registerWordTools(d, doc);

		t.emit({
			type: "host_tool_call",
			id: "ip1",
			toolCallId: "t1",
			toolName: "insert_paragraph",
			arguments: { text: "New para" },
		});
		await flush();

		expect(callFrom(t)?.isError).toBeUndefined();
		expect(doc.paragraphInserts).toContainEqual({ text: "New para", location: "End" });
		d.dispose();
	});

	it("insert_paragraph maps location to Word insert locations", async () => {
		const cases: Array<[string, string]> = [
			["start", "Start"],
			["end", "End"],
			["before-selection", "Before"],
			["after-selection", "After"],
		];
		let n = 0;
		for (const [loc, expected] of cases) {
			n += 1;
			const t = new MockTransport();
			const doc = fakeWord("body");
			const d = new HostToolDispatcher(t);
			registerWordTools(d, doc);

			t.emit({
				type: "host_tool_call",
				id: `ip-${n}`,
				toolCallId: `t-${n}`,
				toolName: "insert_paragraph",
				arguments: { text: "P", location: loc },
			});
			await flush();

			expect(callFrom(t)?.isError).toBeUndefined();
			expect(doc.paragraphInserts).toContainEqual({ text: "P", location: expected });
			d.dispose();
		}
	});

	it("insert_paragraph with no text answers isError (never hangs)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord());

		t.emit({ type: "host_tool_call", id: "ip9", toolCallId: "t9", toolName: "insert_paragraph", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("text");
		d.dispose();
	});

	it("insert_paragraph rejects an unknown location", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerWordTools(d, fakeWord("x"));

		t.emit({
			type: "host_tool_call",
			id: "ip10",
			toolCallId: "t10",
			toolName: "insert_paragraph",
			arguments: { text: "y", location: "sideways" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("location");
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
