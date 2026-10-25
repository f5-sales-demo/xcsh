import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { LifecycleWorkerRuntime } from "../src/remote-control/lifecycle-uat-controller";

export interface LifecycleProcessRow {
	uid: number;
	pid: number;
	ppid: number;
	executable: string;
	startTime?: string;
	sha256?: string;
	argv?: string[];
	socketInodes?: string[];
}
interface WorkerRecord {
	id: string;
	workerSocket: string | null;
	workerProcess: {
		pid: number;
		startTime: string;
		executablePath: string;
		executableSha256: string;
		generation: number;
	} | null;
}
function records(value: unknown, root: string): WorkerRecord[] {
	const catalog = value as { version?: unknown; threads?: unknown } | null;
	if (catalog?.version !== 1 || !Array.isArray(catalog.threads) || catalog.threads.length > 10_000)
		throw new Error("Invalid managed worker catalog");
	const ids = new Set<string>(),
		pids = new Set<number>(),
		sockets = new Set<string>();
	return catalog.threads.map((value: unknown) => {
		const record = value as WorkerRecord;
		if (!record || typeof record.id !== "string" || !record.id || record.id.length > 256 || ids.has(record.id))
			throw new Error("Invalid managed worker catalog");
		ids.add(record.id);
		const socket = record.workerSocket,
			process = record.workerProcess;
		if (
			socket != null &&
			(typeof socket !== "string" ||
				!isAbsolute(socket) ||
				normalize(socket) !== socket ||
				!socket.startsWith(`${join(root, "workers")}/`) ||
				socket.slice(join(root, "workers").length + 1).includes("/") ||
				!socket.endsWith(".sock") ||
				sockets.has(socket))
		)
			throw new Error("Invalid managed worker catalog");
		if (socket) sockets.add(socket);
		if (
			process != null &&
			(!socket ||
				!Number.isSafeInteger(process.pid) ||
				process.pid < 1 ||
				pids.has(process.pid) ||
				typeof process.startTime !== "string" ||
				!/^\d+$/.test(process.startTime) ||
				typeof process.executablePath !== "string" ||
				!isAbsolute(process.executablePath) ||
				typeof process.executableSha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(process.executableSha256) ||
				!Number.isSafeInteger(process.generation) ||
				process.generation < 0)
		)
			throw new Error("Invalid managed worker catalog");
		if (process) pids.add(process.pid);
		return record;
	});
}
/** Catalog membership is insufficient: require exact live process and listening-FD identity. */
export function verifiedLifecycleWorkers(
	rows: readonly LifecycleProcessRow[],
	uid: number,
	candidate: { executable: string; sha256: string },
	root: string,
	catalog: unknown,
	listeningSockets: ReadonlyMap<string, string>,
): LifecycleWorkerRuntime[] {
	return records(catalog, root)
		.flatMap(record => {
			const identity = record.workerProcess;
			if (!identity || !record.workerSocket) return [];
			const process = rows.find(row => row.pid === identity.pid && row.uid === uid);
			const inode = listeningSockets.get(record.workerSocket);
			if (
				!process ||
				process.startTime !== identity.startTime ||
				process.executable !== candidate.executable ||
				process.executable !== identity.executablePath ||
				process.sha256 !== candidate.sha256 ||
				process.sha256 !== identity.executableSha256 ||
				!inode ||
				!process.socketInodes?.includes(inode) ||
				JSON.stringify(process.argv) !==
					JSON.stringify([candidate.executable, "remote-control", "worker", record.workerSocket])
			)
				return [];
			return [
				{
					threadId: record.id,
					pid: process.pid,
					startTime: identity.startTime,
					executable: process.executable,
					sha256: candidate.sha256,
					socket: record.workerSocket,
					socketInode: inode,
				},
			];
		})
		.sort((left, right) => left.threadId.localeCompare(right.threadId));
}
async function digest(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}
function listeningSockets(text: string): Map<string, string> {
	const sockets = new Map<string, string>();
	for (const line of text.split("\n").slice(1)) {
		const fields = line.trim().split(/\s+/);
		if (fields.length === 8 && fields[3] === "00010000" && fields[4] === "0001" && fields[5] === "01")
			sockets.set(fields[7], fields[6]);
	}
	return sockets;
}
/** Passive Linux inspection never attaches to or displaces the worker's IPC owner. */
export async function inspectLifecycleWorkers(
	rows: readonly LifecycleProcessRow[],
	uid: number,
	candidate: { executable: string; sha256: string },
	root: string,
): Promise<LifecycleWorkerRuntime[]> {
	const catalogPath = join(root, "sessions.json");
	let catalog: unknown;
	try {
		const metadata = await lstat(catalogPath);
		if (
			!metadata.isFile() ||
			metadata.isSymbolicLink() ||
			metadata.uid !== uid ||
			metadata.nlink !== 1 ||
			metadata.mode & 0o077 ||
			metadata.size > 8 * 1024 * 1024
		)
			throw new Error("Managed worker catalog ownership mismatch");
		catalog = JSON.parse(await readFile(catalogPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const expected = records(catalog, root);
	const workersDirectory = join(root, "workers");
	if (
		expected.some(
			record => record.workerProcess && rows.some(row => row.pid === record.workerProcess?.pid && row.uid === uid),
		)
	) {
		for (const path of [root, workersDirectory]) {
			const metadata = await lstat(path);
			if (
				!metadata.isDirectory() ||
				metadata.isSymbolicLink() ||
				metadata.uid !== uid ||
				metadata.mode & 0o077 ||
				(await realpath(path)) !== path
			)
				throw new Error("Managed worker directory ownership mismatch");
		}
	}
	const inspected: LifecycleProcessRow[] = [];
	const sockets = new Map<string, string>();
	const digests = new Map<string, Promise<string>>();
	for (const record of expected) {
		const identity = record.workerProcess;
		const row = identity ? rows.find(row => row.uid === uid && row.pid === identity.pid) : undefined;
		if (!row || !identity || !record.workerSocket) continue;
		try {
			const proc = `/proc/${row.pid}`;
			const startTime = (await readFile(join(proc, "stat"), "utf8")).split(") ").at(-1)!.split(" ")[19];
			const executable = await readlink(join(proc, "exe"));
			const argv = (await readFile(join(proc, "cmdline"))).toString().split("\0").filter(Boolean);
			const metadata = await stat(join(proc, "exe"));
			const key = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
			if (!digests.has(key)) digests.set(key, digest(join(proc, "exe")));
			const sha256 = await digests.get(key)!;
			const socket = await lstat(record.workerSocket);
			if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== uid || socket.mode & 0o077) continue;
			const net = listeningSockets(await readFile(join(proc, "net/unix"), "utf8"));
			const inode = net.get(record.workerSocket);
			if (inode) sockets.set(record.workerSocket, inode);
			const socketInodes = (
				await Promise.all(
					(await readdir(join(proc, "fd"))).map(name => readlink(join(proc, "fd", name)).catch(() => "")),
				)
			).flatMap(link => (/^socket:\[\d+\]$/.test(link) ? [link.slice(8, -1)] : []));
			// Recheck after reads so a recycled PID or exec cannot inherit the allowlist entry.
			const after = (await readFile(join(proc, "stat"), "utf8")).split(") ").at(-1)!.split(" ")[19];
			if (after === startTime && (await readlink(join(proc, "exe"))) === executable)
				inspected.push({ ...row, executable, startTime, sha256, argv, socketInodes });
		} catch (error) {
			if (!["ENOENT", "ESRCH", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
		}
	}
	return verifiedLifecycleWorkers(inspected, uid, candidate, root, catalog, sockets);
}
