/**
 * Office.js Word document tools (Claude-for-Office parity).
 *
 * The Word counterparts of the Excel/PowerPoint host tools: the agent invokes
 * these over the WS host-tool channel to read the document and insert text. They
 * plug into the transport-neutral {@link HostToolDispatcher} and return an
 * {@link AgentToolResult} (`content[]`).
 *
 * The concrete `Word.run` runtime is injected as {@link WordLike} (defaulting to
 * the page-global `Word`) so the tools are unit-testable with no Office runtime
 * and the module stays free of hard Office.js coupling.
 */
import { type AgentToolResult, HostToolDispatcher, type HostToolRegistration, type Transport } from "../core";

// --- Minimal structural views of the Word.run context we depend on. ---

/** Word `InsertLocation` values `insertText` uses (string enum on the wire). */
type WordInsertLocation = "Start" | "End" | "Replace";

/** Word `InsertLocation` values `insertParagraph` uses. */
type WordParagraphLocation = "Start" | "End" | "Before" | "After";

/** A single paragraph — the subset the paragraph tools read. */
export interface WordParagraphLike {
	/** Paragraph text (loaded via `load("items/text,style")`). */
	text: string;
	/** The paragraph's style name (e.g. "Heading 1", "Normal"). */
	style: string;
}

/** A loadable collection of paragraphs. */
export interface WordParagraphCollectionLike {
	items: WordParagraphLike[];
	load(properties: string): void;
}

/** A single comment — the subset `get_comments` reads. */
export interface WordCommentLike {
	content: string;
	authorName: string;
}

/** A loadable collection of comments. */
export interface WordCommentCollectionLike {
	items: WordCommentLike[];
	load(properties: string): void;
}

/** A single tracked change (revision) — the subset `get_tracked_changes` reads. */
export interface WordTrackedChangeLike {
	text: string;
	/** Revision type, e.g. "Inserted" or "Deleted". */
	type: string;
	authorName: string;
}

/** A loadable collection of tracked changes. */
export interface WordTrackedChangeCollectionLike {
	items: WordTrackedChangeLike[];
	load(properties: string): void;
}

/** A loadable collection of sections (only the count is used). */
export interface WordSectionCollectionLike {
	items: unknown[];
	load(properties: string): void;
}

export interface WordBodyLike {
	/** Loaded document text (available after load('text') + sync). */
	text: string;
	load(properties: string): void;
	insertText(text: string, location: WordInsertLocation): void;
	/** Insert a new paragraph relative to the body (Start/End). */
	insertParagraph(text: string, location: WordParagraphLocation): void;
	/** The document's paragraphs (loaded via `load("items/text,style")`). */
	paragraphs: WordParagraphCollectionLike;
	/** The document's comments. */
	comments: WordCommentCollectionLike;
	/** The document's tracked changes (revisions). */
	trackedChanges: WordTrackedChangeCollectionLike;
}
export interface WordRangeLike {
	/** Loaded selection text (available after load('text') + sync). */
	text: string;
	load(properties: string): void;
	insertText(text: string, location: WordInsertLocation): void;
	/** Insert a new paragraph relative to the selection (Before/After). */
	insertParagraph(text: string, location: WordParagraphLocation): void;
}
export interface WordDocumentLike {
	body: WordBodyLike;
	getSelection(): WordRangeLike;
	/** The document's sections (only the count is read). */
	sections: WordSectionCollectionLike;
}
export interface WordContextLike {
	document: WordDocumentLike;
	sync(): Promise<void>;
}

/** The `Word.run` seam — injected so tools need no Office runtime in tests. */
export interface WordLike {
	run<T>(batch: (context: WordContextLike) => Promise<T>): Promise<T>;
}

/** Resolve the page-global `Word`; overridable via injection. */
function getWord(): WordLike {
	const word = (globalThis as { Word?: WordLike }).Word;
	if (!word) {
		throw new Error("Word.js runtime is not available on the global scope");
	}
	return word;
}

function textResult<T extends Record<string, unknown>>(text: string, details?: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/** Enrich an OfficeExtension.Error-like failure with its code + debugInfo. */
function describeWordError(op: string, err: unknown): string {
	const e = err as { code?: unknown; message?: unknown; debugInfo?: unknown };
	const code = typeof e?.code === "string" && e.code ? ` [${e.code}]` : "";
	const message = typeof e?.message === "string" && e.message ? e.message : String(err);
	let debug = "";
	if (e?.debugInfo && typeof e.debugInfo === "object") {
		try {
			debug = ` debugInfo=${JSON.stringify(e.debugInfo)}`;
		} catch {
			/* non-serializable — omit */
		}
	}
	return `${op} failed${code}: ${message}${debug}`;
}

/** Map the tool's friendly `location` arg to a Word InsertLocation (or null if invalid). */
function toInsertLocation(location: string): WordInsertLocation | null {
	switch (location) {
		case "end":
			return "End";
		case "start":
			return "Start";
		case "replace-selection":
			return "Replace";
		default:
			return null;
	}
}

/** Map the friendly `location` arg to a Word paragraph InsertLocation (or null if invalid). */
function toParagraphLocation(location: string): WordParagraphLocation | null {
	switch (location) {
		case "end":
			return "End";
		case "start":
			return "Start";
		case "before-selection":
			return "Before";
		case "after-selection":
			return "After";
		default:
			return null;
	}
}

/** Count whitespace-delimited words in a run of text. */
function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Extract the heading level (1-based) from a paragraph style like "Heading 2", or null if not a heading. */
function headingLevel(style: string): number | null {
	if (!/heading/i.test(style)) {
		return null;
	}
	const match = style.match(/(\d+)/);
	return match ? Number.parseInt(match[1], 10) : 1;
}

/**
 * Build the Word host-tool registrations. Pass to
 * {@link HostToolDispatcher.register} or use {@link registerWordTools}.
 */
export function createWordHostTools(word: WordLike = getWord()): HostToolRegistration[] {
	return [
		{
			definition: {
				name: "read_document",
				description: "Read the full text content of the active Word document.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let text: string;
				try {
					text = await word.run(async ctx => {
						const body = ctx.document.body;
						body.load("text");
						await ctx.sync();
						return body.text;
					});
				} catch (err) {
					throw new Error(describeWordError("read_document", err));
				}
				return textResult(text, { text });
			},
		},
		{
			definition: {
				name: "insert_text",
				description:
					"Insert text into the active Word document at the end (default), the start, or in place of the current selection.",
				parameters: {
					type: "object",
					properties: {
						text: { type: "string", description: "The text to insert." },
						location: {
							type: "string",
							enum: ["end", "start", "replace-selection"],
							description: "Where to insert; defaults to 'end'.",
						},
					},
					required: ["text"],
				},
			},
			handler: async args => {
				const text = typeof args.text === "string" ? args.text : "";
				if (!text.trim()) {
					throw new Error('insert_text requires a non-empty "text"');
				}
				const requested = typeof args.location === "string" ? args.location : "end";
				const location = toInsertLocation(requested);
				if (location === null) {
					throw new Error(`insert_text: unknown location "${requested}" (use end, start, or replace-selection)`);
				}
				try {
					await word.run(async ctx => {
						if (location === "Replace") {
							ctx.document.getSelection().insertText(text, "Replace");
						} else {
							ctx.document.body.insertText(text, location);
						}
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describeWordError("insert_text", err));
				}
				return textResult(`Inserted text (${requested}).`, { text, location: requested });
			},
		},
		{
			definition: {
				name: "get_document_info",
				description:
					"Discover the structure of the open Word document: word/section/paragraph counts, whether it has " +
					"comments or tracked changes, and its heading outline. Call this FIRST to orient yourself before " +
					"answering a question about the document.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let info: {
					wordCount: number;
					sectionCount: number;
					paragraphCount: number;
					hasComments: boolean;
					hasTrackedChanges: boolean;
					headings: { text: string; level: number }[];
				};
				try {
					info = await word.run(async ctx => {
						const body = ctx.document.body;
						const sections = ctx.document.sections;
						body.load("text");
						body.paragraphs.load("items/text,style");
						body.comments.load("items/content");
						body.trackedChanges.load("items/type");
						sections.load("items");
						await ctx.sync();
						const headings: { text: string; level: number }[] = [];
						for (const p of body.paragraphs.items) {
							const level = headingLevel(p.style);
							if (level !== null) {
								headings.push({ text: p.text, level });
							}
						}
						return {
							wordCount: countWords(body.text),
							sectionCount: sections.items.length,
							paragraphCount: body.paragraphs.items.length,
							hasComments: body.comments.items.length > 0,
							hasTrackedChanges: body.trackedChanges.items.length > 0,
							headings,
						};
					});
				} catch (err) {
					throw new Error(describeWordError("get_document_info", err));
				}
				return textResult(JSON.stringify(info), info);
			},
		},
		{
			definition: {
				name: "read_paragraphs",
				description:
					"Read the document's paragraphs with their styles, in document order. Returns a slice starting at " +
					"startIndex (default 0) of at most count paragraphs (default 50); use this for styled paragraph content.",
				parameters: {
					type: "object",
					properties: {
						startIndex: { type: "number", description: "Zero-based index of the first paragraph (default 0)." },
						count: { type: "number", description: "Maximum number of paragraphs to return (default 50)." },
					},
				},
			},
			handler: async args => {
				const startIndex =
					typeof args.startIndex === "number" && args.startIndex >= 0 ? Math.floor(args.startIndex) : 0;
				const count = typeof args.count === "number" && args.count > 0 ? Math.floor(args.count) : 50;
				let paragraphs: { index: number; text: string; style: string }[];
				try {
					paragraphs = await word.run(async ctx => {
						const collection = ctx.document.body.paragraphs;
						collection.load("items/text,style");
						await ctx.sync();
						return collection.items
							.slice(startIndex, startIndex + count)
							.map((p, offset) => ({ index: startIndex + offset, text: p.text, style: p.style }));
					});
				} catch (err) {
					throw new Error(describeWordError("read_paragraphs", err));
				}
				return textResult(JSON.stringify(paragraphs), { paragraphs });
			},
		},
		{
			definition: {
				name: "read_selection",
				description: "Read the text of the current selection in the document (what the user has highlighted).",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let text: string;
				try {
					text = await word.run(async ctx => {
						const selection = ctx.document.getSelection();
						selection.load("text");
						await ctx.sync();
						return selection.text;
					});
				} catch (err) {
					throw new Error(describeWordError("read_selection", err));
				}
				return textResult(text, { text });
			},
		},
		{
			definition: {
				name: "get_comments",
				description: "Read the comments in the document, each with its content and author.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let comments: { content: string; author: string }[];
				try {
					comments = await word.run(async ctx => {
						const collection = ctx.document.body.comments;
						collection.load("items/content,authorName");
						await ctx.sync();
						return collection.items.map(c => ({ content: c.content, author: c.authorName }));
					});
				} catch (err) {
					throw new Error(describeWordError("get_comments", err));
				}
				return textResult(JSON.stringify(comments), { comments });
			},
		},
		{
			definition: {
				name: "get_tracked_changes",
				description:
					"Read the tracked changes (revisions) in the document, each with its text, type (Inserted/Deleted), " +
					"and author.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let changes: { text: string; type: string; author: string }[];
				try {
					changes = await word.run(async ctx => {
						const collection = ctx.document.body.trackedChanges;
						collection.load("items/text,type,authorName");
						await ctx.sync();
						return collection.items.map(c => ({ text: c.text, type: c.type, author: c.authorName }));
					});
				} catch (err) {
					throw new Error(describeWordError("get_tracked_changes", err));
				}
				return textResult(JSON.stringify(changes), { changes });
			},
		},
		{
			definition: {
				name: "insert_paragraph",
				description:
					"Insert a new paragraph at a specific location: the start or end of the document (default 'end'), " +
					"or before/after the current selection. Use insert_text for inline text within a paragraph.",
				parameters: {
					type: "object",
					properties: {
						text: { type: "string", description: "The paragraph text to insert." },
						location: {
							type: "string",
							enum: ["start", "end", "before-selection", "after-selection"],
							description: "Where to insert the paragraph; defaults to 'end'.",
						},
					},
					required: ["text"],
				},
			},
			handler: async args => {
				const text = typeof args.text === "string" ? args.text : "";
				if (!text.trim()) {
					throw new Error('insert_paragraph requires a non-empty "text"');
				}
				const requested = typeof args.location === "string" ? args.location : "end";
				const location = toParagraphLocation(requested);
				if (location === null) {
					throw new Error(
						`insert_paragraph: unknown location "${requested}" (use start, end, before-selection, or after-selection)`,
					);
				}
				try {
					await word.run(async ctx => {
						if (location === "Before" || location === "After") {
							ctx.document.getSelection().insertParagraph(text, location);
						} else {
							ctx.document.body.insertParagraph(text, location);
						}
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describeWordError("insert_paragraph", err));
				}
				return textResult(`Inserted paragraph (${requested}).`, { text, location: requested });
			},
		},
	];
}

/** Register the Word host tools with a dispatcher (advertises via set_host_tools). */
export function registerWordTools(
	dispatcher: { register(tools: HostToolRegistration[]): void },
	word: WordLike = getWord(),
): void {
	dispatcher.register(createWordHostTools(word));
}

/**
 * Wire the Word host tools onto a transport for the running add-in.
 * Mirrors {@link wireExcelHostTools}/{@link wirePowerPointHostTools}.
 */
export function wireWordHostTools(
	transport: Transport,
	word: WordLike = getWord(),
): { onConnected: () => void; dispatcher: HostToolDispatcher } {
	const dispatcher = new HostToolDispatcher(transport);
	return {
		dispatcher,
		onConnected: () => registerWordTools(dispatcher, word),
	};
}
