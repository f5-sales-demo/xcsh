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
import { Command } from "@f5xc-salesdemos/pi-utils/cli";
import { decodeNm, encodeNm } from "../browser/native-messaging";

const SOCKET_PATH = process.env.XCSH_BRIDGE_SOCKET ?? join(homedir(), ".xcsh", "chrome-bridge.sock");

export default class ChromeHost extends Command {
	static description = "Native-messaging relay between Chrome and the xcsh bridge socket (internal)";

	async run(): Promise<void> {
		let socket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
		let socketBuffer = "";

		try {
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
								process.stdout.write(encodeNm(JSON.parse(line)));
							}
							newlineIndex = socketBuffer.indexOf("\n");
						}
					},
					close() {
						process.exit(0);
					},
					error() {
						process.exit(0);
					},
				},
			});
		} catch {
			// xcsh not running — write nothing, exit cleanly. The extension retries.
			process.exit(0);
		}

		// Chrome stdin → socket: native-messaging frames → NDJSON lines.
		let stdinBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
		for await (const chunk of process.stdin) {
			const bytes = new Uint8Array(chunk);
			const next = new Uint8Array(stdinBuffer.length + bytes.length);
			next.set(stdinBuffer, 0);
			next.set(bytes, stdinBuffer.length);
			const { messages, rest } = decodeNm(next);
			stdinBuffer = rest;
			for (const msg of messages) {
				socket.write(`${JSON.stringify(msg)}\n`);
			}
		}

		// Chrome closed stdin — tear down and exit.
		socket.end();
		process.exit(0);
	}
}
