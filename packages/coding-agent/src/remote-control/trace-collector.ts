/** Private local capture endpoint. Raw frames exist only in memory, never diagnostics. */
import { chmodSync, existsSync, lstatSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { ProtocolTrace, type TraceManifest } from "./trace";

export async function startTraceCollector(path: string, file: string, manifest: TraceManifest) {
	const parent = lstatSync(dirname(path));
	if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0)
		throw new Error("Capture socket requires a private owned directory");
	if (existsSync(path) || existsSync(`${path}.incomplete`)) throw new Error("Capture path already used");
	const trace = new ProtocolTrace(file, manifest);
	const sequences = new Map<string, number>();
	const peers = new Set<Socket>();
	const server = createServer(socket => {
		if (peers.size >= 64) {
			trace.invalidate("producer-failure");
			socket.destroy();
			return;
		}
		peers.add(socket);
		let pending = Buffer.alloc(0);
		socket.setTimeout(5_000, () => {
			trace.invalidate("truncated-frame");
			socket.destroy();
		});
		socket.on("error", () => trace.invalidate("producer-failure"));
		socket.on("close", () => {
			if (pending.length) trace.invalidate("truncated-frame");
			peers.delete(socket);
		});
		socket.on("data", chunk => {
			if (typeof chunk === "string") {
				trace.invalidate("invalid-frame");
				socket.destroy();
				return;
			}
			if (pending.length + chunk.length > 16 * 1024 * 1024) {
				trace.invalidate("invalid-frame");
				socket.destroy();
				return;
			}
			pending = Buffer.concat([pending, chunk]);
			for (let boundary = pending.indexOf(10); boundary >= 0; boundary = pending.indexOf(10)) {
				const line = pending.subarray(0, boundary);
				pending = pending.subarray(boundary + 1);
				try {
					const row = JSON.parse(line.toString("utf8"));
					if (
						!row ||
						!/^[a-z-]{1,32}$/.test(row.producer) ||
						!Number.isSafeInteger(row.sequence) ||
						row.sequence < 1 ||
						!["rpc", "relay", "realtime", "connection"].includes(row.layer) ||
						!["in", "out"].includes(row.direction) ||
						!("message" in row)
					)
						throw new Error();
					if (!sequences.has(row.producer) && sequences.size >= 8) throw new Error();
					if (row.sequence !== (sequences.get(row.producer) ?? 0) + 1) trace.invalidate("producer-gap");
					sequences.set(row.producer, row.sequence);
					trace.record(row.layer, row.direction, row.message);
				} catch {
					trace.invalidate("invalid-frame");
				}
			}
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(path, () => {
				server.off("error", reject);
				resolve();
			});
		});
		chmodSync(path, 0o600);
	} catch (error) {
		trace.invalidate("producer-failure");
		trace.close();
		throw error;
	}
	let closed = false;
	return {
		async close() {
			if (closed) return;
			closed = true;
			for (const peer of peers) {
				trace.invalidate("producer-failure");
				peer.destroy();
			}
			await new Promise<void>(resolve => server.close(() => resolve()));
			if (existsSync(`${path}.incomplete`)) trace.invalidate("producer-failure");
			trace.close();
		},
	};
}
