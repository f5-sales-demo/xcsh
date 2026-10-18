/** Runs in Chromium, compiled separately from the CLI's Bun-only type environment. */
import { installCodePanels } from "../../src/markdown/code-presentation.generated.js";
import { renderMarkdown } from "../../src/markdown/render";
import { cssVars } from "../../src/theme/tokens";

function mountCodeCatalog(source: string): void {
	const style = document.createElement("style");
	style.textContent = cssVars();
	document.head.append(style);
	const root = document.querySelector<HTMLElement>(".markdown-root")!;
	root.innerHTML = renderMarkdown(source);
	installCodePanels(root);
}

function contrast(foreground: string, background: string): number {
	const luminance = (rgb: string) => {
		const values = (rgb.match(/[\d.]+/g) ?? [])
			.slice(0, 3)
			.map(n => Number(n) / 255)
			.map(n => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
		return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
	};
	const a = luminance(foreground);
	const b = luminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function probeCodePanels() {
	return [...document.querySelectorAll<HTMLElement>("pre code[data-code-source]")].map(code => {
		const pre = code.parentElement!;
		const range = document.createRange();
		range.selectNodeContents(code);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		const clipboard = new DataTransfer();
		code.dispatchEvent(new ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true, cancelable: true }));
		const styles = getComputedStyle(pre);
		let line = 0;
		let indentPreserved = true;
		const displayLines = JSON.parse(code.dataset.codeDisplay!).replace(/\t/g, "    ").split("\n");
		const basePadding = parseFloat(getComputedStyle(code.querySelector(".md-code-row")!).paddingLeft);
		for (const node of code.childNodes) {
			if (node.nodeType === Node.TEXT_NODE && node.textContent === "\n") line++;
			if (
				node instanceof HTMLElement &&
				node.classList.contains("md-code-continuation") &&
				/^ +/.test(displayLines[line])
			)
				indentPreserved &&= parseFloat(getComputedStyle(node).paddingLeft) > basePadding + 1;
		}

		const colors = [...code.querySelectorAll<HTMLElement>('span[class*="hljs-"]')].map(span => ({
			category: span.className,
			expectedColor: (() => {
				const category = [...span.classList].find(name => name.startsWith("hljs-"))?.slice(5) ?? "";
				const keys: Record<string, string> = {
					attr: "Variable",
					variable: "Variable",
					property: "Variable",
					params: "Variable",
					literal: "Keyword",
					keyword: "Keyword",
					control: "Control",
					comment: "Comment",
					number: "Number",
					string: "String",
					operator: "Operator",
					punctuation: "Punctuation",
					title: span.classList.contains("class_") ? "Type" : "Function",
					function: "Function",
					type: "Type",
					built_in: "Type",
				};
				if (!keys[category]) return undefined;
				const probe = document.createElement("span");
				probe.style.color = `var(--syntax${keys[category]},var(--syntax-${keys[category].toLowerCase()}))`;
				pre.append(probe);
				const expected = getComputedStyle(probe).color;
				probe.remove();
				return expected;
			})(),
			color: getComputedStyle(span).color,
			contrast: contrast(getComputedStyle(span).color, styles.backgroundColor),
		}));
		return {
			source: JSON.parse(code.dataset.codeSource!),
			copied: clipboard.getData("text/plain"),
			text: code.textContent,
			categories: [
				...new Set(
					[...code.querySelectorAll("span")]
						.flatMap(span => [...span.classList])
						.filter(c => c.startsWith("hljs-")),
				),
			],
			overflow: pre.scrollWidth > pre.clientWidth + 1,
			continuations: code.querySelectorAll(".md-code-continuation").length,
			border: styles.borderLeftWidth,
			indentPreserved,
			colors,
		};
	});
}

Object.assign(globalThis, { mountCodeCatalog, probeCodePanels });
