import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, link as hardlink, lstat, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import type { ArchiveInstall } from "../integrations/types";
import { exposeExecutable } from "./host";

export function safeArchivePath(name: string): string {
	if (
		!name ||
		name.includes("\\") ||
		name.includes("\0") ||
		name.startsWith("/") ||
		/^[a-z]:/i.test(name) ||
		name.split("/").includes("..")
	)
		throw new Error("Unsafe archive extraction path");
	const normalized = posix.normalize(name);
	if (normalized === "." || normalized.startsWith("../")) throw new Error("Unsafe archive extraction path");
	return normalized.replace(/\/$/, "");
}
async function unpack(file: string, stage: string, baseDir: string, signal: AbortSignal) {
	const archive = extract();
	const pendingLinks: { path: string; target: string; hard: boolean }[] = [];
	const seen = new Set<string>();
	let total = 0;
	let entries = 0;
	archive.on("entry", (header, stream, next) => {
		stream.on("error", error => archive.destroy(error));
		void (async () => {
			signal.throwIfAborted();
			const name = safeArchivePath(header.name);
			if ((name !== baseDir && !name.startsWith(`${baseDir}/`)) || seen.has(name) || ++entries > 100_000)
				throw new Error("Unsafe or duplicate archive extraction path");
			seen.add(name);
			total += header.size ?? 0;
			if (total > 2 * 1024 ** 3) throw new Error("Archive extraction size limit exceeded");
			const path = join(stage, name);
			if (header.type === "directory") {
				await mkdir(path, { recursive: true, mode: 0o700 });
				stream.resume();
			} else if (header.type === "file" || header.type === "contiguous-file") {
				await mkdir(dirname(path), { recursive: true, mode: 0o700 });
				await pipeline(stream, createWriteStream(path, { flags: "wx", mode: (header.mode ?? 0o600) & 0o777 }), {
					signal,
				});
			} else if (header.type === "symlink" || header.type === "link") {
				const target = header.linkname ?? "";
				if (!target || isAbsolute(target) || target.includes("\\") || target.includes("\0"))
					throw new Error("Unsafe archive link");
				const resolved =
					header.type === "link"
						? safeArchivePath(target)
						: posix.normalize(posix.join(posix.dirname(name), target));
				if (!resolved.startsWith(`${baseDir}/`) && resolved !== baseDir)
					throw new Error("Unsafe archive link target");
				pendingLinks.push({
					path,
					target: header.type === "link" ? join(stage, resolved) : target,
					hard: header.type === "link",
				});
				stream.resume();
			} else throw new Error("Unsupported archive entry type");
		})().then(
			() => next(),
			error => {
				stream.destroy(error);
				archive.destroy(error);
			},
		);
	});
	await pipeline(createReadStream(file), createGunzip(), archive, { signal });
	// No deferred link may be an ancestor of any other entry, including another link.
	const relativeLinks = pendingLinks.map(item => item.path.slice(stage.length + 1));
	for (const linkPath of relativeLinks)
		if ([...seen].some(name => name.startsWith(`${linkPath}/`))) throw new Error("Unsafe archive link ancestor");
	// Create links only after extraction; no extracted file can traverse a symlink.
	for (const item of pendingLinks) {
		signal.throwIfAborted();
		await mkdir(dirname(item.path), { recursive: true, mode: 0o700 });
		if (item.hard) {
			if (!(await lstat(item.target)).isFile()) throw new Error("Unsafe archive hard link");
			await hardlink(item.target, item.path);
		} else await symlink(item.target, item.path);
	}
}
export async function installArchive(
	archive: ArchiveInstall,
	signal?: AbortSignal,
	timeoutMs = 600_000,
): Promise<void> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	if (
		!isAbsolute(archive.destination) ||
		!isAbsolute(archive.link) ||
		!/^[a-f0-9]{64}$/.test(archive.sha256) ||
		new URL(archive.url).protocol !== "https:"
	)
		throw new Error("Invalid archive installation plan");
	const baseDir = safeArchivePath(archive.baseDir);
	const relativeExecutable = safeArchivePath(archive.executable);
	if (baseDir.includes("/")) throw new Error("Invalid archive base directory");
	combined.throwIfAborted();
	await mkdir(dirname(archive.destination), { recursive: true, mode: 0o700 });
	const stage = await mkdtemp(join(dirname(archive.destination), ".xcsh-stage-"));
	let ownedDestination = false;
	let ownedLink = false;
	try {
		const response = await fetch(archive.url, {
			signal: combined,
			redirect: "error",
			headers: { "User-Agent": "curl/8.5.0 xcsh-software" },
		});
		if (!response.ok || !response.body) throw new Error("Archive download failed");
		const file = join(stage, "download.tar.gz");
		const hash = createHash("sha256");
		let size = 0;
		const reader = response.body.getReader();
		const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
		try {
			await pipeline(
				Readable.from(
					(async function* () {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							size += value.length;
							if (size > 1024 ** 3) throw new Error("Archive download size limit exceeded");
							hash.update(value);
							yield value;
						}
					})(),
				),
				output,
				{ signal: combined },
			);
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		if (hash.digest("hex") !== archive.sha256) throw new Error("Archive SHA-256 checksum mismatch");
		await unpack(file, stage, baseDir, combined);
		const executable = join(stage, baseDir, relativeExecutable);
		if (!(await lstat(executable)).isFile())
			throw new Error("Archive executable is missing or is not a regular file");
		await chmod(executable, 0o755);
		const child = Bun.spawn([executable, ...archive.versionArgs], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			signal: AbortSignal.any([combined, AbortSignal.timeout(15_000)]),
			killSignal: "SIGKILL",
		});
		const version = await new Response(child.stdout).text();
		if ((await child.exited) !== 0 || !version.includes(archive.version))
			throw new Error("Archive executable version verification failed");
		combined.throwIfAborted();
		// Exclusive reservation prevents a competing or unrelated destination from being replaced.
		await mkdir(archive.destination, { mode: 0o700 });
		ownedDestination = true;
		await rename(join(stage, baseDir), join(archive.destination, baseDir));
		await mkdir(dirname(archive.link), { recursive: true, mode: 0o700 });
		combined.throwIfAborted();
		const installed = join(archive.destination, baseDir, relativeExecutable);
		await symlink(installed, archive.link);
		ownedLink = true;
		exposeExecutable(installed);
	} catch (error) {
		if (ownedLink) await rm(archive.link, { force: true });
		if (ownedDestination) await rm(archive.destination, { recursive: true, force: true });
		if (combined.aborted)
			throw new Error(signal?.aborted ? "Integration setup cancelled" : "Archive installation timed out");
		throw error;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
