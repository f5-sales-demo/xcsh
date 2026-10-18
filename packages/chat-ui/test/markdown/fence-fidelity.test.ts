import { expect, test } from "bun:test";
import { renderMarkdown } from "../../src/markdown/render";
import { softCloseForStreaming } from "../../src/markdown/streaming";

for (const [name, source] of [
	["long backtick fence", "````md\n```\ninside\n```\n````\n\nAfter"],
	["tilde fence", "~~~bash\n```\ninside\n~~~\n\nAfter"],
	["quote fence", "> ````md\n> ```\n> inside\n> ````\n\nAfter"],
	["list fence", "- Example\n\n  ````md\n  ```\n  inside\n  ````\n\nAfter"],
	["inline backticks", "```literal``` and normal prose"],
	["indented literal", "    ```\n    inside\n    ```"],
] as const) {
	test(`completed ${name} is unchanged`, () => {
		expect(softCloseForStreaming(source)).toBe(source);
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown(source);
		expect(el.querySelectorAll("pre").length).toBe(name === "inline backticks" ? 0 : 1);
	});
}
test("open fences close using their own delimiter and length", () => {
	expect(softCloseForStreaming("~~~~bash\nx")).toBe("~~~~bash\nx\n~~~~");
	expect(softCloseForStreaming("````md\n```\nx")).toBe("````md\n```\nx\n````");
	expect(softCloseForStreaming("> ```bash\n> x")).toBe("> ```bash\n> x\n> ```");
});
test("partial table text inside code is never held", () => {
	const source = "~~~text\n| a | b |\n|-";
	expect(softCloseForStreaming(source)).toBe(source + "\n~~~");
	expect(renderMarkdown(source)).toContain("| a | b |");
});

test("a completed table delimiter honors escaped header pipes", () => {
	const source = "| A\\|B | C |\n| --- | --- |";
	expect(softCloseForStreaming(source)).toBe(source);
	const el = document.createElement("div");
	el.innerHTML = renderMarkdown(source);
	expect(el.querySelector("th")?.textContent).toBe("A|B");
});
