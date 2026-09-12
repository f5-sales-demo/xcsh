import { chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { ProtocolError } from "./session";

const MAX_FRAME = 8 * 1024 * 1024;
export class LocalPeer {
	handle: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => {
		throw new ProtocolError(-32601, "Unsupported local method");
	};
	onClose: () => void = () => {};
	#buffer = Buffer.alloc(0);
	#pending = new Map<
		string,
		{ resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	constructor(private readonly socket: Socket) {
		// Treat EOF as disconnect even when the runtime retains a writable half.
		socket.on("end", () => socket.destroy());
		socket.on("data", chunk => {
			if (this.#buffer.length + chunk.length > MAX_FRAME) {
				socket.destroy();
				return;
			}
			this.#buffer = Buffer.concat([this.#buffer, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
			for (;;) {
				const end = this.#buffer.indexOf(10);
				if (end === -1) break;
				const line = this.#buffer.subarray(0, end);
				this.#buffer = this.#buffer.subarray(end + 1);
				try {
					this.#receive(JSON.parse(line.toString("utf8")));
				} catch {
					socket.destroy();
					return;
				}
			}
		});
		socket.on("error", () => {});
		socket.on("close", () => {
			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error("Local remote connection closed"));
			}
			this.#pending.clear();
			this.onClose();
		});
	}
	#send(value: unknown): void {
		const wire = `${JSON.stringify(value)}\n`;
		if (this.socket.destroyed || Buffer.byteLength(wire) + this.socket.writableLength > MAX_FRAME)
			throw new Error("Local remote connection closed or buffer full");
		this.socket.write(wire);
	}
	#receive(frame: Record<string, unknown>): void {
		if (!frame || typeof frame !== "object" || typeof frame.id !== "string") throw new Error();
		if (typeof frame.method === "string") {
			if (!frame.params || typeof frame.params !== "object" || Array.isArray(frame.params)) throw new Error();
			void this.handle(frame.method, frame.params as Record<string, unknown>)
				.then(
					result => {
						this.#send({ id: frame.id, result });
					},
					error => {
						this.#send({
							id: frame.id,
							error: {
								code: error instanceof ProtocolError ? error.code : -32000,
								message: error instanceof ProtocolError ? error.message : "Local remote request failed",
							},
						});
					},
				)
				.catch(() => this.socket.destroy());
		} else {
			const pending = this.#pending.get(frame.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.#pending.delete(frame.id);
			if (frame.error) {
				const error = frame.error as { code: number; message: string };
				pending.reject(new ProtocolError(error.code, error.message));
			} else pending.resolve(frame.result);
		}
	}
	call(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (this.#pending.size >= 256) return Promise.reject(new Error("Local remote request limit"));
		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error("Local remote request timed out"));
			}, 30_000);
			this.#pending.set(id, { resolve, reject, timer });
			try {
				this.#send({ id, method, params });
			} catch (error) {
				clearTimeout(timer);
				this.#pending.delete(id);
				reject(error);
			}
		});
	}
	close(): void {
		this.socket.destroy();
	}
}
export async function listenLocal(path: string, accepted: (peer: LocalPeer) => void): Promise<Server> {
	const server = createServer(socket => accepted(new LocalPeer(socket)));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	await chmod(path, 0o600);
	return server;
}
export async function connectPeer(path: string): Promise<LocalPeer> {
	return new Promise((resolve, reject) => {
		const socket = connect(path);
		socket.once("error", reject);
		socket.once("connect", () => {
			socket.removeListener("error", reject);
			resolve(new LocalPeer(socket));
		});
	});
}
