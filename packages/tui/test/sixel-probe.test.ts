import { afterEach, describe, expect, it } from "bun:test";
import { ImageProtocol, setTerminalImageProtocol, TERMINAL, TUI } from "@f5-sales-demo/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminalInfo = TERMINAL as unknown as MutableTerminalInfo;
const originalProtocol = TERMINAL.imageProtocol;
const originalWtSession = Bun.env.WT_SESSION;
const originalHerdrEnv = Bun.env.HERDR_ENV;
const stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function restoreIsTty(
	stream: NodeJS.ReadStream | NodeJS.WriteStream,
	descriptor: PropertyDescriptor | undefined,
): void {
	if (descriptor) {
		Object.defineProperty(stream, "isTTY", descriptor);
		return;
	}
	delete (stream as unknown as { isTTY?: boolean }).isTTY;
}

describe("TUI SIXEL capability probe", () => {
	afterEach(() => {
		setTerminalImageProtocol(originalProtocol);
		terminalInfo.imageProtocol = originalProtocol;
		if (originalWtSession === undefined) delete Bun.env.WT_SESSION;
		else Bun.env.WT_SESSION = originalWtSession;
		if (originalHerdrEnv === undefined) delete Bun.env.HERDR_ENV;
		else Bun.env.HERDR_ENV = originalHerdrEnv;
		restoreIsTty(process.stdin, stdinIsTtyDescriptor);
		restoreIsTty(process.stdout, stdoutIsTtyDescriptor);
	});

	it("keeps Herdr graphics opt-out authoritative over Windows Terminal capability replies", () => {
		if (process.platform !== "win32") return;
		setTerminalImageProtocol(null);
		Bun.env.HERDR_ENV = "1";
		Bun.env.WT_SESSION = "test-wt-session";
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		try {
			tui.start();
			terminal.sendInput("\x1b[?1;2;4c\x1b[?2;1;0S");
			expect(TERMINAL.imageProtocol).toBeNull();
		} finally {
			tui.stop();
		}
	});

	it("enables SIXEL only after positive terminal capability response", () => {
		if (process.platform !== "win32") return;
		setTerminalImageProtocol(null);
		terminalInfo.imageProtocol = null;
		Bun.env.WT_SESSION = "test-wt-session";
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		tui.start();
		terminal.sendInput("\x1b[?1;2;4c");

		expect(TERMINAL.imageProtocol).toBe(ImageProtocol.Sixel);
		tui.stop();
	});

	it("enables SIXEL when DA and graphics replies are coalesced in one chunk", () => {
		if (process.platform !== "win32") return;
		setTerminalImageProtocol(null);
		terminalInfo.imageProtocol = null;
		Bun.env.WT_SESSION = "test-wt-session";
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		tui.start();
		terminal.sendInput("\x1b[?1;2;4c\x1b[?2;1;0S");

		expect(TERMINAL.imageProtocol).toBe(ImageProtocol.Sixel);
		tui.stop();
	});

	it("enables SIXEL when DA reply arrives split across chunks", () => {
		if (process.platform !== "win32") return;
		setTerminalImageProtocol(null);
		terminalInfo.imageProtocol = null;
		Bun.env.WT_SESSION = "test-wt-session";
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		tui.start();
		terminal.sendInput("\x1b[?1;2;");
		terminal.sendInput("4c");

		expect(TERMINAL.imageProtocol).toBe(ImageProtocol.Sixel);
		tui.stop();
	});

	it("keeps SIXEL disabled when capability responses are negative", () => {
		if (process.platform !== "win32") return;
		setTerminalImageProtocol(null);
		terminalInfo.imageProtocol = null;
		Bun.env.WT_SESSION = "test-wt-session";
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		tui.start();
		terminal.sendInput("\x1b[?1;2c");
		terminal.sendInput("\x1b[?2;0;0S");

		expect(TERMINAL.imageProtocol).toBeNull();
		tui.stop();
	});
});
