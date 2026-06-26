import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { extractPrintableText } from "@f5-sales-demo/pi-tui/keys";
import { ProcessTerminal } from "@f5-sales-demo/pi-tui/terminal";

const stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinSetRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
		return;
	}
	delete (target as Record<string, unknown>)[key];
}

describe("Terminal response filtering — no gibberish in editor", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdin, "setRawMode", { value: vi.fn(), configurable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		restoreProperty(process.stdin, "isTTY", stdinIsTtyDescriptor);
		restoreProperty(process.stdout, "isTTY", stdoutIsTtyDescriptor);
		restoreProperty(process.stdin, "setRawMode", stdinSetRawModeDescriptor);
	});

	function setupTerminal() {
		const writes: string[] = [];
		const received: string[] = [];
		vi.spyOn(process, "kill").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			writes.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		});

		const terminal = new ProcessTerminal();
		terminal.start(
			data => received.push(data),
			() => {},
		);

		return { terminal, writes, received };
	}

	describe("race condition: responses arriving before settling period", () => {
		it("Kitty response arriving at 10ms is blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(10);
			process.stdin.emit("data", "\x1b[?0u");

			expect(received.join("")).not.toContain("?0u");

			terminal.stop();
		});

		it("DA1 response arriving at 10ms is blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(10);
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			expect(received.join("")).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("all three responses arriving at 20ms are blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(20);
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			const all = received.join("");
			expect(all).not.toContain("?0u");
			expect(all).not.toContain("rgb:");
			expect(all).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("concatenated responses in one chunk at 20ms are blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(20);
			process.stdin.emit("data", "\x1b[?0u\x1b]11;rgb:158e/193a/1e75\x07\x1b[?64;1;2;4;6;17;18;21;22;52c");

			const all = received.join("");
			expect(all).not.toContain("?0u");
			expect(all).not.toContain("rgb:");
			expect(all).not.toContain("64;1;2;4;6");
			expect(all).toBe("");

			terminal.stop();
		});
	});

	describe("normal operation: responses arriving after settling period", () => {
		it("Kitty response after settling is still blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?0u");

			expect(received.join("")).not.toContain("?0u");

			terminal.stop();
		});

		it("DA1 response after settling is still blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			expect(received.join("")).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("OSC 11 + DA1 after settling is still blocked", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?1;2c");

			expect(received.join("")).not.toContain("rgb:");

			terminal.stop();
		});
	});

	describe("real keystrokes pass through after settling", () => {
		it("regular characters reach input handler", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "hello");

			expect(received).toEqual(["h", "e", "l", "l", "o"]);

			terminal.stop();
		});

		it("arrow keys reach input handler", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[A");

			expect(received).toContain("\x1b[A");

			terminal.stop();
		});
	});

	describe("edge cases", () => {
		it("partial DA1 flushed by timeout is caught by catch-all", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22");
			vi.advanceTimersByTime(15);

			expect(received.join("")).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("DA2 response (ESC[>...) is swallowed", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[>1;4000;19c");

			expect(received.join("")).not.toContain(">1;4000");

			terminal.stop();
		});

		it("OSC 11 with ST terminator (ESC backslash) is swallowed", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b]11;rgb:ffff/ffff/ffff\x1b\\");
			process.stdin.emit("data", "\x1b[?1;2c");

			expect(received.join("")).not.toContain("rgb:");

			terminal.stop();
		});

		it("duplicate Kitty response after protocol active is swallowed", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?1u");
			process.stdin.emit("data", "\x1b[?1u");

			expect(received).toEqual([]);

			terminal.stop();
		});

		it("late DA1 after sentinel consumed is swallowed (production bug scenario)", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			// First: normal cycle — OSC 11 response + DA1 sentinel consumed
			process.stdin.emit("data", "\x1b]11;rgb:0000/0000/0000\x07");
			process.stdin.emit("data", "\x1b[?1;2c");

			// Now sentinel count is 0. A late/duplicate DA1 arrives.
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			expect(received.join("")).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("late Kitty response after protocol already active is swallowed", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			// First response activates protocol
			process.stdin.emit("data", "\x1b[?1u");
			// Protocol is now active. Late/duplicate response arrives.
			process.stdin.emit("data", "\x1b[?0u");

			expect(received.join("")).not.toContain("?0u");

			terminal.stop();
		});

		it("complete production gibberish sequence: Kitty + OSC11 + DA1 after settling", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			const all = received.join("");
			expect(all).toBe("");

			terminal.stop();
		});
	});

	describe("stop/start cycle (plugin credential fix scenario)", () => {
		it("responses after stop/start cycle do not leak", () => {
			const { terminal, received } = setupTerminal();

			vi.advanceTimersByTime(60);
			// Initial queries settle
			process.stdin.emit("data", "\x1b[?1u");
			process.stdin.emit("data", "\x1b]11;rgb:0000/0000/0000\x07");
			process.stdin.emit("data", "\x1b[?1;2c");
			expect(received).toEqual([]);

			// Simulate plugin credential fix: stop → run external process → start
			terminal.stop();
			received.length = 0;

			terminal.start(
				data => received.push(data),
				() => {},
			);

			// New queries sent by start() generate fresh responses
			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			expect(received.join("")).not.toContain("?0u");
			expect(received.join("")).not.toContain("rgb:");
			expect(received.join("")).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("doubled responses after two stop/start cycles do not leak", () => {
			const { terminal, received } = setupTerminal();
			vi.advanceTimersByTime(60);

			// Cycle 1
			terminal.stop();
			terminal.start(
				data => received.push(data),
				() => {},
			);
			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			// Cycle 2
			terminal.stop();
			terminal.start(
				data => received.push(data),
				() => {},
			);
			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			// Neither cycle should leak
			const all = received.join("");
			expect(all).not.toContain("?0u");
			expect(all).not.toContain("rgb:");
			expect(all).not.toContain("64;1;2;4;6");

			terminal.stop();
		});

		it("real keystrokes work after stop/start cycle", () => {
			const { terminal, received } = setupTerminal();
			vi.advanceTimersByTime(60);

			terminal.stop();
			received.length = 0;
			terminal.start(
				data => received.push(data),
				() => {},
			);
			vi.advanceTimersByTime(60);

			// Gibberish followed by real input
			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "hello");

			expect(received).not.toContain("\x1b[?0u");
			expect(received).toContain("h");
			expect(received).toContain("o");

			terminal.stop();
		});
	});

	describe("OSC 11 periodic poll responses", () => {
		it("poll-triggered OSC 11 + DA1 responses are swallowed", () => {
			const { terminal, received } = setupTerminal();
			vi.advanceTimersByTime(60);

			// Initial queries settle
			process.stdin.emit("data", "\x1b[?1u");
			process.stdin.emit("data", "\x1b]11;rgb:0000/0000/0000\x07");
			process.stdin.emit("data", "\x1b[?1;2c");

			// Advance past poll interval (2000ms) — poll sends new OSC 11 + DA1
			vi.advanceTimersByTime(2500);
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?1;2c");

			expect(received.join("")).not.toContain("rgb:");
			expect(received).toEqual([]);

			terminal.stop();
		});

		it("multiple poll cycles never leak", () => {
			const { terminal, received } = setupTerminal();
			vi.advanceTimersByTime(60);

			// Initial settle
			process.stdin.emit("data", "\x1b[?1u");
			process.stdin.emit("data", "\x1b]11;rgb:0000/0000/0000\x07");
			process.stdin.emit("data", "\x1b[?1;2c");

			// 3 poll cycles
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(2500);
				process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
				process.stdin.emit("data", "\x1b[?1;2c");
			}

			expect(received).toEqual([]);

			terminal.stop();
		});
	});

	describe("Kitty key events never become editor text (extractPrintableText guard)", () => {
		it("Kitty Ctrl+C press is not printable text", () => {
			expect(extractPrintableText("\x1b[99;5u")).toBeUndefined();
		});

		it("Kitty Ctrl+C release is not printable text", () => {
			expect(extractPrintableText("\x1b[99;5:3u")).toBeUndefined();
		});

		it("Kitty modified/release key events are not printable text", () => {
			expect(extractPrintableText("\x1b[27;2:3u")).toBeUndefined();
			expect(extractPrintableText("\x1b[99;5:2u")).toBeUndefined();
		});

		it("capability responses after stop/start are still filtered at terminal level", () => {
			const { terminal, received } = setupTerminal();
			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?1u");

			terminal.stop();
			received.length = 0;
			terminal.start(
				data => received.push(data),
				() => {},
			);
			vi.advanceTimersByTime(60);

			process.stdin.emit("data", "\x1b[?0u");
			process.stdin.emit("data", "\x1b]11;rgb:158e/193a/1e75\x07");
			process.stdin.emit("data", "\x1b[?64;1;2;4;6;17;18;21;22;52c");

			const all = received.join("");
			expect(all).not.toContain("?0u");
			expect(all).not.toContain("rgb:");
			expect(all).not.toContain("64;1;2;4;6");

			terminal.stop();
		});
	});

	describe("restart suppresses capability re-probing (root cause of doubled gibberish)", () => {
		// The doubled gibberish comes from the ui.stop() → cooked-mode subprocess →
		// ui.start() cycle re-sending the WHOLE capability handshake, producing a
		// SECOND response round that lands while the filtered reader is torn down.
		// In cooked mode the terminal echoes those bytes itself (kernel-level — no
		// JS filter can intercept). Once capabilities are known, a restart must not
		// re-send response-generating queries, so there is no second round to leak.
		function completeHandshake(): void {
			vi.advanceTimersByTime(60);
			process.stdin.emit("data", "\x1b[?1u"); // kitty supported → protocol active
			process.stdin.emit("data", "\x1b]11;rgb:0000/0000/0000\x07"); // bg color known
			process.stdin.emit("data", "\x1b[?1;2c"); // DA1
		}

		it("second start() after a completed handshake does not re-query kitty, OSC 11, or DA1", () => {
			const { terminal, writes } = setupTerminal();
			completeHandshake();

			// Plugin credential-fix cycle: stop → (cooked-mode subprocess) → start.
			terminal.stop();
			writes.length = 0; // examine only the restart's writes

			terminal.start(
				() => {},
				() => {},
			);

			const out = writes.join("");
			expect(out).not.toContain("\x1b[?u"); // Kitty query → response \x1b[?0u
			expect(out).not.toContain("\x1b]11;?"); // OSC 11 query → response \x1b]11;rgb:...
			expect(out).not.toContain("\x1b[c"); // DA1 sentinel → response \x1b[?...c

			terminal.stop();
		});

		it("restart re-enables Kitty protocol without a query when support is already known", () => {
			const { terminal, writes } = setupTerminal();
			completeHandshake();

			// stop() disables Kitty (\x1b[<u); the restart must re-enable it
			// directly — no query means no response means nothing to echo.
			terminal.stop();
			writes.length = 0;

			terminal.start(
				() => {},
				() => {},
			);

			expect(writes.join("")).toContain("\x1b[>7u"); // Kitty enable, no query

			terminal.stop();
		});
	});
});
