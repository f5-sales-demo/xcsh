/**
 * `chrome-host` — native-messaging relay subcommand.
 *
 * Launched by Chrome as the native-messaging host. It is a pure relay between
 * Chrome's stdio (native-messaging framing: 4-byte LE length + JSON) and xcsh's
 * Unix socket at `~/.xcsh/chrome-bridge.sock` (newline-delimited JSON). No
 * business logic lives here.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { decodeNm, encodeNm } from "../browser/native-messaging";

const SOCKET_PATH = process.env.XCSH_BRIDGE_SOCKET ?? join(homedir(), ".xcsh", "chrome-bridge.sock");

// Diagnostic relay tracing, OFF unless ~/.xcsh/chrome-host-debug exists. Security:
// writes to a 0600 file in the user's home, lifecycle + byte-counts ONLY — never
// message content — and never to stdout (that would corrupt the NM stream).
function dbg(msg: string): void {
	try {
		const fs = require("node:fs");
		const home = process.env.HOME || homedir();
		if (!fs.existsSync(join(home, ".xcsh", "chrome-host-debug"))) return;
		const fd = fs.openSync(join(home, ".xcsh", "chrome-host.log"), "a", 0o600);
		fs.appendFileSync(fd, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`);
		fs.closeSync(fd);
	} catch {
		/* logging must never break the relay */
	}
}

export default class ChromeHost extends Command {
	static description = "Native-messaging relay between Chrome and the xcsh bridge socket (internal)";

	async run(): Promise<void> {
		let socket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
		let socketBuffer = "";
		dbg(`start sock=${SOCKET_PATH} argc=${process.argv.length}`);

		try {
			dbg("Bun.connect: begin");
			socket = await Bun.connect({
				unix: SOCKET_PATH,
				socket: {
					data(_sock, chunk) {
						// Socket → Chrome: NDJSON lines → native-messaging frames.
						socketBuffer += new TextDecoder().decode(chunk);
						let newlineIndex = socketBuffer.indexOf("\n");
						while (newlineIndex !== -1) {
							const line = socketBuffer.slice(0, newlineIndex);
							socketBuffer = socketBuffer.slice(newlineIndex + 1);
							if (line.length > 0) {
								dbg(`socket→chrome ${line.length}B`);
								process.stdout.write(encodeNm(JSON.parse(line)));
							}
							newlineIndex = socketBuffer.indexOf("\n");
						}
					},
					close() {
						dbg("bridge socket closed → exit");
						process.exit(0);
					},
					error() {
						dbg("bridge socket error → exit");
						process.exit(0);
					},
				},
			});
			dbg("Bun.connect: resolved (connected)");
		} catch (e) {
			// xcsh not running — write nothing, exit cleanly. The extension retries.
			dbg(`Bun.connect: threw → exit: ${e instanceof Error ? e.message : String(e)}`);
			process.exit(0);
		}

		// Chrome stdin → socket: native-messaging frames → NDJSON lines.
		dbg("reading chrome stdin");
		let stdinBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
		for await (const chunk of process.stdin) {
			const bytes = new Uint8Array(chunk);
			const next = new Uint8Array(stdinBuffer.length + bytes.length);
			next.set(stdinBuffer, 0);
			next.set(bytes, stdinBuffer.length);
			const { messages, rest } = decodeNm(next);
			stdinBuffer = rest;
			for (const msg of messages) {
				dbg(`chrome→socket ${JSON.stringify(msg).length}B`);
				socket.write(`${JSON.stringify(msg)}\n`);
			}
		}

		// Chrome closed stdin — tear down and exit.
		dbg("chrome stdin EOF → exit");
		socket.end();
		process.exit(0);
	}
}
