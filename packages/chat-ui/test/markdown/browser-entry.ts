import { Marked } from "marked";
import { renderMarkdown } from "../../src/markdown/render";
import { cssVars } from "../../src/theme/tokens";

Object.assign(globalThis, { cssVars, renderMarkdown, lexMarkdown: (source: string) => new Marked().lexer(source) });
