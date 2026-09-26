import { type ChildProcess, execFile } from "node:child_process";
import { isAbsolute, normalize } from "node:path";
import { type Notification, ProtocolError } from "./session";

type Result = { exitCode: number; stdout: string; stderr: string };
const PHONE_COMMAND_WRAPPER = `printf '\\0'; exec "$@"`;
const PHONE_BASH_COMMAND = ["/bin/bash", "--noprofile", "--norc", "-c", "--", PHONE_COMMAND_WRAPPER] as const;

function isPrintOnlyScript(script: string): boolean {
	if (!/^printf[ \t]+/.test(script) || Buffer.byteLength(script) > 256) return false;
	let quote: "'" | '"' | null = null;
	for (let index = 0; index < script.length; index++) {
		const char = script[index];
		if (char === "\0" || char === "\r" || char === "\n" || char === "`") return false;
		if (quote === "'") {
			if (char === "'") quote = null;
			continue;
		}
		if (char === "\\") {
			index++;
			continue;
		}
		if (char === "'" && quote === null) {
			quote = "'";
			continue;
		}
		if (char === '"') {
			quote = quote === '"' ? null : '"';
			continue;
		}
		if (char === "$") {
			if (quote !== '"' || script[index + 1] !== "@") return false;
			index++;
			continue;
		}
		if (quote === null && ";|&<>(){}".includes(char)) return false;
	}
	return quote === null;
}

/**
 * Standalone read-only shell probes run in a read-only, network-isolated Linux
 * sandbox. A print-only probe can also run directly because it cannot execute
 * any command supplied in its argv.
 */
export class RemoteCommandExec {
	#active = new Map<string, Map<string, ChildProcess>>();
	constructor(private readonly emit: (client: string, event: Notification) => void) {}

	close(client?: string): void {
		for (const [key, commands] of this.#active) {
			if (client !== undefined && key !== client) continue;
			this.#active.delete(key);
			for (const child of commands.values()) child.kill("SIGKILL");
		}
	}

	execute(client: string, p: Record<string, unknown>, allowedCwd: string): Promise<Result> {
		const command = p.command;
		const policy = p.sandboxPolicy;
		const readOnly =
			policy != null &&
			typeof policy === "object" &&
			!Array.isArray(policy) &&
			(policy as Record<string, unknown>).type === "readOnly";
		const workspaceWrite =
			policy != null &&
			typeof policy === "object" &&
			!Array.isArray(policy) &&
			(policy as Record<string, unknown>).type === "workspaceWrite";
		const readOnlyCommand =
			Array.isArray(command) &&
			["/bin/sh", "sh"].includes(command[0]) &&
			command[1] === "-c" &&
			typeof command[2] === "string" &&
			(isPrintOnlyScript(command[2]) || command[2] === PHONE_COMMAND_WRAPPER);
		const workspaceCommand =
			Array.isArray(command) &&
			PHONE_BASH_COMMAND.every((arg, index) => command[index] === arg) &&
			command.length >= 10 &&
			command[7] === "/bin/bash" &&
			command[8] === "-lc" &&
			typeof command[9] === "string";
		if (
			!Array.isArray(command) ||
			command.length < 4 ||
			command.length > 32 ||
			command.some(arg => typeof arg !== "string" || arg.includes("\0")) ||
			JSON.stringify(command).length > 256 * 1024 ||
			!(readOnly ? readOnlyCommand : workspaceWrite && workspaceCommand) ||
			p.streamStdoutStderr !== true ||
			p.streamStdin === true ||
			p.tty === true ||
			p.size != null ||
			typeof p.processId !== "string" ||
			!p.processId ||
			p.processId.length > 256 ||
			p.timeoutMs !== 20_000 ||
			(p.outputBytesCap != null &&
				(typeof p.outputBytesCap !== "number" ||
					!Number.isSafeInteger(p.outputBytesCap) ||
					p.outputBytesCap < 0 ||
					p.outputBytesCap > 8 * 1024 * 1024)) ||
			!policy ||
			typeof policy !== "object" ||
			Array.isArray(policy) ||
			(policy as Record<string, unknown>).networkAccess !== false ||
			(workspaceWrite &&
				(allowedCwd === "/" ||
					!Array.isArray((policy as Record<string, unknown>).writableRoots) ||
					((policy as Record<string, unknown>).writableRoots as unknown[]).length !== 0 ||
					(policy as Record<string, unknown>).excludeTmpdirEnvVar === true ||
					(policy as Record<string, unknown>).excludeSlashTmp === true)) ||
			typeof p.cwd !== "string" ||
			!isAbsolute(p.cwd) ||
			normalize(p.cwd) !== p.cwd ||
			p.cwd !== allowedCwd
		)
			throw new ProtocolError(-32602, "Unsupported standalone command");
		const env: NodeJS.ProcessEnv = {
			PATH: "/usr/bin:/bin",
			HOME: process.env.HOME ?? "/",
			LANG: process.env.LANG ?? "C.UTF-8",
			XDG_RUNTIME_DIR: `/run/user/${process.getuid?.() ?? ""}`,
		};
		if (p.env != null) {
			if (typeof p.env !== "object" || Array.isArray(p.env))
				throw new ProtocolError(-32602, "Invalid command environment");
			if (Object.keys(p.env).length > 32 || JSON.stringify(p.env).length > 8192)
				throw new ProtocolError(-32602, "Invalid command environment");
			for (const [key, value] of Object.entries(p.env)) {
				if (
					!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
					(value !== null && (typeof value !== "string" || value.includes("\0")))
				)
					throw new ProtocolError(-32602, "Unsupported command environment");
			}
		}
		const processId = p.processId;
		const outputBytesCap = p.outputBytesCap === null ? 8 * 1024 * 1024 : (p.outputBytesCap ?? 1024 * 1024);
		const sandboxed = workspaceWrite || command[2] === PHONE_COMMAND_WRAPPER;
		const workspaceInTmp = allowedCwd === "/tmp" || allowedCwd.startsWith("/tmp/");
		if (sandboxed && (process.platform !== "linux" || process.getuid?.() == null || process.getgid?.() == null))
			throw new ProtocolError(-32602, "Command sandbox is unavailable");
		const file = sandboxed ? "/usr/bin/systemd-run" : "/bin/sh";
		const args = sandboxed
			? [
					"--user",
					"--quiet",
					"--wait",
					"--pipe",
					"--collect",
					"--property=RuntimeMaxSec=20s",
					"--",
					"/usr/bin/sudo",
					"-n",
					"/usr/bin/bwrap",
					"--unshare-net",
					"--unshare-pid",
					"--ro-bind",
					"/",
					"/",
					"--tmpfs",
					"/run/user",
					...(workspaceWrite
						? [...(workspaceInTmp ? [] : ["--tmpfs", "/tmp"]), "--bind", allowedCwd, allowedCwd]
						: []),
					"--dev",
					"/dev",
					"--proc",
					"/proc",
					"--chdir",
					allowedCwd,
					"--clearenv",
					"--setenv",
					"HOME",
					env.HOME ?? "/",
					"--setenv",
					"PATH",
					env.PATH ?? "/usr/bin:/bin",
					"--setenv",
					"LANG",
					env.LANG ?? "C.UTF-8",
					...(workspaceWrite ? ["--setenv", "TMPDIR", workspaceInTmp ? allowedCwd : "/tmp"] : []),
					"--",
					"/usr/bin/setpriv",
					`--reuid=${process.getuid?.()}`,
					`--regid=${process.getgid?.()}`,
					"--clear-groups",
					"--no-new-privs",
					"--bounding-set=-all",
					...(workspaceWrite ? command : ["/bin/sh", "-c", command[2], ...command.slice(3)]),
				]
			: ["-c", command[2], ...command.slice(3)];
		const commands = this.#active.get(client) ?? new Map<string, ChildProcess>();
		if (commands.has(processId)) throw new ProtocolError(-32602, "Command process ID already active");
		if ([...this.#active.values()].reduce((count, group) => count + group.size, 0) >= 16)
			throw new ProtocolError(-32000, "Active command limit reached");
		return new Promise<Result>((resolve, reject) => {
			const child = execFile(
				file,
				args,
				{ cwd: allowedCwd, env, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, encoding: "buffer" },
				(error, stdout, stderr) => {
					commands.delete(processId);
					const connected = this.#active.get(client) === commands;
					if (!commands.size) this.#active.delete(client);
					if (!connected) return reject(new ProtocolError(-32000, "Command client disconnected"));
					for (const [stream, output] of [
						["stdout", stdout],
						["stderr", stderr],
					] as const) {
						const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output);
						if (!bytes.length) continue;
						this.emit(client, {
							method: "command/exec/outputDelta",
							params: {
								processId,
								stream,
								deltaBase64: bytes.subarray(0, outputBytesCap).toString("base64"),
								capReached: bytes.length > outputBytesCap,
							},
						});
					}
					resolve({
						exitCode:
							typeof (error as NodeJS.ErrnoException | null)?.code === "number"
								? (error as unknown as { code: number }).code
								: error
									? 137
									: 0,
						stdout: "",
						stderr: "",
					});
				},
			);
			commands.set(processId, child);
			this.#active.set(client, commands);
		});
	}
}
