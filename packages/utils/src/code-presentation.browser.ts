/** Browser adapter bundled by repository tooling for exports and vendored clients. */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import {
	isCodeBlockComplete,
	mapHttpCode,
	normalizeCodeLanguage,
	presentCode,
	wrapCodeLine,
} from "./code-presentation";

export { isCodeBlockComplete, normalizeCodeLanguage, presentCode, wrapCodeLine };

export const CODE_PANEL_CSS: string = `
.markdown-root .md-code-panel { background:var(--code-bg,var(--toolPendingBg)); border:0; border-left:2px solid var(--mdCodeBlockBorder,var(--md-code-block-border,var(--subtle-gray))); border-radius:3px; padding:12px; overflow:hidden; }
.markdown-root .md-code-panel code { display:block; background:none; color:var(--mdCodeBlock,var(--md-code-block,var(--bright-white))); padding:0; white-space:pre-wrap; overflow-wrap:anywhere; tab-size:4; }
.markdown-root .md-code-panel code:has(.md-code-row) { white-space:normal; }
.markdown-root .md-code-row { display:block; position:relative; padding-left:3ch; white-space:pre; min-height:1lh; }
.markdown-root .md-code-continuation::before { content:"↪"; position:absolute; left:0; color:var(--mdCodeBlockBorder,var(--md-code-block-border,var(--cool-gray))); user-select:none; }
.markdown-root .hljs-comment,.markdown-root .hljs-quote { color:var(--syntaxComment,var(--syntax-comment)); }
.markdown-root .hljs-keyword,.markdown-root .hljs-literal { color:var(--syntaxKeyword,var(--syntax-keyword)); }
.markdown-root .hljs-control { color:var(--syntaxControl,var(--syntax-control)); }
.markdown-root .hljs-number { color:var(--syntaxNumber,var(--syntax-number)); }
.markdown-root .hljs-string { color:var(--syntaxString,var(--syntax-string)); }
.markdown-root .hljs-title,.markdown-root .hljs-function { color:var(--syntaxFunction,var(--syntax-function)); }
.markdown-root .hljs-type,.markdown-root .hljs-built_in,.markdown-root .hljs-title.class_ { color:var(--syntaxType,var(--syntax-type)); }
.markdown-root .hljs-attr,.markdown-root .hljs-variable,.markdown-root .hljs-property,.markdown-root .hljs-params { color:var(--syntaxVariable,var(--syntax-variable)); }
.markdown-root .hljs-operator { color:var(--syntaxOperator,var(--syntax-operator)); }
.markdown-root .hljs-punctuation { color:var(--syntaxPunctuation,var(--syntax-punctuation)); }
`;

for (const [name, grammar] of Object.entries({
	css,
	diff,

	javascript,
	json,
	markdown,
	python,

	typescript,
	xml,
	yaml,
}))
	hljs.registerLanguage(name, grammar);
hljs.registerLanguage("bash", api => {
	const definition = bash(api);
	definition.contains?.unshift({
		scope: "string",
		begin: /<<(-?)[ \t]*(['"])([A-Za-z_][\w]*)\2[ \t]*\n/,
		end: /^\t*[A-Za-z_][\w]*$/,
		"on:begin": (
			match: RegExpMatchArray,
			response: { data: { delimiter?: string; stripTabs?: boolean }; ignoreMatch(): void },
		) => {
			response.data.delimiter = match[3];
			response.data.stripTabs = match[1] === "-";
		},
		"on:end": (
			match: RegExpMatchArray,
			response: { data: { delimiter?: string; stripTabs?: boolean }; ignoreMatch(): void },
		) => {
			const delimiter = response.data.stripTabs ? match[0].replace(/^\t+/, "") : match[0];
			if (delimiter !== response.data.delimiter) response.ignoreMatch();
		},
	});
	return definition;
});
hljs.registerLanguage("hcl", api => {
	const interpolation = {
		scope: "subst",
		begin: /\$\{|%\{/,
		end: /\}/,
		contains: [
			api.QUOTE_STRING_MODE,
			api.C_NUMBER_MODE,
			{ scope: "literal", match: /\b(?:true|false|null)\b/ },
			{ scope: "control", match: /\b(?:for|in|if|else|endif|endfor)\b/ },
			{ scope: "title.function", match: /[A-Za-z_][\w-]*(?=\s*\()/ },
			{ scope: "variable", match: /[A-Za-z_][\w.-]*/ },
			{ scope: "operator", match: /[+*/=!<>?:-]+/ },
		],
	};
	return {
		name: "HCL",
		aliases: ["tf", "tfvars", "terraform"],
		keywords: {
			keyword: "resource data variable output locals provider terraform module dynamic",
			literal: "true false null",
			control: "for in if else endif endfor",
		},
		contains: [
			api.HASH_COMMENT_MODE,
			api.C_LINE_COMMENT_MODE,
			api.C_BLOCK_COMMENT_MODE,
			{
				scope: "string",
				begin: /<<-?([A-Za-z_][\w]*)\n/,
				end: /^\s*[A-Za-z_][\w]*\s*$/,
				contains: [interpolation],
				"on:begin": (match: RegExpMatchArray, response: { data: { delimiter?: string }; ignoreMatch(): void }) => {
					response.data.delimiter = match[1];
				},
				"on:end": (match: RegExpMatchArray, response: { data: { delimiter?: string }; ignoreMatch(): void }) => {
					if (match[0].trim() !== response.data.delimiter) response.ignoreMatch();
				},
			},
			{ scope: "string", begin: /"/, end: /"/, contains: [api.BACKSLASH_ESCAPE, interpolation] },
			{ scope: "attr", match: /[A-Za-z_][\w-]*(?=\s*=)/ },
			{ scope: "title.function", match: /[A-Za-z_][\w-]*(?=\s*\()/ },
			api.C_NUMBER_MODE,
			{ scope: "operator", match: /[+*/=!<>?:-]+/ },
			{ scope: "punctuation", match: /[{}[\](),.]/ },
		],
	};
});

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function highlightCodeHtml(code: string, language: string): string {
	const lang = normalizeCodeLanguage(language);
	if (lang === "http")
		return mapHttpCode(
			code,
			(text, category) =>
				category
					? `<span class="hljs-${category === "variable" ? "attr" : category}">${escapeHtml(text)}</span>`
					: escapeHtml(text),
			highlightCodeHtml,
		);
	if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
	try {
		return hljs
			.highlight(code, { language: lang, ignoreIllegals: true })
			.value.replace(
				/<span class="hljs-keyword">(if|else|elif|for|while|return|break|continue|import|from|then|fi|do|done|case|esac|try|except|finally|raise|yield|with)<\/span>/g,
				'<span class="hljs-control">$1</span>',
			);
	} catch {
		return escapeHtml(code);
	}
}

function encodeMetadata(source: string): string {
	return JSON.stringify(source).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function decodeMetadata(source: string | undefined): string {
	try {
		const value: unknown = JSON.parse(source ?? '""');
		return typeof value === "string" ? value : "";
	} catch {
		return "";
	}
}

export function renderCodePanel(source: string, info?: string, complete = true): string {
	const view = presentCode(source, info, complete);
	return `<pre class="md-code-panel"><code class="hljs${view.language ? ` language-${view.language}` : ""}" data-code-source="${escapeHtml(encodeMetadata(source))}" data-code-display="${escapeHtml(encodeMetadata(view.display))}">${highlightCodeHtml(view.display, view.language)}</code></pre>`;
}

/** Observe actual font/width; rewrap on resize and retain source-only clipboard data. */
export function installCodePanels(root: HTMLElement): () => void {
	const win = root.ownerDocument.defaultView;
	if (!win) return () => {};
	const canvas = root.ownerDocument.createElement("canvas");
	let disposed = false;
	const layout = () => {
		if (disposed) return;
		const context = canvas.getContext("2d");
		if (!context) return;
		for (const code of root.querySelectorAll<HTMLElement>("pre code[data-code-source]")) {
			if (code.clientWidth < 4) continue;
			const style = win.getComputedStyle(code);
			context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
			const measure = (text: string) => context.measureText(text).width;
			const width = Math.max(1, code.clientWidth - measure("   "));
			const language = [...code.classList].find(c => c.startsWith("language-"))?.slice(9) ?? "";
			const display = decodeMetadata(code.dataset.codeDisplay ?? code.dataset.codeSource);
			// Highlight once, then slice the token DOM by UTF-16 offsets. This retains
			// multiline grammar context and keeps visual gutters out of selectable text.
			const fragment = root.ownerDocument.createElement("div");
			fragment.innerHTML = highlightCodeHtml(display.replace(/\t/g, "    "), language);
			const walker = root.ownerDocument.createTreeWalker(fragment, win.NodeFilter.SHOW_TEXT);
			const leaves: { text: string; start: number; end: number; classes: string }[] = [];
			let offset = 0;
			let node = walker.nextNode();
			while (node) {
				const text = node.textContent ?? "";
				let element = node.parentElement;
				const classes: string[] = [];
				while (element && element !== fragment) {
					if ([...element.classList].some(name => name.startsWith("hljs-"))) {
						classes.push(...element.classList);
						break;
					}
					element = element.parentElement;
				}
				leaves.push({ text, start: offset, end: offset + text.length, classes: classes.join(" ") });
				offset += text.length;
				node = walker.nextNode();
			}
			const lines = display.replace(/\t/g, "    ").split("\n");
			let start = 0;
			let html = "";
			for (const [index, line] of lines.entries()) {
				const leading = /^ */.exec(line)?.[0].length ?? 0;
				const indentWidth = measure(line.slice(0, leading));
				const indent = indentWidth < width / 2 ? leading : 0;
				const indentPixels = indent ? indentWidth : 0;
				for (const part of wrapCodeLine(line.slice(indent), width - indentPixels, measure)) {
					const a = start + (part.continuation ? indent + part.start : 0);
					const b = start + indent + part.end;
					html += `<span class="md-code-row${part.continuation ? " md-code-continuation" : ""}" style="padding-left:calc(3ch + ${part.continuation ? indentPixels : 0}px)">`;
					for (const leaf of leaves) {
						if (leaf.end <= a || leaf.start >= b) continue;
						html += `<span class="${leaf.classes}">${escapeHtml(leaf.text.slice(Math.max(0, a - leaf.start), Math.min(leaf.text.length, b - leaf.start)))}</span>`;
					}
					html += "</span>";
				}
				if (index < lines.length - 1) html += "\n";
				start += line.length + 1;
			}
			code.innerHTML = html;
		}
	};
	const copy = (event: ClipboardEvent) => {
		const selection = win.getSelection();
		const selectedCode = (node: Node | null | undefined) =>
			(node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest<HTMLElement>(
				"code[data-code-source]",
			);
		const anchor = selectedCode(selection?.anchorNode);
		const focus = selectedCode(selection?.focusNode);
		if (
			anchor &&
			anchor === focus &&
			root.contains(anchor) &&
			selection &&
			!selection.isCollapsed &&
			event.clipboardData
		) {
			event.clipboardData.setData("text/plain", decodeMetadata(anchor.dataset.codeSource));
			event.preventDefault();
		}
	};
	root.addEventListener("copy", copy);
	const observer = typeof ResizeObserver === "function" ? new ResizeObserver(layout) : undefined;
	observer?.observe(root);
	win.addEventListener("resize", layout);
	const mutation = typeof MutationObserver === "function" ? new MutationObserver(layout) : undefined;
	mutation?.observe(root.ownerDocument.documentElement, {
		attributes: true,
		attributeFilter: ["class", "style", "data-theme"],
	});
	void root.ownerDocument.fonts?.ready.then(layout);
	layout();
	return () => {
		disposed = true;
		observer?.disconnect();
		mutation?.disconnect();
		win.removeEventListener("resize", layout);
		root.removeEventListener("copy", copy);
	};
}
