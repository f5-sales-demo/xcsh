// PTY integration test for the terminal "gibberish" leak.
//
// The unit tests (packages/tui/test/terminal-response-filter.test.ts) assert the
// restart-no-re-probe behavior against a mocked process.stdin. This test proves
// the same property end-to-end on a REAL pseudo-terminal — real setRawMode, real
// cooked/raw echo semantics — which the mock cannot exercise.
//
// Root cause: the ui.stop() → cooked-mode subprocess → ui.start() credential-fix
// cycle re-sends the whole capability handshake on restart. That second response
// round lands while the terminal is echoing (cooked mode) and paints the doubled
// gibberish. Once capabilities are known, the restart must not re-send the
// response-generating queries.
import { describe, expect, it } from "bun:test";
import path from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";

const PKG_ROOT = path.resolve(import.meta.dir, "..");
const FIXTURE = path.join(import.meta.dir, "fixtures", "pty-restart-fixture.ts");

// Distinct so query (no digit) and response (with digit) never alias:
const KITTY_QUERY = "\x1b[?u"; // app → terminal
const OSC11_QUERY = "\x1b]11;?"; // app → terminal
const KITTY_RESPONSE = "\x1b[?1u"; // terminal → app (injected)
const OSC11_RESPONSE = "\x1b]11;rgb:0000/0000/0000\x07"; // terminal → app (injected)
const DA1_RESPONSE = "\x1b[?1;2c"; // terminal → app (injected)

async function runFixture(): Promise<string> {
	const session = new PtySession();
	let buf = "";
	let injected = false;

	const finished = session.start(
		{ command: `bun ${FIXTURE}`, cwd: PKG_ROOT, timeoutMs: 10_000, cols: 80, rows: 24 },
		(_err, chunk) => {
			buf += chunk ?? "";
			// Inject the round-1 responses as soon as the initial handshake is seen,
			// so capabilities become "known" before the stop/start cycle.
			if (!injected && buf.includes(KITTY_QUERY)) {
				injected = true;
				session.write(KITTY_RESPONSE + OSC11_RESPONSE + DA1_RESPONSE);
			}
		},
	);

	try {
		await finished;
	} finally {
		try {
			session.kill();
		} catch {
			/* already exited */
		}
	}
	return buf;
}

describe("ProcessTerminal restart does not re-probe (real PTY)", () => {
	it("the credential-fix stop/start cycle does not re-send the capability handshake", async () => {
		if (process.platform === "win32" || !Bun.which("bun")) return;

		const out = await runFixture();

		// Sanity: the fixture ran the full lifecycle and the first handshake fired.
		expect(out).toContain("__STOPPED__");
		expect(out).toContain("__RESTARTED__");
		expect(out).toContain(KITTY_QUERY); // initial probe happened

		// The restart segment must not contain fresh response-generating queries —
		// those are what produce the doubled gibberish in cooked mode.
		const restartSegment = out.slice(out.indexOf("__STOPPED__"));
		expect(restartSegment).not.toContain(KITTY_QUERY);
		expect(restartSegment).not.toContain(OSC11_QUERY);
	}, 15_000);

	it("injected probe responses are not echoed back while in raw mode", async () => {
		if (process.platform === "win32" || !Bun.which("bun")) return;

		const out = await runFixture();
		// In raw mode the PTY echo is off and ProcessTerminal consumes the probe
		// responses, so the injected response bytes must never appear in output.
		const beforeStop = out.slice(0, out.indexOf("__STOPPED__"));
		expect(beforeStop).not.toContain("\x1b[?1u"); // echoed kitty response
		expect(beforeStop).not.toContain("rgb:0000/0000/0000"); // echoed OSC 11 response
	}, 15_000);
});
