import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const errorCode = (error: unknown) => (error as { code?: string })?.code;
function cancelled(signal?: AbortSignal) {
	if (signal?.aborted) throw new Error("Person profile operation cancelled");
}
/** Shared private persistence mechanics for separate person and machine schemas. */
export class PrivateProfileStore<T extends { revision: number; updatedAt?: string }> {
	constructor(
		readonly path: string,
		private readonly empty: () => T,
		private readonly validate: (value: unknown) => void,
		private readonly prepare: (value: T) => void,
	) {}
	async get(): Promise<T> {
		try {
			const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const stats = await file.stat();
				if (
					!stats.isFile() ||
					stats.size > 1024 * 1024 ||
					(stats.mode & 0o077) !== 0 ||
					(process.getuid && stats.uid !== process.getuid())
				)
					throw new Error();
				const profile: unknown = JSON.parse(await file.readFile("utf8"));
				this.validate(profile);
				return profile as T;
			} finally {
				await file.close();
			}
		} catch (error) {
			if (errorCode(error) === "ENOENT") return this.empty();
			throw new Error("Invalid person profile storage");
		}
	}
	async mutate(
		change: (profile: T) => void,
		revision?: number,
		signal?: AbortSignal,
		canCommit: () => boolean = () => true,
	): Promise<T> {
		cancelled(signal);
		const dir = dirname(this.path),
			lock = `${this.path}.lock`;
		try {
			await mkdir(dir, { recursive: true, mode: 0o700 });
			const stats = await lstat(dir);
			if (!stats.isDirectory() || stats.isSymbolicLink() || (process.getuid && stats.uid !== process.getuid()))
				throw new Error();
			await chmod(dir, 0o700);
		} catch {
			throw new Error("Invalid person profile directory");
		}
		let acquired = false;
		const deadline = Date.now() + 10000;
		while (!acquired) {
			cancelled(signal);
			try {
				await mkdir(lock, { mode: 0o700 });
				acquired = true;
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw new Error("Person profile lock unavailable");
				if (Date.now() >= deadline) throw new Error("Person profile busy; lock requires owner recovery");
				await Bun.sleep(20);
			}
		}
		let temp: string | undefined;
		const commit = async (): Promise<T> => {
			const owner = await open(join(lock, "owner.json"), "wx", 0o600);
			try {
				await owner.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
			} finally {
				await owner.close();
			}
			cancelled(signal);
			const profile = await this.get();
			if (revision !== undefined && profile.revision !== revision)
				throw new Error("Person profile revision conflict");
			const before = JSON.stringify(profile);
			if (!canCommit()) throw new Error("Person profile operation cancelled");
			change(profile);
			if (JSON.stringify(profile) === before) return profile;
			profile.revision++;
			profile.updatedAt = new Date().toISOString();
			this.prepare(profile);
			this.validate(profile);
			const serialized = JSON.stringify(profile);
			if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error("Invalid person profile size");
			temp = join(dir, `.person-profile-${crypto.randomUUID()}.tmp`);
			const file = await open(temp, "wx", 0o600);
			try {
				await file.writeFile(serialized);
				await file.sync();
			} finally {
				await file.close();
			}
			cancelled(signal);
			if (!canCommit()) throw new Error("Person profile operation cancelled");
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
			failure =
				error instanceof Error && /^(?:Person profile|Invalid person profile)/.test(error.message)
					? error
					: new Error("Person profile persistence unavailable");
		} finally {
			try {
				if (temp) await rm(temp, { force: true });
				await rm(lock, { recursive: true });
			} catch {
				failure ??= new Error("Person profile lock cleanup unavailable");
			}
		}
		if (failure) throw failure;
		if (!result) throw new Error("Person profile persistence unavailable");
		return result;
	}
}
