/**
 * The one canonical F5 logo for every surface. Two visual variants:
 *
 *  - `variant="ascii"` — the terminal ASCII-art F5 mark from the VS Code webview
 *    welcome screen, tokenized to the palette (`.ascii-red` → var(--f5-red),
 *    `.ascii-white` → var(--bright-white), `.ascii-shadow` → var(--f5-dark-red)).
 *  - `variant="mark"` — the crisp 128px PNG mark (base64 data URI from the Chrome
 *    extension), for headers/compact spots where the ASCII block is too big.
 *
 * Styling lives in panel.css.ts (`.ascii-*` / `.f5-mark`).
 */
import { F5_MARK_DATA_URI } from "./f5-mark.data";

const F5_ASCII_LINES = [
	"                   ________",
	"              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
	"         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
	"      (▒▒▓▓▓▓██████████▓▓▓▓█████████████)",
	"    (▒▓▓▓▓██████▒▒▒▒▒███▓▓██████████████▒)",
	"   (▒▓▓▓▓██████▒▓▓▓▓▓▒▒▒▓██▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
	"  (▒▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓██▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒)",
	" (▒▓▓███████████████▓▓▓▓█████████████▓▓▓▓▓▓▒)",
	"(▒▓▓▓▒▒▒███████▒▒▒▒▒▓▓▓████████████████▓▓▓▓▓▒)",
	"|▒▓▓▓▓▓▓▒██████▓▓▓▓▓▓▓████████████████████▓▓▒|",
	"|▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒██████████▓▒|",
	"(▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒████████▒▒)",
	" (▒▓▓▓▓▓▓██████▓▓▓▓▓▓▓███▓▓▓▓▓▓▓▓▓▓▒▒▒████▒▒)",
	"  (▒▓▓▓▓▓██████▓▓▓▓▓▓█████▓▓▓▓▓▓▓▓▓▓▓▓███▒▒)",
	"   (▒▒██████████▓▓▓▓▓▒██████▓▓▓▓▓▓▓▓███▒▒▒)",
	"    (▒▒▒▒▒██████████▓▓▒▒█████████████▒▒▓▒)",
	"      (▒▓▓▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
	"         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
	"              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
];

/** Map a glyph to its display char + palette class (matches the VS Code seed). */
function colorChar(char: string): { text: string; className: string } {
	if (char === "▓") return { text: "█", className: "ascii-red" };
	if (char === "█") return { text: "█", className: "ascii-white" };
	if (char === "▒") return { text: "▒", className: "ascii-shadow" };
	if ("()|_".includes(char)) return { text: char, className: "ascii-red" };
	return { text: char, className: "" };
}

export interface F5LogoProps {
	variant?: "ascii" | "mark";
	/** For `variant="mark"`: pixel size of the square PNG (default 48). */
	size?: number;
	className?: string;
}

export function F5Logo({ variant = "ascii", size = 48, className }: F5LogoProps) {
	if (variant === "mark") {
		return (
			<img
				className={`f5-mark${className ? ` ${className}` : ""}`}
				src={F5_MARK_DATA_URI}
				width={size}
				height={size}
				alt="F5 logo"
			/>
		);
	}
	return (
		<pre className={`ascii-logo${className ? ` ${className}` : ""}`} role="img" aria-label="F5 logo">
			{F5_ASCII_LINES.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static array
				<div key={i} className="ascii-line">
					{[...line].map((char, j) => {
						const { text, className: cc } = colorChar(char);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: static character array
							<span key={j} className={cc}>
								{text}
							</span>
						);
					})}
				</div>
			))}
		</pre>
	);
}
