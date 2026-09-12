import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import xterm, { type Terminal } from "@xterm/headless";

/** Pin the emulator's width rules rather than inheriting its legacy Unicode 6 default. */
export function createCaptureTerminal(columns: number, rows: number): Terminal {
	const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 1000 });
	terminal.loadAddon(new Unicode11Addon());
	terminal.unicode.activeVersion = "11";
	return terminal;
}

/** Serialize the emulator's visible cells, not the raw cursor-motion event stream. */
export function terminalViewportAnsi(terminal: Terminal): string[] {
	return Array.from({ length: terminal.rows }, (_, row) => {
		const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row);
		let result = "";
		for (let col = 0; col < terminal.cols; col++) {
			const cell = line?.getCell(col);
			if (!cell) {
				result += " ";
				continue;
			}
			if (cell.getWidth() === 0) continue;
			const codes: number[] = [0];
			for (const [active, code] of [
				[cell.isBold(), 1],
				[cell.isDim(), 2],
				[cell.isItalic(), 3],
				[cell.isUnderline(), 4],
				[cell.isBlink(), 5],
				[cell.isInverse(), 7],
				[cell.isInvisible(), 8],
				[cell.isStrikethrough(), 9],
			])
				if (active) codes.push(code);
			for (const [prefix, rgb, palette, colour] of [
				[38, cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()],
				[48, cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor()],
			] as const) {
				if (rgb) codes.push(prefix, 2, (colour >> 16) & 255, (colour >> 8) & 255, colour & 255);
				else if (palette) codes.push(prefix, 5, colour);
			}
			result += `\x1b[${codes.join(";")}m${cell.getChars() || " "}`;
		}
		return `${result}\x1b[0m`;
	});
}

const palette = [
	"#000000",
	"#cd0000",
	"#00cd00",
	"#cdcd00",
	"#0000ee",
	"#cd00cd",
	"#00cdcd",
	"#e5e5e5",
	"#7f7f7f",
	"#ff0000",
	"#00ff00",
	"#ffff00",
	"#5c5cff",
	"#ff00ff",
	"#00ffff",
	"#ffffff",
];
function rgb(channels: number[]): string {
	if (channels.length !== 3 || channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255))
		throw new Error("Invalid ANSI RGB colour");
	return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}
export function ansiPalette(index: number): string {
	if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error("Invalid ANSI palette index");
	if (index < 16) return palette[index];
	if (index >= 232) return rgb(Array(3).fill(8 + (index - 232) * 10));
	const cube = index - 16;
	return rgb([Math.floor(cube / 36), Math.floor(cube / 6) % 6, cube % 6].map(value => (value ? 55 + value * 40 : 0)));
}
function xml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Fail on unknown styling rather than silently manufacturing misleading visual evidence. */
export function ansiToPango(ansi: string, defaults: { foreground: string; background: string }): string {
	let foreground = defaults.foreground,
		background = defaults.background;
	let bold = false,
		dim = false,
		italic = false,
		underline = false,
		strike = false,
		inverse = false,
		hidden = false;
	let offset = 0;
	const chunks: string[] = [];
	const emit = (value: string) => {
		const text = Bun.stripANSI(value);
		if (!text) return;
		const fg = inverse ? background : foreground;
		const bg = inverse ? foreground : background;
		chunks.push(
			`<span foreground="${hidden ? bg : fg}" background="${bg}"${bold ? ' weight="bold"' : ""}${dim ? ' foreground_alpha="50%"' : ""}${italic ? ' style="italic"' : ""}${underline ? ' underline="single"' : ""}${strike ? ' strikethrough="true"' : ""}>${xml(text)}</span>`,
		);
	};
	for (const match of ansi.matchAll(/\x1b\[([0-9;]*)m/g)) {
		emit(ansi.slice(offset, match.index));
		const codes = (match[1] || "0").split(";").map(Number);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
			if (code === 0) {
				foreground = defaults.foreground;
				background = defaults.background;
				bold = dim = italic = underline = strike = inverse = hidden = false;
			} else if (code === 1) bold = true;
			else if (code === 2) dim = true;
			else if (code === 3) italic = true;
			else if (code === 4) underline = true;
			// A PNG samples the visible phase of blinking text/cursors; record this in capture metadata.
			else if (code === 5 || code === 6 || code === 25) continue;
			else if (code === 7) inverse = true;
			else if (code === 8) hidden = true;
			else if (code === 9) strike = true;
			else if (code === 22) bold = dim = false;
			else if (code === 23) italic = false;
			else if (code === 24) underline = false;
			else if (code === 27) inverse = false;
			else if (code === 28) hidden = false;
			else if (code === 29) strike = false;
			else if (code === 39) foreground = defaults.foreground;
			else if (code === 49) background = defaults.background;
			else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
				foreground = ansiPalette(code >= 90 ? code - 90 + 8 : code - 30);
			else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107))
				background = ansiPalette(code >= 100 ? code - 100 + 8 : code - 40);
			else if (code === 38 || code === 48) {
				let colour: string;
				if (codes[i + 1] === 5) {
					colour = ansiPalette(codes[i + 2]);
					i += 2;
				} else if (codes[i + 1] === 2) {
					colour = rgb(codes.slice(i + 2, i + 5));
					i += 4;
				} else throw new Error(`Unsupported ANSI colour: ${match[0]}`);
				if (code === 38) foreground = colour;
				else background = colour;
			} else throw new Error(`Unsupported ANSI styling code: ${code}`);
		}
		offset = match.index! + match[0].length;
	}
	emit(ansi.slice(offset));
	return chunks.join("");
}

export async function writeTerminalCapture(
	directory: string,
	name: string,
	lines: string[],
	dimensions: { columns: number; rows: number },
	colours: { foreground: string; background: string },
	evidence: Record<string, unknown>,
): Promise<void> {
	if (lines.length > dimensions.rows || lines.some(line => visibleWidth(line) > dimensions.columns))
		throw new Error(`Overflow in ${name}`);
	const padded = Array.from({ length: dimensions.rows }, (_, index) => {
		const line = lines[index] ?? "";
		return line + " ".repeat(Math.max(0, dimensions.columns - visibleWidth(line)));
	});
	await mkdir(directory, { recursive: true });
	const ansi = padded.join("\n");
	const prefix = join(directory, name);
	await Bun.write(`${prefix}.ansi`, ansi);
	await Bun.write(`${prefix}.txt`, Bun.stripANSI(ansi));
	await Bun.write(
		`${prefix}.json`,
		JSON.stringify(
			{
				...evidence,
				...dimensions,
				kind:
					evidence.kind === "actual-terminal-viewport"
						? "actual-terminal-viewport"
						: "deterministic-component-fixture",
				blinkPhase: "visible (static snapshot; animation not verified)",
				image: `${name}.png`,
				visualVerdict: "unexamined",
			},
			null,
			2,
		),
	);
	await Bun.write(
		`${prefix}.pango`,
		`<span font_family="DejaVu Sans Mono" font_size="12pt">${ansiToPango(ansi, colours)}</span>`,
	);
	const child = Bun.spawn(
		[
			"pango-view",
			"--no-display",
			"--markup",
			`--background=${colours.background}`,
			"--margin=14",
			`--output=${prefix}.png`,
			`${prefix}.pango`,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	if (code !== 0) throw new Error(`Capture renderer failed: ${error}`);
}
