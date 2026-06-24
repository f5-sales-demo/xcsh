import { describe, expect, it } from "bun:test";
import {
	detectDiagramType,
	MERMAID_MAX_LINES,
	mermaidSourceExceedsLimit,
	pickColorMode,
	tintMermaidNodes,
} from "../src/mermaid-color";

const strip = (s: string): string => Bun.stripANSI(s);

// A few sentinel ANSI foreground escapes used in tests.
const CYAN = "\x1b[38;2;0;180;255m";
const GREEN = "\x1b[38;2;0;255;136m";
const EDGE = "\x1b[38;2;150;150;150m";

describe("pickColorMode", () => {
	it("returns none when noColor is set, regardless of trueColor", () => {
		expect(pickColorMode({ noColor: true, trueColor: true })).toBe("none");
		expect(pickColorMode({ noColor: true, trueColor: false })).toBe("none");
	});

	it("returns truecolor when the terminal supports it", () => {
		expect(pickColorMode({ noColor: false, trueColor: true })).toBe("truecolor");
	});

	it("falls back to ansi256 when truecolor is unavailable", () => {
		expect(pickColorMode({ noColor: false, trueColor: false })).toBe("ansi256");
	});
});

describe("mermaidSourceExceedsLimit", () => {
	it("passes normal diagrams", () => {
		expect(mermaidSourceExceedsLimit("graph LR\nA --> B --> C")).toBe(false);
	});

	it("flags graphs with too many lines (pathfinder OOM guard)", () => {
		const huge = `graph TD\n${Array.from({ length: MERMAID_MAX_LINES + 50 }, (_, i) => `N${i}-->N${i + 1}`).join("\n")}`;
		expect(mermaidSourceExceedsLimit(huge)).toBe(true);
	});

	it("flags very long sources by character count", () => {
		expect(mermaidSourceExceedsLimit(`graph LR\nA-->B %% ${"x".repeat(20001)}`)).toBe(true);
	});
});

describe("detectDiagramType", () => {
	it("detects flowchart from graph and flowchart headers", () => {
		expect(detectDiagramType("graph LR\n A --> B")).toBe("flowchart");
		expect(detectDiagramType("flowchart TD\n A --> B")).toBe("flowchart");
	});

	it("detects sequence, class, er, state, and xychart", () => {
		expect(detectDiagramType("sequenceDiagram\n A->>B: hi")).toBe("sequence");
		expect(detectDiagramType("classDiagram\n class A")).toBe("class");
		expect(detectDiagramType("erDiagram\n A ||--o{ B : has")).toBe("er");
		expect(detectDiagramType("stateDiagram-v2\n [*] --> A")).toBe("state");
		expect(detectDiagramType("xychart-beta\n bar [1,2,3]")).toBe("xychart");
	});

	it("skips frontmatter and %%{init}%% directives before the header", () => {
		const src = "---\ntitle: X\n---\n%%{init: {'theme':'dark'}}%%\ngraph TD\n A-->B";
		expect(detectDiagramType(src)).toBe("flowchart");
	});

	it("returns unknown for unrecognized input", () => {
		expect(detectDiagramType("nonsense here")).toBe("unknown");
	});
});

// Build a colored line from (text, fg) segments.
function colored(segments: Array<[string, string]>): string {
	return segments.map(([text, fg]) => (fg ? `${fg}${text}\x1b[0m` : text)).join("");
}

describe("tintMermaidNodes", () => {
	const box = ["┌───┐", "│ A │", "└───┘"];

	it("tints a single node box (border + label) with the first accent", () => {
		const out = tintMermaidNodes(box, [CYAN]);
		// Geometry is preserved exactly.
		expect(out.map(strip)).toEqual(box);
		// The accent now appears in the output.
		expect(out.join("\n")).toContain(CYAN);
		// The label 'A' is tinted with the accent.
		expect(out[1]).toContain(`${CYAN}`);
	});

	it("gives two separate boxes two distinct accents", () => {
		const twoBoxes = ["┌───┐   ┌───┐", "│ A │   │ B │", "└───┘   └───┘"];
		const out = tintMermaidNodes(twoBoxes, [CYAN, GREEN]).join("\n");
		expect(out).toContain(CYAN);
		expect(out).toContain(GREEN);
	});

	it("leaves edge/arrow characters outside boxes at their original color", () => {
		// A box on the left, then an edge segment colored EDGE outside it.
		const lines = [
			"┌───┐     ",
			colored([
				["│ A │", ""],
				["──► ", EDGE],
			]),
			"└───┘     ",
		];
		const out = tintMermaidNodes(lines, [CYAN]).join("\n");
		// Edge color survives; accent is also present (box was tinted).
		expect(out).toContain(EDGE);
		expect(out).toContain(CYAN);
	});

	it("detects and tints ASCII-mode boxes", () => {
		const asciiBox = ["+---+", "| A |", "+---+"];
		const out = tintMermaidNodes(asciiBox, [CYAN]);
		expect(out.map(strip)).toEqual(asciiBox);
		expect(out.join("\n")).toContain(CYAN);
	});

	it("tints every label row of a multi-line box", () => {
		const tall = ["┌─────┐", "│ Top │", "│ Bot │", "└─────┘"];
		const out = tintMermaidNodes(tall, [CYAN]);
		expect(out[1]).toContain(CYAN);
		expect(out[2]).toContain(CYAN);
	});

	it("tints a box whose border has an edge-attachment junction", () => {
		// A right-side tee (├) where an edge leaves the box must not defeat detection.
		const lines = ["┌───┐", "│ A ├──►", "└───┘"];
		const out = tintMermaidNodes(lines, [CYAN]);
		expect(out[0]).toContain(CYAN);
		expect(out[1]).toContain(CYAN);
	});

	it("fail-safe: returns input unchanged when no boxes are detected", () => {
		const garbage = ["just some text", "A --> B no boxes", "~~~~~~~~"];
		expect(tintMermaidNodes(garbage, [CYAN])).toEqual(garbage);
	});

	it("fail-safe: returns input unchanged when no accents are provided", () => {
		expect(tintMermaidNodes(box, [])).toEqual(box);
	});
});
