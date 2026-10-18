import {
	isCodeBlockComplete,
	normalizeCodeLanguage,
	presentCode,
	wrapCodeLine,
} from "./code-presentation.types.generated";

export { isCodeBlockComplete, normalizeCodeLanguage, presentCode, wrapCodeLine };
export declare const CODE_PANEL_CSS: string;
export declare function highlightCodeHtml(code: string, language: string): string;
export declare function renderCodePanel(source: string, info?: string, complete?: boolean): string;
/** Observe actual font/width; rewrap on resize and retain source-only clipboard data. */
export declare function installCodePanels(root: HTMLElement): () => void;
