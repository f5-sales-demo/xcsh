import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readlink, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_KINDS = ["supervisor", "host"] as const;
const executableDigestCache = new Map<
	string,
	{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; digest: string }
>();
const executableDigestInFlight = new Map<string, Promise<string>>();
export type ProcessKind = (typeof PROCESS_KINDS)[number];

export interface ProcessIdentity {
	pid: number;
	startTime: string;
	executablePath: string;
	executableSha256: string;
	generation: number;
}

export interface LifecycleSnapshot {
	generation: number;
	restartCount: number;
	supervisorState: "stopped" | "starting" | "running" | "degraded";
	hostState: "stopped" | "starting" | "running" | "unhealthy";
	startupManager: "systemd-user" | "process" | "none";
	degradedReason: string | null;
}

const runtimeFile = (kind: ProcessKind) => (kind === "host" ? "host-process.json" : "supervisor.json");

function validIdentity(value: unknown): value is ProcessIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Partial<ProcessIdentity>;
	return (
		Number.isSafeInteger(record.pid) &&
		(record.pid ?? 0) > 0 &&
		typeof record.startTime === "string" &&
		record.startTime.length > 0 &&
		typeof record.executablePath === "string" &&
		record.executablePath.startsWith("/") &&
		typeof record.executableSha256 === "string" &&
		/^[a-f0-9]{64}$/.test(record.executableSha256) &&
		Number.isSafeInteger(record.generation) &&
		(record.generation ?? -1) >= 0
	);
}

function validSnapshot(value: unknown): value is LifecycleSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const state = value as Partial<LifecycleSnapshot>;
	return (
		Number.isSafeInteger(state.generation) &&
		(state.generation ?? -1) >= 0 &&
		Number.isSafeInteger(state.restartCount) &&
		(state.restartCount ?? -1) >= 0 &&
		["stopped", "starting", "running", "degraded"].includes(String(state.supervisorState)) &&
		["stopped", "starting", "running", "unhealthy"].includes(String(state.hostState)) &&
		["systemd-user", "process", "none"].includes(String(state.startupManager)) &&
		(state.degradedReason === null || typeof state.degradedReason === "string")
	);
}

async function removeOwnedRegularFile(path: string): Promise<boolean> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid?.() || entry.nlink !== 1)
			return false;
		await unlink(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
}

async function atomicJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${crypto.randomUUID()}`;
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(value)}\n`);
		await file.sync();
	} finally {
		await file.close();
	}
	await rename(temporary, path);
	await chmod(path, 0o600);
}

export class LifecycleStore {
	constructor(readonly root: string) {}
	async prepare(): Promise<void> {
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		await chmod(this.root, 0o700);
	}
	path(kind: ProcessKind): string {
		return join(this.root, runtimeFile(kind));
	}
	async writeRuntime(kind: ProcessKind, record: ProcessIdentity): Promise<void> {
		if (!validIdentity(record)) throw new Error("Invalid remote process identity");
		await this.prepare();
		await atomicJson(this.path(kind), record);
	}
	async readRuntime(kind: ProcessKind): Promise<ProcessIdentity | undefined> {
		const path = this.path(kind);
		try {
			const entry = await lstat(path);
			if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()) return undefined;
			const value = JSON.parse(await readFile(path, "utf8"));
			if (validIdentity(value)) return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			if (!(error instanceof SyntaxError)) throw error;
		}
		await removeOwnedRegularFile(path);
		return undefined;
	}
	async removeRuntime(kind: ProcessKind, expected?: ProcessIdentity): Promise<boolean> {
		if (expected) {
			const current = await this.readRuntime(kind);
			if (!current || !matchesProcessIdentity(current, expected)) return false;
		}
		return removeOwnedRegularFile(this.path(kind));
	}
	async writeSnapshot(snapshot: LifecycleSnapshot): Promise<void> {
		if (!validSnapshot(snapshot)) throw new Error("Invalid remote lifecycle state");
		await this.prepare();
		await atomicJson(join(this.root, "lifecycle.json"), snapshot);
	}
	async readSnapshot(): Promise<LifecycleSnapshot | undefined> {
		const path = join(this.root, "lifecycle.json");
		try {
			const entry = await lstat(path);
			if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()) return undefined;
			const value = JSON.parse(await readFile(path, "utf8"));
			if (validSnapshot(value)) return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			if (!(error instanceof SyntaxError)) throw error;
		}
		await removeOwnedRegularFile(path);
		return undefined;
	}
	async transitionSnapshot<T>(next: LifecycleSnapshot, operation: () => Promise<T>): Promise<T> {
		const previous = await this.readSnapshot();
		await this.writeSnapshot(next);
		try {
			return await operation();
		} catch (error) {
			if (previous) await this.writeSnapshot(previous);
			else await removeOwnedRegularFile(join(this.root, "lifecycle.json"));
			throw error;
		}
	}
}

export function matchesProcessIdentity(expected: ProcessIdentity, actual: ProcessIdentity | undefined): boolean {
	return (
		actual !== undefined &&
		expected.pid === actual.pid &&
		expected.startTime === actual.startTime &&
		expected.executablePath === actual.executablePath &&
		expected.executableSha256 === actual.executableSha256 &&
		expected.generation === actual.generation
	);
}

async function executableForPid(pid: number): Promise<string> {
	if (process.platform === "linux") return realpath(await readlink(`/proc/${pid}/exe`));
	if (pid === process.pid) return realpath(process.execPath);
	const { stdout } = await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)]);
	return realpath(stdout.trim());
}

async function processStartTime(pid: number): Promise<string> {
	if (process.platform === "linux") {
		const value = await readFile(`/proc/${pid}/stat`, "utf8");
		const close = value.lastIndexOf(")");
		const fields = value.slice(close + 2).split(" ");
		const started = fields[19];
		if (!started) throw new Error("Unable to read process start time");
		return started;
	}
	const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)]);
	const started = stdout.trim();
	if (!started) throw new Error("Unable to read process start time");
	return started;
}

async function sha256File(path: string): Promise<string> {
	const metadata = await stat(path);
	const cached = executableDigestCache.get(path);
	if (
		cached &&
		cached.dev === metadata.dev &&
		cached.ino === metadata.ino &&
		cached.size === metadata.size &&
		cached.mtimeMs === metadata.mtimeMs &&
		cached.ctimeMs === metadata.ctimeMs
	)
		return cached.digest;
	const key = `${path}:${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
	const pending = executableDigestInFlight.get(key);
	if (pending) return pending;
	const digest = (async () => {
		const value = createHash("sha256")
			.update(await readFile(path))
			.digest("hex");
		executableDigestCache.set(path, {
			dev: metadata.dev,
			ino: metadata.ino,
			size: metadata.size,
			mtimeMs: metadata.mtimeMs,
			ctimeMs: metadata.ctimeMs,
			digest: value,
		});
		return value;
	})();
	executableDigestInFlight.set(key, digest);
	try {
		return await digest;
	} finally {
		executableDigestInFlight.delete(key);
	}
}

export async function inspectProcess(pid: number, generation: number): Promise<ProcessIdentity | undefined> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
	try {
		process.kill(pid, 0);
		const executablePath = await executableForPid(pid);
		return {
			pid,
			startTime: await processStartTime(pid),
			executablePath,
			executableSha256: await sha256File(executablePath),
			generation,
		};
	} catch {
		return undefined;
	}
}

export async function signalVerifiedProcess(
	record: ProcessIdentity | undefined,
	signal: NodeJS.Signals,
	inspect: typeof inspectProcess = inspectProcess,
	send: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): Promise<boolean> {
	if (!record) return false;
	const actual = await inspect(record.pid, record.generation);
	if (!matchesProcessIdentity(record, actual)) return false;
	send(record.pid, signal);
	return true;
}

async function readLockOwner(path: string): Promise<ProcessIdentity | undefined> {
	try {
		const value = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
		return validIdentity(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export async function withLifecycleLock<T>(root: string, operation: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	const path = join(root, "lifecycle.lock");
	const deadline = Date.now() + timeoutMs;
	const owner = await inspectProcess(process.pid, 0);
	if (!owner) throw new Error("Unable to identify lifecycle lock owner");
	for (;;) {
		try {
			await mkdir(path, { mode: 0o700 });
			await atomicJson(join(path, "owner.json"), owner);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readLockOwner(path);
			const alive = existing ? await inspectProcess(existing.pid, existing.generation) : undefined;
			if (existing && !matchesProcessIdentity(existing, alive)) {
				const entry = await lstat(path);
				if (!entry.isDirectory() || entry.uid !== process.getuid?.())
					throw new Error("Lifecycle lock is not owned");
				await removeOwnedRegularFile(join(path, "owner.json"));
				await rmdir(path).catch(() => {});
				continue;
			}
			if (!existing) {
				const entry = await stat(path).catch(error => {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
					throw error;
				});
				if (!entry) continue;
				if (Date.now() - entry.mtimeMs > 2_000 && entry.uid === process.getuid?.()) {
					if (!(await removeOwnedRegularFile(join(path, "owner.json"))))
						throw new Error("Lifecycle lock owner record is not owned");
					await rmdir(path).catch(() => {});
					continue;
				}
			}
			if (Date.now() >= deadline) throw new Error("Timed out waiting for remote lifecycle lock");
			await Bun.sleep(10);
		}
	}
	try {
		return await operation();
	} finally {
		const current = await readLockOwner(path);
		if (current && matchesProcessIdentity(owner, current)) {
			await removeOwnedRegularFile(join(path, "owner.json"));
			await rmdir(path).catch(() => {});
		}
	}
}

export class CrashLoopBreaker {
	#failures: number[] = [];
	degradedReason: string | null = null;
	constructor(
		private readonly now: () => number = Date.now,
		private readonly limit = 5,
		private readonly windowMs = 5 * 60_000,
	) {}
	get isOpen(): boolean {
		return this.degradedReason !== null;
	}
	recordFailure(reason: string): boolean {
		const current = this.now();
		this.#failures = this.#failures.filter(value => current - value <= this.windowMs);
		this.#failures.push(current);
		if (this.#failures.length >= this.limit) this.degradedReason = reason;
		return this.isOpen;
	}
	recordHealthy(): void {
		// A healthy observation does not reset a tripped breaker. Explicit lifecycle
		// commands own reset so a flapping child cannot silently escape degraded mode.
	}
	restoreOpen(reason: string): void {
		this.degradedReason = reason;
	}
	reset(): void {
		this.#failures = [];
		this.degradedReason = null;
	}
}

export async function drainWithDeadline(
	pending: () => number,
	force: () => Promise<void>,
	timeoutMs = 60_000,
	pollMs = 25,
): Promise<"drained" | "forced"> {
	const deadline = Date.now() + timeoutMs;
	while (pending() > 0 && Date.now() < deadline) await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
	if (pending() === 0) return "drained";
	await force();
	return "forced";
}
