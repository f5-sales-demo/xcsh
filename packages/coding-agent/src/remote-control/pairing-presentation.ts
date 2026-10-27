import type { Component } from "@f5-sales-demo/pi-tui";
import QRCode from "qrcode";
import { type Pairing, validatePairing } from "./pairing";

/** First-party desktop setup encodes pairingCode here, separately from manualPairingCode. */
export function pairingUrl(pairing: Pairing): string {
	validatePairing(pairing);
	const url = new URL("https://chatgpt.com/codex/pair");
	url.searchParams.set("pairing_code", pairing.pairing_code);
	return url.toString();
}

/** Ephemeral fullscreen component; no challenge is added to chat, status history, or files. */
export class PairingDisplay implements Component {
	#pairing: Pairing | undefined;
	#modules: ReturnType<typeof QRCode.create>["modules"] | undefined;
	#timer: ReturnType<typeof setInterval>;
	#expired = false;
	constructor(
		pairing: Pairing,
		private readonly done: () => void,
		private readonly rows: () => number,
		private readonly now: () => number = Date.now,
		refresh: () => void = () => {},
	) {
		validatePairing(pairing, now());
		try {
			this.#modules = QRCode.create(pairingUrl(pairing), { errorCorrectionLevel: "L" }).modules;
		} catch {
			throw new Error("Pairing QR could not be generated; request a fresh challenge.");
		}
		this.#pairing = { ...pairing };
		this.#timer = setInterval(refresh, 1000);
		this.#timer.unref();
	}
	render(width: number): string[] {
		const pairing = this.#pairing;
		const modules = this.#modules;
		if (!pairing || !modules)
			return [
				this.#expired ? "Pairing challenge expired. Close and request a fresh QR." : "Pairing display closed.",
			];
		if (Date.parse(pairing.expires_at) <= this.now()) {
			this.#expired = true;
			this.dispose();
			return ["Pairing challenge expired. Close and request a fresh QR."];
		}
		const size = modules.size + 8;
		const remaining = Math.ceil((Date.parse(pairing.expires_at) - this.now()) / 1000);
		const columns = Math.max(1, Math.floor(width));
		const wrap = (text: string): string[] => [...(text.match(new RegExp(`.{1,${columns}}`, "g")) ?? [])];
		const lines = wrap("Scan with your iPhone camera, then finish connecting in ChatGPT.");
		const footer = [
			pairing.manual_pairing_code ? `Manual code: ${pairing.manual_pairing_code}` : "Manual fallback unavailable.",
			`Expires in ${remaining}s. Enter or Esc closes this display.`,
			"Closing hides the challenge; it remains valid until its expiry.",
		].flatMap(wrap);
		if (width <= size || this.rows() < Math.ceil(size / 2) + lines.length + footer.length + 1) {
			lines.push(...wrap("Enlarge this terminal to show the complete QR."));
		} else {
			const black = (x: number, y: number) =>
				x >= 4 && y >= 4 && x < size - 4 && y < size - 4 && Boolean(modules.get(y - 4, x - 4));
			for (let y = 0; y < size; y += 2) {
				let row = "\x1b[30;47m";
				for (let x = 0; x < size; x++) {
					const top = black(x, y),
						bottom = black(x, y + 1);
					row += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
				}
				lines.push(`${row}\x1b[0m`);
			}
		}
		lines.push(...footer);
		return lines;
	}
	handleInput(data: string): void {
		if (data === "\r" || data === "\n" || data === "\x1b" || data === "\x03") {
			this.dispose();
			this.done();
		}
	}
	invalidate(): void {}
	dispose(): void {
		clearInterval(this.#timer);
		this.#pairing = undefined;
		this.#modules = undefined;
	}
}

export async function presentRemoteResult(
	action: string,
	result: unknown,
	json: boolean,
	io = {
		write: (value: string) => {
			process.stdout.write(value);
		},
		show: showTerminalPairing,
	},
): Promise<void> {
	if (result === undefined) return;
	if (action === "pair" && !json) {
		validatePairing(result);
		await io.show(result);
	} else io.write(`${JSON.stringify(result)}\n`);
}

export async function showTerminalPairing(pairing: Pairing): Promise<void> {
	if (!process.stdout.isTTY || !process.stdin.isTTY || process.env.TERM === "dumb")
		throw new Error("QR pairing requires an interactive terminal; use --json for machine-readable challenges.");
	await new Promise<void>(resolve => {
		const wasRaw = process.stdin.isRaw;
		let closed = false;
		const finish = () => {
			if (closed) return;
			closed = true;
			display.dispose();
			process.stdin.off("data", input);
			process.stdout.off("resize", render);
			process.off("SIGINT", finish);
			process.off("SIGTERM", finish);
			process.stdin.setRawMode(wasRaw);
			process.stdin.pause();
			process.stdout.write("\x1b[0m\x1b[2J\x1b[H\x1b[?25h\x1b[?1049l");
			resolve();
		};
		const render = () => process.stdout.write(`\x1b[2J\x1b[H${display.render(process.stdout.columns).join("\r\n")}`);
		const display = new PairingDisplay(pairing, finish, () => process.stdout.rows, Date.now, render);
		const input = (data: Buffer) => display.handleInput(data.toString());
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", input);
		process.stdout.on("resize", render);
		process.once("SIGINT", finish);
		process.once("SIGTERM", finish);
		process.stdout.write("\x1b[?1049h\x1b[?25l");
		render();
	});
}
