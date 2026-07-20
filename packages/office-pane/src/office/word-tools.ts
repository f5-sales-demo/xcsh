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

/** Word `InsertLocation` values we use (string enum on the wire). */
type WordInsertLocation = "Start" | "End" | "Replace";

export interface WordBodyLike {
	/** Loaded document text (available after load('text') + sync). */
	text: string;
	load(properties: string): void;
	insertText(text: string, location: WordInsertLocation): void;
}
export interface WordRangeLike {
	insertText(text: string, location: WordInsertLocation): void;
}
export interface WordDocumentLike {
	body: WordBodyLike;
	getSelection(): WordRangeLike;
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
