import { Marked } from "marked";
import { installCodePanels } from "../../src/markdown/code-presentation.generated.min.js";
import { renderMarkdown } from "../../src/markdown/render";
import { cssVars } from "../../src/theme/tokens";

Object.assign(globalThis, {
	cssVars,
	renderMarkdown,
	installCodePanels,
	lexMarkdown: (source: string) => new Marked().lexer(source),
});
