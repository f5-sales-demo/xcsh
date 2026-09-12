import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { type Notification, ProtocolError } from "./session";

interface Running {
	child: ChildProcessWithoutNullStreams;
	stdin: boolean;
	kill: () => void;
}
/** Connection-scoped standalone processes from the pinned process/spawn protocol. */
export class RemoteProcesses {
	#active = new Map<string, Map<string, Running>>();
	#requests = new Map<string, { signature: string; result: Promise<unknown> }>();
	constructor(
		private readonly emit: (client: string, event: Notification) => void,
		private readonly allowedCwd: (cwd: string) => boolean,
	) {}
	close(client?: string): void {
		for (const [key, processes] of this.#active) {
			if (client !== undefined && client !== key) continue;
			this.#active.delete(key);
			for (const process of processes.values()) process.kill();
		}
	}
	call(client: string, identity: string, method: string, params: Record<string, unknown>): Promise<unknown> {
		const key = JSON.stringify([client, identity]);
		const signature = JSON.stringify({ method, params });
		const previous = this.#requests.get(key);
		if (previous)
			return previous.signature === signature
				? previous.result
				: Promise.reject(new ProtocolError(-32600, "Request identity reused with different input"));
		if (this.#requests.size >= 4096)
			return Promise.reject(new ProtocolError(-32000, "Process request limit reached"));
		const result = this.#execute(client, method, params);
		this.#requests.set(key, { signature, result });
		return result;
	}
	async #execute(client: string, method: string, p: Record<string, unknown>): Promise<unknown> {
		if (typeof p.processHandle !== "string" || !p.processHandle || p.processHandle.length > 256)
			throw new ProtocolError(-32602, "Invalid process handle");
		const handle = p.processHandle;
		const active = this.#active.get(client);
		if (method === "process/kill") {
			const running = active?.get(handle);
			if (!running) throw new ProtocolError(-32602, "Process not found");
			running.kill();
			return {};
		}
		if (method === "process/writeStdin") {
			const running = active?.get(handle);
			if (!running?.stdin) throw new ProtocolError(-32602, "Process stdin unavailable");
			if (p.deltaBase64 != null) {
				if (
					typeof p.deltaBase64 !== "string" ||
					p.deltaBase64.length > 1024 * 1024 ||
					!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.deltaBase64)
				)
					throw new ProtocolError(-32602, "Invalid stdin bytes");
				const data = Buffer.from(p.deltaBase64, "base64");
				await new Promise<void>((resolve, reject) =>
					running.child.stdin.write(data, error =>
						error ? reject(new ProtocolError(-32000, "Process stdin closed")) : resolve(),
					),
				);
			}
			if (p.closeStdin === true) {
				running.stdin = false;
				running.child.stdin.end();
			}
			return {};
		}
		if (method !== "process/spawn") throw new ProtocolError(-32601, "Unsupported process operation");
		if (p.tty === true || p.size != null) throw new ProtocolError(-32602, "Remote PTY processes are not supported");
		if (typeof p.cwd !== "string" || !isAbsolute(p.cwd) || !this.allowedCwd(p.cwd))
			throw new ProtocolError(-32602, "Process working directory must match a live terminal");
		if (
			!Array.isArray(p.command) ||
			!p.command.length ||
			p.command.length > 256 ||
			p.command.some(arg => typeof arg !== "string" || arg.includes("\0")) ||
			JSON.stringify(p.command).length > 256 * 1024
		)
			throw new ProtocolError(-32602, "Invalid process command");
		const cap = p.outputBytesCap === null ? Infinity : (p.outputBytesCap ?? 1024 * 1024);
		const timeout = p.timeoutMs === null ? null : (p.timeoutMs ?? 30000);
		if (cap !== Infinity && (!Number.isSafeInteger(cap) || (cap as number) < 0 || (cap as number) > 8 * 1024 * 1024))
			throw new ProtocolError(-32602, "Invalid process output cap");
		if (
			timeout !== null &&
			(!Number.isSafeInteger(timeout) || (timeout as number) < 0 || (timeout as number) > 2147483647)
		)
			throw new ProtocolError(-32602, "Invalid process timeout");
		if (active?.has(handle)) throw new ProtocolError(-32602, "Process handle already active");
		if ([...this.#active.values()].reduce((n, m) => n + m.size, 0) >= 16)
			throw new ProtocolError(-32000, "Active process limit reached");
		const env = { ...process.env };
		if (p.env != null) {
			if (typeof p.env !== "object" || Array.isArray(p.env))
				throw new ProtocolError(-32602, "Invalid process environment");
			for (const [key, value] of Object.entries(p.env)) {
				if (
					!key ||
					key.includes("=") ||
					key.includes("\0") ||
					(value !== null && (typeof value !== "string" || value.includes("\0")))
				)
					throw new ProtocolError(-32602, "Invalid process environment");
				if (value === null) delete env[key];
				else env[key] = value as string;
			}
		}
		const [command, ...args] = p.command as string[];
		const child = spawn(command, args, { cwd: p.cwd, env, stdio: "pipe", detached: true });
		const kill = () => {
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};
		const processes = active ?? new Map<string, Running>();
		this.#active.set(client, processes);
		processes.set(handle, { child, stdin: p.streamStdin === true, kill });
		let timer: ReturnType<typeof setTimeout> | undefined;
		let started = false;
		const output = {
			stdout: { bytes: 0, chunks: [] as Buffer[], capped: false },
			stderr: { bytes: 0, chunks: [] as Buffer[], capped: false },
		};
		const publish = (method: string, params: Record<string, unknown>) => {
			if (started && this.#active.get(client) === processes)
				this.emit(client, { method, params: { processHandle: handle, ...params } });
		};
		for (const stream of ["stdout", "stderr"] as const)
			child[stream].on("data", (chunk: Buffer) => {
				const out = output[stream];
				const remaining = Math.max(0, Math.min(cap as number, 8 * 1024 * 1024) - out.bytes);
				const bytes = chunk.subarray(0, remaining);
				out.bytes += bytes.length;
				const capped = chunk.length > bytes.length;
				if (p.streamStdoutStderr === true) {
					if (bytes.length || (capped && !out.capped))
						publish("process/outputDelta", { stream, deltaBase64: bytes.toString("base64"), capReached: capped });
				} else if (bytes.length) out.chunks.push(bytes);
				out.capped ||= capped;
				// A request to disable the capture cap still cannot exhaust host memory.
				// Terminate on the host hard limit and report the real killed exit status.
				if (cap === Infinity && capped) kill();
			});
		child.stdin.on("error", () => {});
		child.on("close", code => {
			if (timer) clearTimeout(timer);
			publish("process/exited", {
				exitCode: code ?? 137,
				stdout: Buffer.concat(output.stdout.chunks).toString("utf8"),
				stderr: Buffer.concat(output.stderr.chunks).toString("utf8"),
				stdoutCapReached: output.stdout.capped,
				stderrCapReached: output.stderr.capped,
			});
			processes.delete(handle);
		});
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", () => {
				started = true;
				resolve();
			});
			child.once("error", () => {
				processes.delete(handle);
				reject(new ProtocolError(-32000, "Unable to start process"));
			});
		});
		if (p.streamStdin !== true) child.stdin.end();
		if (timeout !== null) {
			timer = setTimeout(kill, timeout as number);
			timer.unref();
		}
		return {};
	}
}
