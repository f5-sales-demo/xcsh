export declare function normalizeCodeLanguage(info?: string): string;
/** Offsets are UTF-16 indices. A formatted YAML document maps as a whole document. */
export interface CodeMapping {
	sourceStart: number;
	sourceEnd: number;
	displayStart: number;
	displayEnd: number;
}
export interface CodePresentation {
	source: string;
	display: string;
	language: string;
	formatted: boolean;
	mapping: CodeMapping[];
}
export declare function isCodeBlockComplete(raw: string, indented?: boolean): boolean;
export declare function presentCode(source: string, info?: string, complete?: boolean): CodePresentation;
export interface CodeSegment {
	start: number;
	end: number;
	continuation: boolean;
}
/** HTTP examples may omit a protocol version and use documented path placeholders. */
export declare function mapHttpCode(
	source: string,
	render: (text: string, category?: "keyword" | "string" | "number" | "variable" | "punctuation") => string,
	body: (text: string, language: string) => string,
): string;
/** Prefer token boundaries outside quoted literals. A hard wrap is explicitly visual. */
export declare function wrapCodeLine(line: string, width: number, measure?: (text: string) => number): CodeSegment[];
