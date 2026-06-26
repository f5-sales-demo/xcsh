// Fixture: drives ProcessTerminal through the credential-fix lifecycle
// (start → stop → start) inside a real PTY so the parent test can observe what
// the terminal writes across a stop/start cycle and inject capability-probe
// responses on a real TTY (raw-mode echo off, cooked-mode echo on).
//
// Run by packages/coding-agent/test/terminal-restart-pty.test.ts via PtySession.
// Emits __MARKER__ lines on stdout so the parent can synchronize injection and
// segment the captured output. Never import this from app code.
import { ProcessTerminal } from "@f5-sales-demo/pi-tui/terminal";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
	const terminal = new ProcessTerminal();

	// Round 1 — initial capability handshake. start() writes the kitty query,
	// OSC 11 query + DA1 sentinel, etc. to the PTY. The parent injects responses
	// when it sees the handshake so capabilities become "known".
	terminal.start(
		() => {},
		() => {},
	);
	await sleep(300); // 50ms input-handler defer + margin for parent injection
	process.stdout.write("\n__HANDSHAKE_ANSWERED__\n");
	await sleep(150);

	// Credential-fix cycle: stop() drops to cooked mode (as before a
	// stdio:"inherit" subprocess), then start() resumes raw mode.
	terminal.stop();
	process.stdout.write("__STOPPED__\n");
	await sleep(200);

	terminal.start(
		() => {},
		() => {},
	);
	await sleep(300);
	process.stdout.write("__RESTARTED__\n");

	await sleep(100);
	terminal.stop();
	process.stdout.write("__DONE__\n");
	await sleep(50);
	process.exit(0);
}

void main();
