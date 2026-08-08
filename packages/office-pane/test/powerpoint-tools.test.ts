/**
 * PowerPoint document tools registered through the host-tool dispatcher.
 * Mirrors excel-tools.test.ts: an injected PowerPointLike fake (the
 * `PowerPoint.run` seam) drives read_slides / add_text_box / add_slide with no
 * Office runtime.
 */
import { describe, expect, it } from "bun:test";
import { HostToolDispatcher, type HostToolResultMsg, MockTransport, type SetHostToolsMsg } from "../src/core";
import {
	createPowerPointHostTools,
	type PowerPointLike,
	type PptContextLike,
	registerPowerPointTools,
	wirePowerPointHostTools,
} from "../src/office/powerpoint-tools";

interface FakeShape {
	name: string;
	type: string;
	left: number;
	top: number;
	width: number;
	height: number;
	textFrame?: { hasText: boolean; textRange: { text: string }; load(props: string): void };
}
interface FakeSlide {
	shapes: FakeShape[];
	layoutName: string;
	masterName: string;
}

/**
 * In-memory PowerPoint.run fake: slides = arrays of shape texts. Each shape is
 * auto-named ("Shape 1", "Shape 2", …) with deterministic geometry; each slide
 * gets a distinct layout name ("Layout 0", …) and a shared master so the depth
 * tools (get_presentation_info / read_slide_layout / read_slide_shapes /
 * modify_shape_text) are exercisable without an Office runtime.
 */
function fakePpt(initial: string[][] = []): PowerPointLike & { slides: FakeSlide[]; selectedIndex: number } {
	const slides: FakeSlide[] = initial.map((texts, si) => ({
		layoutName: `Layout ${si}`,
		masterName: "Office Theme",
		shapes: texts.map((t, i) => ({
			name: `Shape ${i + 1}`,
			type: "TextBox",
			left: i * 10,
			top: i * 20,
			width: 100,
			height: 50,
			textFrame: { hasText: t.length > 0, textRange: { text: t }, load() {} },
		})),
	}));
	const box = { slides, selectedIndex: 0 };

	const shapeCollection = (slide: FakeSlide) => ({
		get items() {
			return slide.shapes;
		},
		load(_p: string) {},
		addTextBox(text: string): FakeShape {
			const shape: FakeShape = {
				name: `Shape ${slide.shapes.length + 1}`,
				type: "TextBox",
				left: 0,
				top: 0,
				width: 100,
				height: 50,
				textFrame: { hasText: true, textRange: { text }, load() {} },
			};
			slide.shapes.push(shape);
			return shape;
		},
	});
	const slideView = (slide: FakeSlide) => ({
		shapes: shapeCollection(slide),
		layout: { name: slide.layoutName, load(_p: string) {} },
		slideMaster: { name: slide.masterName, load(_p: string) {} },
	});

	return {
		...box,
		run: async <T>(batch: (ctx: PptContextLike) => Promise<T>): Promise<T> => {
			const ctx = {
				presentation: {
					slides: {
						get items() {
							return slides.map(slideView);
						},
						load(_p: string) {},
						add() {
							slides.push({ shapes: [], layoutName: `Layout ${slides.length}`, masterName: "Office Theme" });
						},
						getItemAt(i: number) {
							return slideView(slides[i] as FakeSlide);
						},
					},
					getSelectedSlides() {
						return { getItemAt: (_i: number) => slideView(slides[box.selectedIndex] as FakeSlide) };
					},
				},
				sync: async () => {},
			};
			return batch(ctx as unknown as PptContextLike);
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

describe("powerpoint-tools", () => {
	const ALL_TOOL_NAMES = [
		"add_slide",
		"add_text_box",
		"get_presentation_info",
		"modify_shape_text",
		"read_slide_layout",
		"read_slide_shapes",
		"read_slides",
	];

	it("advertises the read/write + depth tools", () => {
		const names = createPowerPointHostTools(fakePpt())
			.map(t => t.definition.name)
			.sort();
		expect(names).toEqual(ALL_TOOL_NAMES);
	});

	it("registerPowerPointTools pushes every tool via set_host_tools", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt());
		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame?.tools.map(x => x.name).sort()).toEqual(ALL_TOOL_NAMES);
		d.dispose();
	});

	it("read_slides returns the text of each slide as a content[] result", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["Title A", "Body A"], ["Title B"]]));

		t.emit({ type: "host_tool_call", id: "p1", toolCallId: "t1", toolName: "read_slides", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.id).toBe("p1");
		expect(reply?.isError).toBeUndefined();
		const text = firstText(reply) ?? "";
		expect(text).toContain("Title A");
		expect(text).toContain("Body A");
		expect(text).toContain("Title B");
		d.dispose();
	});

	it("read_slides skips non-text shapes (Table/Image, real PascalCase types) instead of throwing", async () => {
		// A slide with a Table AND an Image (both throw on .textFrame in real Office)
		// plus a text shape. Shape.type is PascalCase, as real PowerPoint returns.
		const t = new MockTransport();
		let touchedNonTextFrame = false;
		const throwingFrame = () => {
			touchedNonTextFrame = true; // real API throws here — we must NOT touch it
			throw new Error("InvalidArgument");
		};
		const withTable: PowerPointLike = {
			run: async batch => {
				const tableShape = {
					type: "Table",
					get textFrame() {
						return throwingFrame();
					},
				};
				const imageShape = {
					type: "Image",
					get textFrame() {
						return throwingFrame();
					},
				};
				const textShape = {
					type: "TextBox",
					textFrame: { hasText: true, textRange: { text: "Real content" }, load() {} },
				};
				const slide = { shapes: { items: [tableShape, imageShape, textShape], load() {}, addTextBox() {} } };
				const ctx = {
					presentation: {
						slides: { items: [slide], load() {}, add() {}, getItemAt: () => slide },
						getSelectedSlides: () => ({ getItemAt: () => slide }),
					},
					sync: async () => {},
				};
				return batch(ctx as unknown as PptContextLike);
			},
		};
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, withTable);

		t.emit({ type: "host_tool_call", id: "pt", toolCallId: "tt", toolName: "read_slides", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		expect(firstText(reply)).toContain("Real content");
		expect(touchedNonTextFrame).toBe(false); // neither Table nor Image textFrame was accessed
		d.dispose();
	});

	it("add_text_box targets an explicit slideIndex when provided", async () => {
		const t = new MockTransport();
		const ppt = fakePpt([["s0"], ["s1"]]);
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, ppt);

		t.emit({
			type: "host_tool_call",
			id: "pi",
			toolCallId: "ti",
			toolName: "add_text_box",
			arguments: { text: "On slide 1", slideIndex: 1 },
		});
		await flush();

		expect(ppt.slides[1]?.shapes.some(s => s.textFrame?.textRange.text === "On slide 1")).toBe(true);
		expect(ppt.slides[0]?.shapes.some(s => s.textFrame?.textRange.text === "On slide 1")).toBe(false);
		d.dispose();
	});

	it("add_text_box adds a box to the selected slide", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const ppt = fakePpt([["existing"]]);
		registerPowerPointTools(d, ppt);

		t.emit({
			type: "host_tool_call",
			id: "p2",
			toolCallId: "t2",
			toolName: "add_text_box",
			arguments: { text: "Q3 Results" },
		});
		await flush();

		const texts = ppt.slides[0]?.shapes.map(s => s.textFrame?.textRange.text);
		expect(texts).toContain("Q3 Results");
		expect(callFrom(t)?.isError).toBeUndefined();
		d.dispose();
	});

	it("add_slide appends a slide with title + body text boxes", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		const ppt = fakePpt([["slide 0"]]);
		registerPowerPointTools(d, ppt);

		t.emit({
			type: "host_tool_call",
			id: "p3",
			toolCallId: "t3",
			toolName: "add_slide",
			arguments: { title: "F5 XC Benefits", body: ["Global reach", "Security"] },
		});
		await flush();

		expect(ppt.slides).toHaveLength(2);
		const newShapes = ppt.slides[1]?.shapes.map(s => s.textFrame?.textRange.text) ?? [];
		expect(newShapes).toContain("F5 XC Benefits");
		expect(newShapes.some(s => s?.includes("Global reach"))).toBe(true);
		expect(callFrom(t)?.isError).toBeUndefined();
		d.dispose();
	});

	it("add_text_box with no text answers isError (never hangs)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([[]]));

		t.emit({ type: "host_tool_call", id: "p4", toolCallId: "t4", toolName: "add_text_box", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("text");
		d.dispose();
	});

	it("surfaces the PowerPoint error code + debugInfo when PowerPoint.run fails", async () => {
		const t = new MockTransport();
		const failing: PowerPointLike = {
			run: async () => {
				throw { code: "GeneralException", message: "boom", debugInfo: { errorLocation: "Slides.load" } };
			},
		};
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, failing);

		t.emit({ type: "host_tool_call", id: "p5", toolCallId: "t5", toolName: "read_slides", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		const txt = firstText(reply) ?? "";
		expect(txt).toContain("read_slides");
		expect(txt).toContain("GeneralException");
		expect(txt).toContain("errorLocation");
		d.dispose();
	});

	it("get_presentation_info returns slide count + per-slide layout and shape counts", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["Title A", "Body A"], ["Title B"]]));

		t.emit({ type: "host_tool_call", id: "gi", toolCallId: "tgi", toolName: "get_presentation_info", arguments: {} });
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		const info = JSON.parse(firstText(reply) ?? "{}");
		expect(info.slideCount).toBe(2);
		expect(info.slides).toHaveLength(2);
		expect(info.slides[0]).toMatchObject({ index: 0, layoutName: "Layout 0", shapesCount: 2 });
		expect(info.slides[1]).toMatchObject({ index: 1, layoutName: "Layout 1", shapesCount: 1 });
		d.dispose();
	});

	it("read_slide_shapes returns each shape's name, type, text, and geometry", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["Hello"], ["Only slide 1", "Second box"]]));

		t.emit({
			type: "host_tool_call",
			id: "rs",
			toolCallId: "trs",
			toolName: "read_slide_shapes",
			arguments: { slideIndex: 1 },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		const shapes = JSON.parse(firstText(reply) ?? "[]");
		expect(shapes).toHaveLength(2);
		expect(shapes[0]).toMatchObject({ name: "Shape 1", type: "TextBox", text: "Only slide 1", left: 0, top: 0 });
		expect(shapes[1]).toMatchObject({ name: "Shape 2", text: "Second box", left: 10, top: 20 });
		d.dispose();
	});

	it("read_slide_shapes skips a table's textFrame but still lists the shape", async () => {
		const t = new MockTransport();
		let touchedTableTextFrame = false;
		const withTable: PowerPointLike = {
			run: async batch => {
				const tableShape = {
					name: "Table 1",
					type: "Table",
					left: 5,
					top: 6,
					width: 200,
					height: 100,
					get textFrame() {
						touchedTableTextFrame = true;
						throw new Error("InvalidArgument");
					},
				};
				const textShape = {
					name: "Body 1",
					type: "TextBox",
					left: 1,
					top: 2,
					width: 3,
					height: 4,
					textFrame: { hasText: true, textRange: { text: "Real content" }, load() {} },
				};
				const slide = {
					shapes: { items: [tableShape, textShape], load() {}, addTextBox() {} },
					layout: { name: "L", load() {} },
					slideMaster: { name: "M", load() {} },
				};
				const ctx = {
					presentation: {
						slides: { items: [slide], load() {}, add() {}, getItemAt: () => slide },
						getSelectedSlides: () => ({ getItemAt: () => slide }),
					},
					sync: async () => {},
				};
				return batch(ctx as unknown as PptContextLike);
			},
		};
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, withTable);

		t.emit({
			type: "host_tool_call",
			id: "rst",
			toolCallId: "trst",
			toolName: "read_slide_shapes",
			arguments: { slideIndex: 0 },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		const shapes = JSON.parse(firstText(reply) ?? "[]");
		expect(shapes).toHaveLength(2);
		expect(shapes[0]).toMatchObject({ name: "Table 1", type: "Table" });
		expect(shapes[0].text).toBeUndefined();
		expect(shapes[1]).toMatchObject({ name: "Body 1", text: "Real content" });
		expect(touchedTableTextFrame).toBe(false);
		d.dispose();
	});

	it("read_slide_shapes requires a numeric slideIndex", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["x"]]));

		t.emit({
			type: "host_tool_call",
			id: "rsi",
			toolCallId: "trsi",
			toolName: "read_slide_shapes",
			arguments: {},
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("slideindex");
		d.dispose();
	});

	it("read_slide_layout returns the layout and master names for a slide", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["a"], ["b"]]));

		t.emit({
			type: "host_tool_call",
			id: "rl",
			toolCallId: "trl",
			toolName: "read_slide_layout",
			arguments: { slideIndex: 1 },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		const layout = JSON.parse(firstText(reply) ?? "{}");
		expect(layout).toMatchObject({ layoutName: "Layout 1", masterName: "Office Theme" });
		d.dispose();
	});

	it("modify_shape_text rewrites the text of a named shape", async () => {
		const t = new MockTransport();
		const ppt = fakePpt([["Old title"], ["untouched"]]);
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, ppt);

		t.emit({
			type: "host_tool_call",
			id: "ms",
			toolCallId: "tms",
			toolName: "modify_shape_text",
			arguments: { slideIndex: 0, shapeName: "Shape 1", text: "New title" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBeUndefined();
		expect(ppt.slides[0]?.shapes[0]?.textFrame?.textRange.text).toBe("New title");
		expect(ppt.slides[1]?.shapes[0]?.textFrame?.textRange.text).toBe("untouched");
		d.dispose();
	});

	it("modify_shape_text errors when no shape matches the name", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["Only shape"]]));

		t.emit({
			type: "host_tool_call",
			id: "mm",
			toolCallId: "tmm",
			toolName: "modify_shape_text",
			arguments: { slideIndex: 0, shapeName: "Nope", text: "x" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)).toContain("Nope");
		d.dispose();
	});

	it("modify_shape_text gives a friendly error for a non-text shape (Table) — no raw InvalidArgument", async () => {
		const t = new MockTransport();
		let touchedTableTextFrame = false;
		const withTable: PowerPointLike = {
			run: async batch => {
				const tableShape = {
					name: "Table 1",
					type: "Table",
					get textFrame() {
						touchedTableTextFrame = true;
						throw new Error("InvalidArgument");
					},
				};
				const slide = { shapes: { items: [tableShape], load() {}, addTextBox() {} } };
				const ctx = {
					presentation: {
						slides: { items: [slide], load() {}, add() {}, getItemAt: () => slide },
						getSelectedSlides: () => ({ getItemAt: () => slide }),
					},
					sync: async () => {},
				};
				return batch(ctx as unknown as PptContextLike);
			},
		};
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, withTable);

		t.emit({
			type: "host_tool_call",
			id: "mnt",
			toolCallId: "tmnt",
			toolName: "modify_shape_text",
			arguments: { slideIndex: 0, shapeName: "Table 1", text: "x" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)).toContain("can't hold text");
		expect(touchedTableTextFrame).toBe(false); // gated on type; never touched the throwing frame
		d.dispose();
	});

	it("modify_shape_text requires slideIndex, shapeName, and text", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		registerPowerPointTools(d, fakePpt([["Shape here"]]));

		t.emit({
			type: "host_tool_call",
			id: "mv",
			toolCallId: "tmv",
			toolName: "modify_shape_text",
			arguments: { slideIndex: 0, shapeName: "Shape 1" },
		});
		await flush();

		const reply = callFrom(t);
		expect(reply?.isError).toBe(true);
		expect(firstText(reply)?.toLowerCase()).toContain("text");
		d.dispose();
	});

	it("wirePowerPointHostTools advertises after connect and services a host_tool_call", async () => {
		const t = new MockTransport();
		const { onConnected, dispatcher } = wirePowerPointHostTools(t, fakePpt([["hi"]]));
		expect(t.sent.some(m => m.type === "set_host_tools")).toBe(false);
		onConnected();
		expect(t.sent.some(m => m.type === "set_host_tools")).toBe(true);

		t.emit({ type: "host_tool_call", id: "p6", toolCallId: "t6", toolName: "read_slides", arguments: {} });
		await flush();
		expect(firstText(callFrom(t))).toContain("hi");
		dispatcher.dispose();
	});
});
