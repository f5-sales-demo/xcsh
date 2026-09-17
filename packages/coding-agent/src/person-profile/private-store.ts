import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ProfileStoreErrorCode =
	| "unsupported_format"
	| "insecure_permissions"
	| "invalid_shape"
	| "ownership_mismatch"
	| "lock_busy"
	| "persistence_unavailable";
export type ProfileDomain = "person" | "computer";
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

export class ProfileStoreError extends Error {
	constructor(
		readonly code: ProfileStoreErrorCode,
		readonly domain: ProfileDomain,
	) {
		super(`${domain} profile storage ${code}; run xcsh profile reset ${domain} --yes`);
		this.name = "ProfileStoreError";
	}
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
			if ((parsed as { schemaVersion?: unknown }).schemaVersion !== 1) throw this.#failure("unsupported_format");
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
	async #acquireLock(signal?: AbortSignal): Promise<string> {
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
		for (;;) {
			cancelled(this.domain, signal);
			try {
				await mkdir(lock, { mode: 0o700 });
				return lock;
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw this.#failure("persistence_unavailable");
				if (Date.now() >= deadline) throw this.#failure("lock_busy");
				await Bun.sleep(20);
			}
		}
	}
	async acquireResetLease(signal?: AbortSignal): Promise<ProfileResetLease> {
		const lock = await this.#acquireLock(signal);
		let released = false;
		const inspect = async () => {
			if (released) throw this.#failure("lock_busy");
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
				await unlink(this.path);
				return true;
			},
			release: async () => {
				if (released) return;
				await rm(lock, { recursive: true });
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
		const lock = await this.#acquireLock(signal);
		let temp: string | undefined;
		const commit = async (): Promise<T> => {
			const owner = await open(join(lock, "owner.json"), "wx", 0o600);
			try {
				await owner.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
			} finally {
				await owner.close();
			}
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
				await rm(lock, { recursive: true });
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
