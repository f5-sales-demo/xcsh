import { beforeEach, describe, expect, it } from "bun:test";
import {
	clearMermaidCache,
	getMermaidAscii,
	mermaidThemeSignature,
	prerenderMermaid,
	renderMermaidThemed,
} from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-cache";
import { getThemeByName } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

const SRC = "graph LR\n A[Login] --> B{Auth}\n B --> C[Home]";
const ESC = "\x1b[";
const sgr = (s: string): Set<string> => new Set(s.match(/\x1b\[[0-9;]*m/g) ?? []);

beforeEach(() => clearMermaidCache());

describe("renderMermaidThemed", () => {
	it("produces colorized output with several distinct SGR colors", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const out = renderMermaidThemed(SRC, theme!, { colorMode: "truecolor" });
		expect(out).not.toBeNull();
		expect(out!).toContain(ESC);
		expect(sgr(out!).size).toBeGreaterThanOrEqual(3);
	});

	it("emits no escapes under colorMode none", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const out = renderMermaidThemed(SRC, theme!, { colorMode: "none" });
		expect(out).not.toBeNull();
		expect(out!).not.toContain(ESC);
	});
});

describe("theme-aware cache", () => {
	it("caches separately per theme and retains ANSI (does not strip)", async () => {
		const dark = (await getThemeByName("xcsh-dark"))!;
		const light = (await getThemeByName("xcsh-light"))!;
		const md = `\`\`\`mermaid\n${SRC}\n\`\`\``;

		prerenderMermaid(md, dark);
		prerenderMermaid(md, light);

		const hash = Bun.hash(SRC);
		const d = getMermaidAscii(hash, mermaidThemeSignature(dark));
		const l = getMermaidAscii(hash, mermaidThemeSignature(light));

		expect(d).not.toBeNull();
		expect(l).not.toBeNull();
		expect(d!).toContain(ESC); // colored, not stripped
		expect(d).not.toBe(l); // different theme → different render
	});

	it("returns null for a signature that was never rendered", async () => {
		const dark = (await getThemeByName("xcsh-dark"))!;
		expect(getMermaidAscii(Bun.hash(SRC), mermaidThemeSignature(dark))).toBeNull();
	});
});
