import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, readlink, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { renameExclusive, renameExclusiveAt } from "@f5-sales-demo/pi-natives";

import { type ProfileLockRecoveryReview, recoverProfileLock, reviewProfileLockRecovery } from "./lock-recovery";

import { type ProfileDomain, ProfileStoreError, type ProfileStoreErrorCode } from "./profile-store-error";

export type { ProfileDomain, ProfileStoreErrorCode } from "./profile-store-error";
export { ProfileStoreError } from "./profile-store-error";
export interface ProfileStoreStatus {
	status: "missing" | "ready" | "invalid";
	schemaVersion?: number;
	permissions?: { file?: string; directory?: string };
	reason?: ProfileStoreErrorCode;
	remedy?: string;
}

export interface ProfileResetLease {
	readonly path: string;
	inspect(): Promise<boolean>;
	remove(signal?: AbortSignal): Promise<boolean>;
	release(): Promise<void>;
}

export interface ProfileResetTarget {
	readonly path: string;
	acquireResetLease(signal?: AbortSignal): Promise<ProfileResetLease>;
}

const errorCode = (error: unknown) => (error as { code?: string })?.code;
const mode = (value: number) => (value & 0o777).toString(8).padStart(4, "0");
function cancelled(domain: ProfileDomain, signal?: AbortSignal) {
	if (signal?.aborted) throw new Error(`${domain} profile operation cancelled`);
}
/** Shared private persistence mechanics for separate person and machine schemas. */
export class PrivateProfileStore<T extends { schemaVersion: number; revision: number; updatedAt?: string }> {
	constructor(
		readonly path: string,
		private readonly empty: () => T,
		private readonly validate: (value: unknown) => void,
		private readonly prepare: (value: T) => void,
		readonly domain: ProfileDomain = "person",
		private readonly lockTimeoutMs = 10000,
		private readonly schemaVersion = 1,
	) {}
	#failure(code: ProfileStoreErrorCode): ProfileStoreError {
		return new ProfileStoreError(code, this.domain);
	}
	async #read(): Promise<T | undefined> {
		let file: Awaited<ReturnType<typeof open>>;
		try {
			file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (error) {
			if (errorCode(error) === "ENOENT") return undefined;
			if (errorCode(error) === "ELOOP") throw this.#failure("invalid_shape");
			throw this.#failure("persistence_unavailable");
		}
		try {
			const directoryStats = await lstat(dirname(this.path));
			if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw this.#failure("invalid_shape");
			if (process.getuid && directoryStats.uid !== process.getuid()) throw this.#failure("ownership_mismatch");
			if ((directoryStats.mode & 0o077) !== 0) throw this.#failure("insecure_permissions");
			const stats = await file.stat();
			if (!stats.isFile() || stats.size > 1024 * 1024) throw this.#failure("invalid_shape");
			if (process.getuid && stats.uid !== process.getuid()) throw this.#failure("ownership_mismatch");
			if ((stats.mode & 0o077) !== 0) throw this.#failure("insecure_permissions");
			let parsed: unknown;
			try {
				parsed = JSON.parse(await file.readFile("utf8"));
			} catch {
				throw this.#failure("invalid_shape");
			}
			if (!parsed || typeof parsed !== "object" || !("schemaVersion" in parsed))
				throw this.#failure("unsupported_format");
			if ((parsed as { schemaVersion?: unknown }).schemaVersion !== this.schemaVersion)
				throw this.#failure("unsupported_format");
			try {
				this.validate(parsed);
			} catch {
				throw this.#failure("invalid_shape");
			}
			return parsed as T;
		} finally {
			await file.close();
		}
	}
	async get(): Promise<T> {
		return (await this.#read()) ?? this.empty();
	}
	async status(): Promise<ProfileStoreStatus> {
		const permissions: NonNullable<ProfileStoreStatus["permissions"]> = {};
		try {
			try {
				const directoryStats = await lstat(dirname(this.path));
				permissions.directory = mode(directoryStats.mode);
				if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw this.#failure("invalid_shape");
				if (process.getuid && directoryStats.uid !== process.getuid()) throw this.#failure("ownership_mismatch");
				if ((directoryStats.mode & 0o077) !== 0) throw this.#failure("insecure_permissions");
			} catch (error) {
				if (errorCode(error) !== "ENOENT" || error instanceof ProfileStoreError) throw error;
			}
			try {
				permissions.file = mode((await lstat(this.path)).mode);
			} catch (error) {
				if (errorCode(error) === "ENOENT")
					return { status: "missing", ...(Object.keys(permissions).length ? { permissions } : {}) };
				throw error;
			}
			const profile = await this.#read();
			return { status: "ready", schemaVersion: profile?.schemaVersion, permissions };
		} catch (error) {
			const reason = error instanceof ProfileStoreError ? error.code : "persistence_unavailable";
			return {
				status: "invalid",
				permissions,
				reason,
				remedy: `xcsh profile reset ${this.domain} --yes`,
			};
		}
	}
	async #publishLockOwner(
		prepared: string,
		lock: string,
		operation: "mutate" | "reset",
		deadline: number,
		signal?: AbortSignal,
	) {
		let activePath = prepared;
		const lockStats = await lstat(prepared);
		const parent = dirname(lock);
		const parentStats = await lstat(parent);
		const sameParent = async () => {
			const current = await lstat(parent);
			if (
				!current.isDirectory() ||
				current.isSymbolicLink() ||
				current.dev !== parentStats.dev ||
				current.ino !== parentStats.ino ||
				current.uid !== parentStats.uid ||
				(current.mode & 0o777) !== 0o700
			)
				throw this.#failure("ownership_mismatch");
		};
		const sameDirectory = async () => {
			await sameParent();
			const current = await lstat(activePath);
			if (
				!current.isDirectory() ||
				current.isSymbolicLink() ||
				current.dev !== lockStats.dev ||
				current.ino !== lockStats.ino ||
				current.uid !== lockStats.uid ||
				(current.mode & 0o777) !== 0o700
			)
				throw this.#failure("ownership_mismatch");
		};
		const readNamespaces = async () => {
			try {
				const [pid, mount, user] = await Promise.all([
					readlink("/proc/self/ns/pid"),
					readlink("/proc/self/ns/mnt"),
					readlink("/proc/self/ns/user"),
				]);
				if (
					!/^pid:\[[1-9]\d*\]$/.test(pid) ||
					!/^mnt:\[[1-9]\d*\]$/.test(mount) ||
					!/^user:\[[1-9]\d*\]$/.test(user)
				)
					throw this.#failure("persistence_unavailable");
				return { pid, mount, user };
			} catch {
				throw this.#failure("persistence_unavailable");
			}
		};
		const readOriginalProcess = async () => {
			try {
				const processStat = await readFile("/proc/self/stat", "utf8");
				const commandEnd = processStat.lastIndexOf(")");
				const fields = processStat
					.slice(commandEnd + 2)
					.trim()
					.split(/\s+/);
				const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
				const machineId = (await readFile("/etc/machine-id", "utf8")).trim();
				if (
					processStat.match(/^([1-9]\d*) \(/)?.[1] !== String(process.pid) ||
					commandEnd <= processStat.indexOf("(") ||
					processStat[commandEnd + 1] !== " " ||
					!/^[RSDZTWtXxKPI]$/.test(fields[0] ?? "") ||
					!/^[1-9]\d*$/.test(fields[19] ?? "") ||
					!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(bootId) ||
					!/^[0-9a-f]{32}$/.test(machineId)
				)
					throw this.#failure("persistence_unavailable");
				return {
					platform: process.platform,
					pid: process.pid,
					bootId,
					startTicks: fields[19]!,
					machineIdSha256: createHash("sha256").update(machineId).digest("hex"),
					namespaces: await readNamespaces(),
				};
			} catch {
				throw this.#failure("persistence_unavailable");
			}
		};
		const originalProcess = await readOriginalProcess();
		// Unavailable process identity never grants recovery authority. Existing ambiguous locks remain untouched.
		let ownerPath = join(activePath, "owner.json");
		const leaseId = crypto.randomUUID();
		await sameDirectory();
		const owner = await open(ownerPath, "wx", 0o600);
		let ownerBytes: string;
		let ownerStats: Awaited<ReturnType<typeof owner.stat>>;
		try {
			// Read exact integer identities before writing, and bind the original
			// owner inode. Copied ownership cannot authorize recovery of a new lock.
			const originalOwner = await owner.stat({ bigint: true });
			const [originalParent, originalDirectory] = await Promise.all([
				lstat(parent, { bigint: true }),
				lstat(prepared, { bigint: true }),
			]);
			const identity = (stats: typeof originalOwner) => ({
				device: String(stats.dev),
				inode: String(stats.ino),
				birthtimeNs: String(stats.birthtimeNs),
				uid: Number(stats.uid),
			});
			if (
				originalParent.birthtimeNs <= 0n ||
				originalDirectory.birthtimeNs <= 0n ||
				originalOwner.birthtimeNs <= 0n ||
				!originalOwner.isFile() ||
				originalOwner.nlink !== 1n ||
				(originalOwner.mode & 0o777n) !== 0o600n ||
				!Number.isSafeInteger(lockStats.dev) ||
				!Number.isSafeInteger(lockStats.ino) ||
				!Number.isSafeInteger(parentStats.dev) ||
				!Number.isSafeInteger(parentStats.ino) ||
				originalParent.dev !== BigInt(parentStats.dev) ||
				originalParent.ino !== BigInt(parentStats.ino) ||
				originalDirectory.dev !== BigInt(lockStats.dev) ||
				originalDirectory.ino !== BigInt(lockStats.ino) ||
				originalOwner.uid !== originalDirectory.uid ||
				originalOwner.dev !== originalDirectory.dev
			)
				throw this.#failure("ownership_mismatch");
			ownerBytes = JSON.stringify({
				schemaVersion: 1,
				leaseId,
				domain: this.domain,
				operation,
				pid: process.pid,
				createdAt: new Date().toISOString(),
				originalProcess,
				recoveryBinding: {
					schemaVersion: 2,
					parent: identity(originalParent),
					directory: identity(originalDirectory),
					owner: identity(originalOwner),
				},
			});
			await owner.writeFile(ownerBytes);
			await owner.sync();
			ownerStats = await owner.stat();
			const publishedOwner = await owner.stat({ bigint: true });
			if (publishedOwner.birthtimeNs !== originalOwner.birthtimeNs) throw this.#failure("persistence_unavailable");
		} finally {
			await owner.close();
		}
		cancelled(this.domain, signal);
		for (const path of [activePath, parent]) {
			const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		}
		const originalOwnerStats = ownerStats;
		const ownerLinks = 1;
		const readBoundOwner = async (path: string, expectedLinks: number) => {
			await sameParent();
			const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const current = await file.stat();
				if (
					!current.isFile() ||
					current.dev !== originalOwnerStats.dev ||
					current.ino !== originalOwnerStats.ino ||
					current.uid !== originalOwnerStats.uid ||
					current.size !== originalOwnerStats.size ||
					current.mtimeMs !== originalOwnerStats.mtimeMs ||
					(current.mode & 0o777) !== 0o600 ||
					current.nlink !== expectedLinks ||
					(await file.readFile("utf8")) !== ownerBytes
				)
					throw this.#failure("ownership_mismatch");
				const pathStats = await lstat(path);
				if (
					!pathStats.isFile() ||
					pathStats.isSymbolicLink() ||
					pathStats.dev !== current.dev ||
					pathStats.ino !== current.ino
				)
					throw this.#failure("ownership_mismatch");
				return current;
			} finally {
				await file.close();
			}
		};
		const syncDirectory = async (path: string) => {
			const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const current = await file.stat();
				const expected = path === activePath ? lockStats : parentStats;
				if (
					!current.isDirectory() ||
					current.dev !== expected.dev ||
					current.ino !== expected.ino ||
					current.uid !== expected.uid ||
					(current.mode & 0o777) !== 0o700
				)
					throw this.#failure("ownership_mismatch");
				await file.sync();
			} finally {
				await file.close();
			}
		};
		const verify = async () => {
			try {
				const currentProcess = await readOriginalProcess();
				const expected = originalProcess;
				if (
					currentProcess.platform !== expected.platform ||
					currentProcess.pid !== expected.pid ||
					currentProcess.bootId !== expected.bootId ||
					currentProcess.startTicks !== expected.startTicks ||
					currentProcess.machineIdSha256 !== expected.machineIdSha256 ||
					currentProcess.namespaces.pid !== expected.namespaces.pid ||
					currentProcess.namespaces.mount !== expected.namespaces.mount ||
					currentProcess.namespaces.user !== expected.namespaces.user
				)
					throw this.#failure("ownership_mismatch");
				await sameDirectory();
				const contents = await readdir(activePath);
				if (contents.length !== 1 || contents[0] !== "owner.json") throw this.#failure("ownership_mismatch");
				const current = await readBoundOwner(ownerPath, ownerLinks);
				if (current.ctimeMs !== ownerStats.ctimeMs || current.mtimeMs !== ownerStats.mtimeMs)
					throw this.#failure("ownership_mismatch");
				await sameDirectory();
			} catch {
				throw this.#failure("ownership_mismatch");
			}
		};
		await verify();
		// Retain the original parent descriptor until this single-use lease closes.
		// Path replacement cannot redirect the namespace handoff to a different parent.
		const parentHandle = await open(parent, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
		const releaseCapture = async () => {
			await verify();
			const retainedName = `.${this.domain}-profile-lock-${leaseId}.release-directory`;
			if (!renameExclusiveAt(parentHandle.fd, basename(lock), retainedName))
				throw this.#failure("ownership_mismatch");
			activePath = join(parent, retainedName);
			ownerPath = join(activePath, "owner.json");
			try {
				// renameat2 does not bind a source inode. Verify the complete captured
				// directory and owner after handoff before treating release as successful.
				await verify();
				await parentHandle.sync();
				await verify();
			} catch (failure) {
				try {
					// Preserve unexpected captures intact. Never overwrite an active contender.
					if (!renameExclusiveAt(parentHandle.fd, retainedName, basename(lock)))
						throw this.#failure("ownership_mismatch");
					activePath = lock;
					ownerPath = join(lock, "owner.json");
					await parentHandle.sync();
				} catch (restorationFailure) {
					throw new AggregateError(
						[failure, restorationFailure],
						"Original profile lock capture and complete-directory restoration failed",
						{ cause: failure },
					);
				}
				throw failure;
			}
		};
		let releaseOutcome: Promise<void> | undefined;
		const releaseOriginal = async () => {
			let failed = false;
			let failure: unknown;
			try {
				await releaseCapture();
			} catch (error) {
				failed = true;
				failure = error;
			}
			try {
				await parentHandle.close();
			} catch (closeFailure) {
				if (failed)
					throw new AggregateError(
						[failure, closeFailure],
						"Profile lock release and parent descriptor closure failed",
						{
							cause: failure,
						},
					);
				throw closeFailure;
			}
			if (failed) throw failure;
		};
		const lease = {
			verify,
			release: () => (releaseOutcome ??= releaseOriginal()),
		};
		try {
			const openedParent = await parentHandle.stat();
			if (
				!openedParent.isDirectory() ||
				openedParent.dev !== parentStats.dev ||
				openedParent.ino !== parentStats.ino ||
				openedParent.uid !== parentStats.uid ||
				(openedParent.mode & 0o777) !== 0o700
			)
				throw this.#failure("ownership_mismatch");
			for (;;) {
				cancelled(this.domain, signal);
				await verify();
				cancelled(this.domain, signal);
				// Synchronous exclusive publication cannot replace even an empty
				// historical lock. Interrupted preparations stay separately attributed.
				if (renameExclusive(prepared, lock)) {
					activePath = lock;
					ownerPath = join(lock, "owner.json");
					break;
				}
				if (Date.now() >= deadline) throw this.#failure("lock_busy");
				await Bun.sleep(20);
			}
			await syncDirectory(parent);
			await verify();
			if (signal?.aborted) {
				try {
					await lease.release();
				} catch (releaseFailure) {
					throw new AggregateError(
						[new Error(`${this.domain} profile operation cancelled`), releaseFailure],
						"Cancelled profile acquisition retained its original release failure",
					);
				}
				cancelled(this.domain, signal);
			}
			return lease;
		} catch (failure) {
			// A cancellation release already owns descriptor closure through its one promise.
			if (!releaseOutcome) {
				try {
					await parentHandle.close();
				} catch (closeFailure) {
					throw new AggregateError(
						[failure, closeFailure],
						"Profile acquisition and parent descriptor closure failed",
						{ cause: failure },
					);
				}
			}
			throw failure;
		}
	}
	async #acquireLock(operation: "mutate" | "reset", signal?: AbortSignal) {
		if (process.platform !== "linux") throw this.#failure("unsupported_platform");
		const dir = dirname(this.path);
		try {
			await mkdir(dir, { recursive: true, mode: 0o700 });
			const stats = await lstat(dir);
			if (!stats.isDirectory() || stats.isSymbolicLink()) throw this.#failure("invalid_shape");
			if (process.getuid && stats.uid !== process.getuid()) throw this.#failure("ownership_mismatch");
			await chmod(dir, 0o700);
		} catch (error) {
			if (error instanceof ProfileStoreError) throw error;
			throw this.#failure("persistence_unavailable");
		}
		const lock = `${this.path}.lock`;
		const deadline = Date.now() + this.lockTimeoutMs;
		cancelled(this.domain, signal);
		const prepared = join(dir, `.${this.domain}-profile-lock-${crypto.randomUUID()}.prepared`);
		try {
			await mkdir(prepared, { mode: 0o700 });
			cancelled(this.domain, signal);
			return await this.#publishLockOwner(prepared, lock, operation, deadline, signal);
		} catch (error) {
			// Never recursively discard partial ownership or remove a historical
			// lock. The original IO failure remains available as the private cause.
			if (error instanceof ProfileStoreError || signal?.aborted) throw error;
			throw new ProfileStoreError("persistence_unavailable", this.domain, { cause: error });
		}
	}
	async recoverLock(review: ProfileLockRecoveryReview, approvedSha256: string, signal?: AbortSignal) {
		return recoverProfileLock(this.path, this.domain, review, approvedSha256, signal);
	}
	async reviewLockRecovery() {
		return reviewProfileLockRecovery(this.path, this.domain);
	}
	async acquireResetLease(signal?: AbortSignal): Promise<ProfileResetLease> {
		const lock = await this.#acquireLock("reset", signal);
		let released = false;
		const inspect = async () => {
			if (released) throw this.#failure("lock_busy");
			await lock.verify();
			let stats: Awaited<ReturnType<typeof lstat>> | undefined;
			try {
				stats = await lstat(this.path);
			} catch (error) {
				if (errorCode(error) !== "ENOENT") throw this.#failure("persistence_unavailable");
			}
			if (!stats) return false;
			if (!stats.isFile() || stats.isSymbolicLink()) throw this.#failure("invalid_shape");
			if (process.getuid && stats.uid !== process.getuid()) throw this.#failure("ownership_mismatch");
			return true;
		};
		return {
			path: this.path,
			inspect,
			remove: async resetSignal => {
				if (!(await inspect())) return false;
				cancelled(this.domain, resetSignal);
				await lock.verify();
				await unlink(this.path);
				return true;
			},
			release: async () => {
				if (released) return;
				await lock.release();
				released = true;
			},
		};
	}
	async reset(signal?: AbortSignal): Promise<boolean> {
		return (await resetProfileTargets([this], signal)).get(this.path) ?? false;
	}
	async mutate(
		change: (profile: T) => void,
		revision?: number,
		signal?: AbortSignal,
		canCommit: () => boolean = () => true,
		isRevisionRelevant: (before: T, after: T) => boolean = () => true,
	): Promise<T> {
		cancelled(this.domain, signal);
		const dir = dirname(this.path);
		const lock = await this.#acquireLock("mutate", signal);
		let temp: string | undefined;
		const commit = async (): Promise<T> => {
			await lock.verify();
			cancelled(this.domain, signal);
			const profile = await this.get();
			if (revision !== undefined && profile.revision !== revision)
				throw new Error(`${this.domain} profile revision conflict`);
			const before = JSON.stringify(profile);
			const beforeProfile = structuredClone(profile);
			if (!canCommit()) throw new Error(`${this.domain} profile operation cancelled`);
			change(profile);
			if (JSON.stringify(profile) === before) return profile;
			if (isRevisionRelevant(beforeProfile, profile)) profile.revision++;
			profile.updatedAt = new Date().toISOString();
			this.prepare(profile);
			this.validate(profile);
			const serialized = JSON.stringify(profile);
			if (Buffer.byteLength(serialized) > 1024 * 1024) throw this.#failure("invalid_shape");
			temp = join(dir, `.${this.domain}-profile-${crypto.randomUUID()}.tmp`);
			const file = await open(temp, "wx", 0o600);
			try {
				await file.writeFile(serialized);
				await file.sync();
			} finally {
				await file.close();
			}
			cancelled(this.domain, signal);
			if (!canCommit()) throw new Error(`${this.domain} profile operation cancelled`);
			await lock.verify();
			await rename(temp, this.path);
			temp = undefined;
			const directory = await open(dir, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
			return profile;
		};
		let result: T | undefined;
		let failure: Error | undefined;
		try {
			result = await commit();
		} catch (error) {
			failure = error instanceof Error ? error : this.#failure("persistence_unavailable");
		} finally {
			try {
				if (temp) await rm(temp, { force: true });
				await lock.release();
			} catch {
				failure ??= this.#failure("persistence_unavailable");
			}
		}
		if (failure) throw failure;
		if (!result) throw this.#failure("persistence_unavailable");
		return result;
	}
}

export async function resetProfileTargets(
	targets: readonly ProfileResetTarget[],
	signal?: AbortSignal,
): Promise<Map<string, boolean>> {
	const unique = new Map(targets.map(target => [target.path, target]));
	if (unique.size !== targets.length) throw new Error("Duplicate profile reset target");
	const leases: ProfileResetLease[] = [];
	const results = new Map<string, boolean>();
	let failure: unknown;
	try {
		for (const target of [...unique.values()].sort((left, right) => left.path.localeCompare(right.path))) {
			leases.push(await target.acquireResetLease(signal));
		}
		await Promise.all(leases.map(lease => lease.inspect()));
		for (const lease of leases) results.set(lease.path, await lease.remove(signal));
	} catch (error) {
		failure = error;
	} finally {
		for (const lease of leases.reverse()) {
			try {
				await lease.release();
			} catch (error) {
				failure ??= error;
			}
		}
	}
	if (failure) throw failure;
	return results;
}
