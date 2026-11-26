import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, readdir, readFile, readlink, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { renameExclusiveAt } from "@f5-sales-demo/pi-natives";
import { type ProfileDomain, ProfileStoreError } from "./profile-store-error";

interface Identity {
	device: string;
	inode: string;
	birthtimeNs: string;
	uid: number;
}
interface Binding {
	schemaVersion: 2;
	parent: Identity;
	directory: Identity;
	owner: Identity;
}
interface OriginalProcess {
	platform: "linux";
	pid: number;
	bootId: string;
	startTicks: string;
	machineIdSha256: string;
	namespaces: { pid: string; mount: string; user: string };
}
interface Owner {
	schemaVersion: 1;
	domain: ProfileDomain;
	operation: "mutate" | "reset";
	pid: number;
	leaseId: string;
	createdAt: string;
	originalProcess: OriginalProcess;
	recoveryBinding: Binding;
}
export interface ProfileLockRecoveryReview {
	schemaVersion: 1;
	path: string;
	domain: ProfileDomain;
	observedAt: string;
	ownerSha256: string;
	binding: Binding;
	filesystemType: string;
	closure: { kind: "pid-absent" | "pid-reused" | "previous-boot"; currentBootId: string; original: OriginalProcess };
	directory: { ctimeNs: string; mtimeNs: string };
	owner: { ctimeNs: string; mtimeNs: string; size: string };
	sha256: string;
}
export class ProfileLockRecoveryError extends ProfileStoreError {
	constructor(
		domain: ProfileDomain,
		readonly reason: string,
		options?: ErrorOptions,
	) {
		super("lock_recovery_unavailable", domain, options);
		this.message = `${domain} profile lock recovery unavailable: ${reason}; retain the original lock and ownership evidence`;
	}
}
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
	typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const positive = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d*$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function identityShape(value: unknown): value is Identity {
	return (
		object(value) &&
		typeof value.device === "string" &&
		/^\d+$/.test(value.device) &&
		positive(value.inode) &&
		positive(value.birthtimeNs) &&
		Number.isSafeInteger(value.uid) &&
		Number(value.uid) >= 0
	);
}
function ownerShape(value: unknown, domain: ProfileDomain): value is Owner {
	if (
		!object(value) ||
		value.schemaVersion !== 1 ||
		value.domain !== domain ||
		!["mutate", "reset"].includes(String(value.operation)) ||
		!Number.isSafeInteger(value.pid) ||
		Number(value.pid) <= 0 ||
		!uuid(value.leaseId) ||
		typeof value.createdAt !== "string" ||
		!Number.isFinite(Date.parse(value.createdAt))
	)
		return false;
	const original = value.originalProcess;
	const binding = value.recoveryBinding;
	if (
		!object(original) ||
		original.platform !== "linux" ||
		original.pid !== value.pid ||
		!uuid(original.bootId) ||
		!positive(original.startTicks) ||
		!digest(original.machineIdSha256) ||
		!object(original.namespaces) ||
		!object(binding) ||
		binding.schemaVersion !== 2
	)
		return false;
	return (
		/^pid:\[[1-9]\d*\]$/.test(String(original.namespaces.pid)) &&
		/^mnt:\[[1-9]\d*\]$/.test(String(original.namespaces.mount)) &&
		/^user:\[[1-9]\d*\]$/.test(String(original.namespaces.user)) &&
		identityShape(binding.parent) &&
		identityShape(binding.directory) &&
		identityShape(binding.owner)
	);
}
function identity(stats: Pick<BigIntStats, "dev" | "ino" | "uid" | "birthtimeNs">) {
	return {
		device: String(stats.dev),
		inode: String(stats.ino),
		birthtimeNs: String(stats.birthtimeNs),
		uid: Number(stats.uid),
	};
}
const equalIdentity = (a: Identity, b: Identity) =>
	a.device === b.device && a.inode === b.inode && a.birthtimeNs === b.birthtimeNs && a.uid === b.uid;
function startTicks(raw: string, pid: number): string {
	const end = raw.lastIndexOf(")");
	const fields = raw
		.slice(end + 2)
		.trim()
		.split(/\s+/);
	if (
		raw.match(/^([1-9]\d*) \(/)?.[1] !== String(pid) ||
		end <= raw.indexOf("(") ||
		raw[end + 1] !== " " ||
		!/^[RSDZTWtXxKPI]$/.test(fields[0] ?? "") ||
		!positive(fields[19])
	)
		throw new Error("invalid_process_identity");
	return fields[19]!;
}
/** Read-only review. No owner or profile is removed, reset, signalled or rewritten. */
async function reviewLockAt(path: string, domain: ProfileDomain, lockPath: string): Promise<ProfileLockRecoveryReview> {
	const refuse = (reason: string, cause?: unknown) =>
		new ProfileLockRecoveryError(domain, reason, cause ? { cause } : undefined);
	if (process.platform !== "linux" || !process.getuid) throw refuse("unsupported_platform");
	const parentPath = dirname(path);
	try {
		const parent = await open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
		try {
			const directory = await open(lockPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
			try {
				const file = await open(join(lockPath, "owner.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
				try {
					const [parentStats, directoryStats, fileStats] = await Promise.all([
						parent.stat({ bigint: true }),
						directory.stat({ bigint: true }),
						file.stat({ bigint: true }),
					]);
					if (
						!parentStats.isDirectory() ||
						!directoryStats.isDirectory() ||
						!fileStats.isFile() ||
						fileStats.nlink !== 1n ||
						fileStats.size <= 0n ||
						fileStats.size > 16384n ||
						[parentStats, directoryStats, fileStats].some(s => s.uid !== BigInt(process.getuid!())) ||
						(parentStats.mode & 0o777n) !== 0o700n ||
						(directoryStats.mode & 0o777n) !== 0o700n ||
						(fileStats.mode & 0o777n) !== 0o600n
					)
						throw refuse("invalid_private_evidence");
					const buffer = Buffer.alloc(16385);
					let length = 0;
					while (length < buffer.length) {
						const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
						if (bytesRead === 0) break;
						length += bytesRead;
					}
					if (length > 16384 || BigInt(length) !== fileStats.size) throw refuse("owner_capture_size_changed");
					const bytes = buffer.subarray(0, length).toString("utf8");
					let owner: unknown;
					try {
						owner = JSON.parse(bytes);
					} catch (cause) {
						throw refuse("malformed_owner", cause);
					}
					if (!ownerShape(owner, domain)) throw refuse("missing_or_unsupported_original_binding");
					const binding = owner.recoveryBinding;
					const observed = {
						schemaVersion: 2 as const,
						parent: identity(parentStats),
						directory: identity(directoryStats),
						owner: identity(fileStats),
					};
					if (
						!equalIdentity(binding.parent, observed.parent) ||
						!equalIdentity(binding.directory, observed.directory) ||
						!equalIdentity(binding.owner, observed.owner)
					)
						throw refuse("changed_or_copied_original_identity");
					const fs = await statfs(parentPath, { bigint: true });
					// Refuse shared and unqualified mappings. These Linux filesystem types
					// are local; unknown/overlay/NFS/CIFS/FUSE do not qualify closure.
					if (![0xef53n, 0x58465342n, 0x9123683en, 0x01021994n].includes(fs.type))
						throw refuse("shared_or_unqualified_filesystem");
					const [bootRaw, machineRaw, pidNamespace, mountNamespace, userNamespace] = await Promise.all([
						readFile("/proc/sys/kernel/random/boot_id", "utf8"),
						readFile("/etc/machine-id", "utf8"),
						readlink("/proc/self/ns/pid"),
						readlink("/proc/self/ns/mnt"),
						readlink("/proc/self/ns/user"),
					]);
					const bootId = bootRaw.trim();
					const machineId = machineRaw.trim();
					if (
						!uuid(bootId) ||
						!/^[0-9a-f]{32}$/.test(machineId) ||
						hash(machineId) !== owner.originalProcess.machineIdSha256
					)
						throw refuse("unverified_original_machine");
					let kind: ProfileLockRecoveryReview["closure"]["kind"];
					if (bootId !== owner.originalProcess.bootId) {
						const boot = (await readFile("/proc/stat", "utf8")).match(/^btime ([1-9]\d*)$/m)?.[1];
						if (
							!boot ||
							directoryStats.ctimeNs >= BigInt(boot) * 1000000000n ||
							fileStats.ctimeNs >= BigInt(boot) * 1000000000n
						)
							throw refuse("unverified_previous_boot_evidence");
						kind = "previous-boot";
					} else {
						const ns = owner.originalProcess.namespaces;
						if (pidNamespace !== ns.pid || mountNamespace !== ns.mount || userNamespace !== ns.user)
							throw refuse("unverified_original_namespaces");
						let originalStat: string | undefined;
						try {
							originalStat = await readFile(`/proc/${owner.pid}/stat`, "utf8");
						} catch (cause) {
							if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
								throw refuse("original_process_evidence_unavailable", cause);
						}
						if (originalStat === undefined) kind = "pid-absent";
						else {
							if (startTicks(originalStat, owner.pid) === owner.originalProcess.startTicks)
								throw new ProfileStoreError("lock_busy", domain);
							kind = "pid-reused";
						}
					}
					// Keep original descriptors open through closure observation; compare
					// every namespace entry and original byte/stat identity again afterward.
					const [parentNow, directoryNow, ownerNow] = await Promise.all([
						lstat(parentPath, { bigint: true }),
						lstat(lockPath, { bigint: true }),
						lstat(join(lockPath, "owner.json"), { bigint: true }),
					]);
					const names = await readdir(lockPath);
					if (
						names.length !== 1 ||
						names[0] !== "owner.json" ||
						[parentNow, directoryNow, ownerNow].some(s => s.isSymbolicLink()) ||
						!equalIdentity(identity(parentNow), observed.parent) ||
						!equalIdentity(identity(directoryNow), observed.directory) ||
						!equalIdentity(identity(ownerNow), observed.owner) ||
						parentNow.mode !== parentStats.mode ||
						directoryNow.mode !== directoryStats.mode ||
						ownerNow.mode !== fileStats.mode ||
						ownerNow.nlink !== fileStats.nlink ||
						directoryNow.ctimeNs !== directoryStats.ctimeNs ||
						directoryNow.mtimeNs !== directoryStats.mtimeNs ||
						ownerNow.ctimeNs !== fileStats.ctimeNs ||
						ownerNow.mtimeNs !== fileStats.mtimeNs ||
						ownerNow.size !== fileStats.size ||
						(await readFile(join(lockPath, "owner.json"), "utf8")) !== bytes
					)
						throw refuse("evidence_changed_during_review");
					const body = {
						schemaVersion: 1 as const,
						path,
						domain,
						observedAt: new Date().toISOString(),
						ownerSha256: hash(bytes),
						binding,
						filesystemType: String(fs.type),
						closure: { kind, currentBootId: bootId, original: owner.originalProcess },
						directory: { ctimeNs: String(directoryStats.ctimeNs), mtimeNs: String(directoryStats.mtimeNs) },
						owner: {
							ctimeNs: String(fileStats.ctimeNs),
							mtimeNs: String(fileStats.mtimeNs),
							size: String(fileStats.size),
						},
					};
					return { ...body, sha256: hash(JSON.stringify(body)) };
				} finally {
					await file.close();
				}
			} finally {
				await directory.close();
			}
		} finally {
			await parent.close();
		}
	} catch (cause) {
		if (cause instanceof ProfileStoreError) throw cause;
		throw refuse("evidence_unavailable", cause);
	}
}

export async function reviewProfileLockRecovery(
	path: string,
	domain: ProfileDomain,
): Promise<ProfileLockRecoveryReview> {
	return reviewLockAt(path, domain, `${path}.lock`);
}
export interface ProfileLockRecoveryResult {
	schemaVersion: 1;
	status: "retained";
	retainedDirectoryPath: string;
	intentPath: string;
	reviewSha256: string;
	receiptSha256: string;
}
function comparison(review: ProfileLockRecoveryReview, captured: boolean): string {
	return JSON.stringify({
		schemaVersion: review.schemaVersion,
		path: review.path,
		domain: review.domain,
		ownerSha256: review.ownerSha256,
		binding: review.binding,
		filesystemType: review.filesystemType,
		closure: review.closure,
		owner: review.owner,
		directory: { mtimeNs: review.directory.mtimeNs, ctimeNs: captured ? undefined : review.directory.ctimeNs },
	});
}
/** Explicit reviewed action; acquiring a normal mutation/reset lease never invokes it. */
export async function recoverProfileLock(
	path: string,
	domain: ProfileDomain,
	review: ProfileLockRecoveryReview,
	approvedSha256: string,
	signal?: AbortSignal,
): Promise<ProfileLockRecoveryResult> {
	const refuse = (reason: string, cause?: unknown) =>
		new ProfileLockRecoveryError(domain, reason, cause ? { cause } : undefined);
	const cancelled = () => {
		if (signal?.aborted) throw refuse("request_cancelled");
	};
	cancelled();
	if (process.platform !== "linux" || !process.getuid || !["person", "computer"].includes(domain))
		throw refuse("unsupported_platform_or_domain");
	let payload: string;
	try {
		if (!review || !object(review)) throw refuse("invalid_review");
		const { sha256, ...body } = review;
		payload = JSON.stringify(body);
		if (
			!digest(sha256) ||
			approvedSha256 !== sha256 ||
			hash(payload) !== sha256 ||
			body.path !== path ||
			body.domain !== domain ||
			body.schemaVersion !== 1 ||
			payload.length > 32768
		)
			throw refuse("review_authorization_mismatch");
		const observed = Date.parse(body.observedAt);
		const age = Date.now() - observed;
		if (!Number.isFinite(age) || age < 0 || age > 300000) throw refuse("review_expired_or_future");
	} catch (cause) {
		if (cause instanceof ProfileStoreError) throw cause;
		throw refuse("invalid_review", cause);
	}
	const parentPath = dirname(path);
	const lockPath = `${path}.lock`;
	const intentName = `.${domain}-profile-lock-recovery-${review.sha256}.intent.json`;
	const retainedName = `.${domain}-profile-lock-recovery-${review.sha256}.recovery-directory`;
	const retainedDirectoryPath = join(parentPath, retainedName);
	const intentPath = join(parentPath, intentName);
	const verify = async (captured: boolean) => {
		const current = await reviewLockAt(path, domain, captured ? retainedDirectoryPath : lockPath);
		if (comparison(current, captured) !== comparison(review, captured)) throw refuse("reviewed_identity_changed");
	};
	try {
		await verify(false);
		cancelled();
		const parent = await open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
		try {
			const verifyParent = async () => {
				const [held, named] = await Promise.all([
					parent.stat({ bigint: true }),
					lstat(parentPath, { bigint: true }),
				]);
				if (
					!held.isDirectory() ||
					!named.isDirectory() ||
					named.isSymbolicLink() ||
					!equalIdentity(identity(held), review.binding.parent) ||
					!equalIdentity(identity(named), review.binding.parent) ||
					held.uid !== BigInt(process.getuid!()) ||
					(held.mode & 0o777n) !== 0o700n ||
					named.mode !== held.mode
				)
					throw refuse("reviewed_parent_changed");
			};
			await verifyParent();
			const receipt = JSON.stringify({
				schemaVersion: 1,
				operation: "profile-lock-recovery",
				approvedReviewSha256: approvedSha256,
				review,
				retainedDirectoryPath,
				scope: { changeProfile: false, signalProcesses: false },
			});
			// The original descriptor binds creation even if an ancestor pathname changes.
			// Exclusive creation consumes this review on both success and partial failure.
			let intent: Awaited<ReturnType<typeof open>>;
			try {
				intent = await open(
					`/proc/self/fd/${parent.fd}/${intentName}`,
					constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
					0o600,
				);
			} catch (cause) {
				throw refuse("review_intent_unavailable_or_already_used", cause);
			}
			try {
				await intent.writeFile(receipt);
				await intent.sync();
				const stats = await intent.stat({ bigint: true });
				if (
					!stats.isFile() ||
					stats.nlink !== 1n ||
					stats.uid !== BigInt(process.getuid!()) ||
					(stats.mode & 0o777n) !== 0o600n
				)
					throw refuse("intent_retention_unverified");
			} finally {
				await intent.close();
			}
			await parent.sync();
			await verifyParent();
			await verify(false);
			cancelled();
			if (!renameExclusiveAt(parent.fd, basename(lockPath), retainedName))
				throw refuse("retained_destination_conflict");
			try {
				// The kernel rename has no source-inode predicate. Independently verify
				// the complete captured original and refuse unexpected namespace changes.
				await verify(true);
				await parent.sync();
				await verifyParent();
				await verify(true);
			} catch (failure) {
				try {
					// Restore the whole capture only into an absent active name. A new
					// contender and all unexpected captures remain intact on conflict.
					if (!renameExclusiveAt(parent.fd, retainedName, basename(lockPath)))
						throw refuse("original_restoration_conflict");
					await parent.sync();
				} catch (restorationFailure) {
					throw new AggregateError(
						[failure, restorationFailure],
						"Reviewed original profile lock capture and restoration failed",
						{ cause: failure },
					);
				}
				throw failure;
			}
			return {
				schemaVersion: 1,
				status: "retained",
				retainedDirectoryPath,
				intentPath,
				reviewSha256: review.sha256,
				receiptSha256: hash(receipt),
			};
		} finally {
			await parent.close();
		}
	} catch (cause) {
		if (cause instanceof ProfileStoreError || cause instanceof AggregateError) throw cause;
		throw refuse("retention_or_capture_unavailable", cause);
	}
}
