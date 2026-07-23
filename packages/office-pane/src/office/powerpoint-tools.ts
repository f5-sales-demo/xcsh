/**
 * Office.js PowerPoint document tools.
 *
 * The PowerPoint counterparts of the Excel host tools: the agent invokes these
 * over the WS host-tool channel to read and build slides. They plug into the
 * transport-neutral {@link HostToolDispatcher} and return an {@link AgentToolResult}
 * (`content[]`) over the wire.
 *
 * The concrete `PowerPoint.run` runtime is injected as {@link PowerPointLike}
 * (defaulting to the page-global `PowerPoint`) so the tools are unit-testable
 * with no Office runtime and the module stays free of hard Office.js coupling.
 */
import { type AgentToolResult, HostToolDispatcher, type HostToolRegistration, type Transport } from "../core";

// --- Minimal structural views of the PowerPoint.run context we depend on. ---

export interface PptTextRangeLike {
	/** Writable — assign to rewrite the shape's text (modify_shape_text). */
	text: string;
}
export interface PptTextFrameLike {
	/** Whether the frame actually contains text (guards empty/placeholder frames). */
	hasText?: boolean;
	textRange: PptTextRangeLike;
	load(properties: string): void;
}
export interface PptShapeLike {
	/** Shape name (e.g. 'Title 1','TextBox 3'); the addressing key for modify_shape_text. */
	name?: string;
	/** ShapeType string (e.g. 'textBox','table','group'); tables/groups throw on textFrame access. */
	type?: string;
	left?: number;
	top?: number;
	width?: number;
	height?: number;
	textFrame?: PptTextFrameLike;
}
export interface PptShapeCollectionLike {
	items: PptShapeLike[];
	load(properties: string): void;
	/** Add a text box with the given text to the slide. */
	addTextBox(text: string): PptShapeLike;
}
/** A layout or master reference exposing a loadable `name`. */
export interface PptNamedRefLike {
	name: string;
	load(properties: string): void;
}
export interface PptSlideLike {
	shapes: PptShapeCollectionLike;
	/** The slide layout applied to this slide. */
	layout: PptNamedRefLike;
	/** The slide master behind this slide's layout. */
	slideMaster: PptNamedRefLike;
}
export interface PptSlideCollectionLike {
	items: PptSlideLike[];
	load(properties: string): void;
	/** Append a new blank slide to the presentation. */
	add(): void;
	getItemAt(index: number): PptSlideLike;
}
export interface PptSelectedSlidesLike {
	getItemAt(index: number): PptSlideLike;
}
export interface PptContextLike {
	presentation: {
		slides: PptSlideCollectionLike;
		getSelectedSlides(): PptSelectedSlidesLike;
	};
	sync(): Promise<void>;
}

/** The `PowerPoint.run` seam — injected so tools need no Office runtime in tests. */
export interface PowerPointLike {
	run<T>(batch: (context: PptContextLike) => Promise<T>): Promise<T>;
}

/** Resolve the page-global `PowerPoint`; overridable via injection. */
function getPowerPoint(): PowerPointLike {
	const ppt = (globalThis as { PowerPoint?: PowerPointLike }).PowerPoint;
	if (!ppt) {
		throw new Error("PowerPoint.js runtime is not available on the global scope");
	}
	return ppt;
}

function textResult<T extends Record<string, unknown>>(text: string, details?: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/** Enrich an OfficeExtension.Error-like failure with its code + debugInfo. */
function describePptError(op: string, err: unknown): string {
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

// Shape types whose `textFrame` throws (table) or is inaccessible (group) — skip
// them so a deck with a table/SmartArt doesn't fail the whole read.
const NON_TEXT_SHAPE_TYPES = new Set(["table", "group"]);

/** Read the text of every slide as an array of per-slide strings, robust to
 * non-text shapes (tables, groups, images) that would otherwise throw at sync. */
async function readAllSlideText(ppt: PowerPointLike): Promise<string[]> {
	return ppt.run(async ctx => {
		const slides = ctx.presentation.slides;
		slides.load("items");
		await ctx.sync();

		// First learn each shape's type — reading textFrame on a table throws.
		for (const slide of slides.items) {
			slide.shapes.load("items/type");
		}
		await ctx.sync();

		// Only load text for text-bearing shapes; skip tables/groups.
		const textShapesPerSlide = slides.items.map(slide =>
			slide.shapes.items.filter(shape => !NON_TEXT_SHAPE_TYPES.has(shape.type ?? "")),
		);
		for (const shapes of textShapesPerSlide) {
			for (const shape of shapes) {
				shape.textFrame?.load("hasText,textRange/text");
			}
		}
		await ctx.sync();

		return textShapesPerSlide.map(shapes =>
			shapes
				.map(shape => (shape.textFrame?.hasText ? (shape.textFrame.textRange?.text ?? "") : ""))
				.filter(t => t.trim().length > 0)
				.join("\n"),
		);
	});
}

/** A single slide's structural summary in {@link readPresentationInfo}. */
export interface SlideSummary {
	index: number;
	layoutName: string;
	shapesCount: number;
}

/** Structural overview of the whole deck: slide count + per-slide layout/shape counts. */
async function readPresentationInfo(ppt: PowerPointLike): Promise<{ slideCount: number; slides: SlideSummary[] }> {
	return ppt.run(async ctx => {
		const slides = ctx.presentation.slides;
		slides.load("items");
		await ctx.sync();

		for (const slide of slides.items) {
			slide.layout.load("name");
			slide.shapes.load("items");
		}
		await ctx.sync();

		return {
			slideCount: slides.items.length,
			slides: slides.items.map((slide, index) => ({
				index,
				layoutName: slide.layout?.name ?? "",
				shapesCount: slide.shapes.items.length,
			})),
		};
	});
}

/** A single shape's detail in {@link readSlideShapes}. */
export interface ShapeDetail {
	name: string;
	type: string;
	text?: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Read every shape on a slide with its name, type, text (when text-bearing), and geometry. */
async function readSlideShapes(ppt: PowerPointLike, slideIndex: number): Promise<ShapeDetail[]> {
	return ppt.run(async ctx => {
		const slide = ctx.presentation.slides.getItemAt(slideIndex);
		slide.shapes.load("items/name,type,left,top,width,height");
		await ctx.sync();

		const shapes = slide.shapes.items;
		// Only load text for text-bearing shapes; a table's textFrame throws at sync.
		for (const shape of shapes) {
			if (!NON_TEXT_SHAPE_TYPES.has(shape.type ?? "")) {
				shape.textFrame?.load("hasText,textRange/text");
			}
		}
		await ctx.sync();

		return shapes.map(shape => {
			const textual = !NON_TEXT_SHAPE_TYPES.has(shape.type ?? "") && shape.textFrame?.hasText;
			const text = textual ? (shape.textFrame?.textRange?.text ?? "") : "";
			const detail: ShapeDetail = {
				name: shape.name ?? "",
				type: shape.type ?? "",
				left: shape.left ?? 0,
				top: shape.top ?? 0,
				width: shape.width ?? 0,
				height: shape.height ?? 0,
			};
			if (text.trim().length > 0) {
				detail.text = text;
			}
			return detail;
		});
	});
}

/** Read the layout + master names applied to a slide. */
async function readSlideLayout(
	ppt: PowerPointLike,
	slideIndex: number,
): Promise<{ layoutName: string; masterName: string }> {
	return ppt.run(async ctx => {
		const slide = ctx.presentation.slides.getItemAt(slideIndex);
		slide.layout.load("name");
		slide.slideMaster.load("name");
		await ctx.sync();
		return { layoutName: slide.layout?.name ?? "", masterName: slide.slideMaster?.name ?? "" };
	});
}

/**
 * Build the PowerPoint host-tool registrations. Pass to
 * {@link HostToolDispatcher.register} or use {@link registerPowerPointTools}.
 */
export function createPowerPointHostTools(ppt: PowerPointLike = getPowerPoint()): HostToolRegistration[] {
	return [
		{
			definition: {
				name: "read_slides",
				description: "Read the text content of every slide in the active PowerPoint presentation.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let slides: string[];
				try {
					slides = await readAllSlideText(ppt);
				} catch (err) {
					throw new Error(describePptError("read_slides", err));
				}
				return textResult(JSON.stringify(slides), { slides });
			},
		},
		{
			definition: {
				name: "get_presentation_info",
				description:
					"Structural overview of the open presentation: slide count and, per slide, its 0-based index, layout name, and shape count. Call this FIRST to discover the deck.",
				parameters: { type: "object", properties: {} },
			},
			handler: async () => {
				let info: { slideCount: number; slides: SlideSummary[] };
				try {
					info = await readPresentationInfo(ppt);
				} catch (err) {
					throw new Error(describePptError("get_presentation_info", err));
				}
				return textResult(JSON.stringify(info), info);
			},
		},
		{
			definition: {
				name: "read_slide_shapes",
				description:
					"Read every shape on a slide (by 0-based slideIndex) with its name, type, text (when text-bearing), and geometry (left/top/width/height).",
				parameters: {
					type: "object",
					properties: {
						slideIndex: { type: "number", description: "0-based slide index to read." },
					},
					required: ["slideIndex"],
				},
			},
			handler: async args => {
				if (typeof args.slideIndex !== "number") {
					throw new Error('read_slide_shapes requires a numeric "slideIndex"');
				}
				let shapes: ShapeDetail[];
				try {
					shapes = await readSlideShapes(ppt, args.slideIndex);
				} catch (err) {
					throw new Error(describePptError("read_slide_shapes", err));
				}
				return textResult(JSON.stringify(shapes), { shapes });
			},
		},
		{
			definition: {
				name: "read_slide_layout",
				description: "Read the layout name and slide-master name applied to a slide (by 0-based slideIndex).",
				parameters: {
					type: "object",
					properties: {
						slideIndex: { type: "number", description: "0-based slide index to inspect." },
					},
					required: ["slideIndex"],
				},
			},
			handler: async args => {
				if (typeof args.slideIndex !== "number") {
					throw new Error('read_slide_layout requires a numeric "slideIndex"');
				}
				let layout: { layoutName: string; masterName: string };
				try {
					layout = await readSlideLayout(ppt, args.slideIndex);
				} catch (err) {
					throw new Error(describePptError("read_slide_layout", err));
				}
				return textResult(JSON.stringify(layout), layout);
			},
		},
		{
			definition: {
				name: "modify_shape_text",
				description:
					"Replace the text of an existing shape on a slide, addressed by its name (from read_slide_shapes/get_presentation_info).",
				parameters: {
					type: "object",
					properties: {
						slideIndex: { type: "number", description: "0-based slide index containing the shape." },
						shapeName: { type: "string", description: "The name of the shape to edit." },
						text: { type: "string", description: "The new text for the shape." },
					},
					required: ["slideIndex", "shapeName", "text"],
				},
			},
			handler: async args => {
				if (typeof args.slideIndex !== "number") {
					throw new Error('modify_shape_text requires a numeric "slideIndex"');
				}
				const shapeName = typeof args.shapeName === "string" ? args.shapeName : "";
				if (!shapeName.trim()) {
					throw new Error('modify_shape_text requires a non-empty "shapeName"');
				}
				if (typeof args.text !== "string") {
					throw new Error('modify_shape_text requires a "text" string');
				}
				const text = args.text;
				const slideIndex = args.slideIndex;
				try {
					await ppt.run(async ctx => {
						const slide = ctx.presentation.slides.getItemAt(slideIndex);
						slide.shapes.load("items/name");
						await ctx.sync();
						const shape = slide.shapes.items.find(s => s.name === shapeName);
						if (!shape) {
							throw new Error(`no shape named "${shapeName}" on slide ${slideIndex}`);
						}
						if (!shape.textFrame) {
							throw new Error(`shape "${shapeName}" on slide ${slideIndex} has no text frame`);
						}
						shape.textFrame.textRange.text = text;
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describePptError("modify_shape_text", err));
				}
				return textResult(`Set the text of shape "${shapeName}" on slide ${slideIndex}.`, {
					slideIndex,
					shapeName,
					text,
				});
			},
		},
		{
			definition: {
				name: "add_text_box",
				description: "Add a text box with the given text to a slide (the selected slide, or a 0-based slideIndex).",
				parameters: {
					type: "object",
					properties: {
						text: { type: "string", description: "The text to place in the new text box." },
						slideIndex: {
							type: "number",
							description: "Optional 0-based slide index; defaults to the selected slide.",
						},
					},
					required: ["text"],
				},
			},
			handler: async args => {
				const text = typeof args.text === "string" ? args.text : "";
				if (!text.trim()) {
					throw new Error('add_text_box requires a non-empty "text"');
				}
				const slideIndex = typeof args.slideIndex === "number" ? args.slideIndex : undefined;
				try {
					await ppt.run(async ctx => {
						const slide =
							slideIndex !== undefined
								? ctx.presentation.slides.getItemAt(slideIndex)
								: ctx.presentation.getSelectedSlides().getItemAt(0);
						slide.shapes.addTextBox(text);
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describePptError("add_text_box", err));
				}
				return textResult(`Added a text box${slideIndex !== undefined ? ` to slide ${slideIndex}` : ""}.`, {
					text,
				});
			},
		},
		{
			definition: {
				name: "add_slide",
				description: "Append a new slide with a title and optional body lines to the active presentation.",
				parameters: {
					type: "object",
					properties: {
						title: { type: "string", description: "Title text for the new slide." },
						body: {
							type: "array",
							description: "Optional body lines (e.g. bullet points).",
							items: { type: "string" },
						},
					},
					required: ["title"],
				},
			},
			handler: async args => {
				const title = typeof args.title === "string" ? args.title : "";
				if (!title.trim()) {
					throw new Error('add_slide requires a non-empty "title"');
				}
				const body = Array.isArray(args.body) ? args.body.map(b => String(b)) : [];
				try {
					await ppt.run(async ctx => {
						const slides = ctx.presentation.slides;
						slides.add();
						await ctx.sync();
						slides.load("items");
						await ctx.sync();
						const newSlide = slides.getItemAt(slides.items.length - 1);
						newSlide.shapes.addTextBox(title);
						if (body.length > 0) {
							newSlide.shapes.addTextBox(body.join("\n"));
						}
						await ctx.sync();
					});
				} catch (err) {
					throw new Error(describePptError("add_slide", err));
				}
				return textResult(
					`Added a slide titled "${title}"${body.length ? ` with ${body.length} body line(s)` : ""}.`,
					{
						title,
						body,
					},
				);
			},
		},
	];
}

/** Register the PowerPoint host tools with a dispatcher (advertises via set_host_tools). */
export function registerPowerPointTools(
	dispatcher: { register(tools: HostToolRegistration[]): void },
	ppt: PowerPointLike = getPowerPoint(),
): void {
	dispatcher.register(createPowerPointHostTools(ppt));
}

/**
 * Wire the PowerPoint host tools onto a transport for the running add-in.
 * Mirrors {@link wireExcelHostTools}: constructs the dispatcher immediately
 * (subscribing for `host_tool_call`) and returns the `onConnected` callback that
 * advertises the tools once the transport is open.
 */
export function wirePowerPointHostTools(
	transport: Transport,
	ppt: PowerPointLike = getPowerPoint(),
): { onConnected: () => void; dispatcher: HostToolDispatcher } {
	const dispatcher = new HostToolDispatcher(transport);
	return {
		dispatcher,
		onConnected: () => registerPowerPointTools(dispatcher, ppt),
	};
}
