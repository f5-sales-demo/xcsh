// GENERATED — do not edit by hand.
// Source of truth: packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json
// Regenerate: `bun scripts/gen-tokens.ts` (CI runs `--check` and fails on drift).
export const COLORS = {
	f5Red: "#ca260a",
	f5DarkRed: "#8a1a07",
	charcoal: "#151820",
	deepCharcoal: "#0f1216",
	brightWhite: "#e8ecf4",
	coolGray: "#9ca3b0",
	warmAmber: "#ffb347",
	signalGreen: "#00ff88",
	alertRed: "#ff4757",
	subtleGray: "#2a3038",
	chromeAccent: "#00b4ff",
	dim: "#6b7280",
	mdCodeBlock: "#9CDCFE",
	mdCodeBlockBorder: "#a0a8b4",
	syntaxComment: "#6A9955",
	syntaxKeyword: "#569CD6",
	syntaxControl: "#C586C0",
	syntaxFunction: "#DCDCAA",
	syntaxVariable: "#9CDCFE",
	syntaxString: "#CE9178",
	syntaxNumber: "#B5CEA8",
	syntaxType: "#4EC9B0",
	syntaxOperator: "#D4D4D4",
	syntaxPunctuation: "#D4D4D4",
} as const;

export type ColorName = keyof typeof COLORS;

export const LIGHT_CODE_COLORS = {
	mdCodeBlock: "#202020",
	mdCodeBlockBorder: "#404850",
	syntaxComment: "#008000",
	syntaxKeyword: "#ca260a",
	syntaxControl: "#7B267B",
	syntaxFunction: "#795E26",
	syntaxVariable: "#001080",
	syntaxString: "#A31515",
	syntaxNumber: "#08774E",
	syntaxType: "#ca260a",
	syntaxOperator: "#8a1a07",
	syntaxPunctuation: "#1a1a1a",
	codeBg: "#f0f0f8",
} as const;
