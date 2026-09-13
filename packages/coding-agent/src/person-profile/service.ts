import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { PROFILE_COLLECTORS } from "./collectors";
import {
	emptyProfile,
	FieldSchema,
	ObservationSchema,
	type PersonProfile,
	type UserProfile,
	type UserProfileObservation,
	validateFacts,
	validateProfile,
} from "./schema";
export interface ProfileCollector {
	readonly id: string;
	readonly name: string;
	readonly authoritativeFields?: readonly string[];
	available(signal?: AbortSignal): Promise<boolean>;
	collect(signal?: AbortSignal): Promise<Partial<UserProfile>>;
}
const defaultPath = () => join(homedir(), ".xcsh", "user-profile.json");
const errorCode = (error: unknown) => (error as { code?: string })?.code;
function cancelled(signal?: AbortSignal) {
	if (signal?.aborted) throw new Error("Person profile operation cancelled");
}
function normalize(value: unknown): unknown {
	if (typeof value === "string") return value.trim().normalize("NFC");
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
	return value;
}
/** One OS-user boundary. Never derives identity from cwd, provider, model or transport. */
export class PersonProfileService {
	readonly #collectors = new Map<string, ProfileCollector>();
	readonly #registrants = new Map<string, string>();
	constructor(readonly path = defaultPath()) {}
	registerProfileCollector(collector: ProfileCollector, registrant?: string): void {
		if (
			!collector ||
			typeof collector !== "object" ||
			typeof collector.name !== "string" ||
			!collector.name.trim() ||
			collector.name.length > 128 ||
			!/^[a-z][a-z0-9_-]{0,63}$/.test(collector.id) ||
			["user", "conversation", "inference"].includes(collector.id) ||
			(this.#collectors.has(collector.id) && (!registrant || this.#registrants.get(collector.id) !== registrant)) ||
			typeof collector.available !== "function" ||
			typeof collector.collect !== "function" ||
			(collector.authoritativeFields !== undefined &&
				(!Array.isArray(collector.authoritativeFields) ||
					collector.authoritativeFields.some(f => !Value.Check(FieldSchema, f))))
		)
			throw new Error("Invalid person profile collector");
		if (registrant) this.#registrants.set(collector.id, registrant);
		this.#collectors.set(
			collector.id,
			Object.freeze({
				...collector,
				available: collector.available.bind(collector),
				collect: collector.collect.bind(collector),
			}),
		);
	}
	async get(): Promise<PersonProfile> {
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
				validateProfile(profile);
				return profile;
			} finally {
				await file.close();
			}
		} catch (error) {
			if (errorCode(error) === "ENOENT") return emptyProfile();
			throw new Error("Invalid person profile storage");
		}
	}
	async #mutate(
		change: (profile: PersonProfile) => void,
		revision?: number,
		signal?: AbortSignal,
	): Promise<PersonProfile> {
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
		const commit = async (): Promise<PersonProfile> => {
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
			change(profile);
			if (JSON.stringify(profile) === before) return profile;
			profile.revision++;
			profile.updatedAt = new Date().toISOString();
			profile.state = Object.keys(profile.facts).length || profile.observations.length ? "ready" : "empty";
			validateProfile(profile);
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
		let result: PersonProfile | undefined;
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
	async update(input: UserProfile, revision?: number, signal?: AbortSignal): Promise<PersonProfile> {
		validateFacts(input);
		const facts = normalize(input);
		validateFacts(facts);
		return this.#mutate(
			profile => {
				for (const [field, value] of Object.entries(facts)) {
					const key = field as keyof UserProfile;
					if (
						JSON.stringify(profile.facts[key]) === JSON.stringify(value) &&
						profile.provenance[key]?.owner === "user"
					)
						continue;
					Object.assign(profile.facts, { [key]: value });
					profile.provenance[key] = {
						owner: "user",
						source: "conversation",
						observedAt: new Date().toISOString(),
					};
					delete profile.suppressed[key];
					profile.observations = profile.observations.filter(o => o.field !== key);
				}
			},
			revision,
			signal,
		);
	}
	async forget(fields: readonly string[], revision?: number, signal?: AbortSignal): Promise<PersonProfile> {
		if (!fields.length || fields.some(f => !Value.Check(FieldSchema, f)))
			throw new Error("Invalid person profile fields");
		return this.#mutate(
			profile => {
				for (const field of fields) {
					const key = field as keyof UserProfile;
					delete profile.facts[key];
					delete profile.provenance[key];
					profile.observations = profile.observations.filter(o => o.field !== key);
					profile.suppressed[key] ??= { forgottenAt: new Date().toISOString() };
				}
			},
			revision,
			signal,
		);
	}

	async observe(
		observations: UserProfileObservation[],
		revision?: number,
		signal?: AbortSignal,
	): Promise<PersonProfile> {
		if (observations.length > 100 || observations.some(o => !Value.Check(ObservationSchema, o)))
			throw new Error("Invalid person profile observations");
		return this.#mutate(
			profile => {
				for (const observation of observations) {
					if (profile.suppressed[observation.field] || profile.facts[observation.field] !== undefined) continue;
					profile.observations = profile.observations.filter(
						o => o.field !== observation.field || o.source !== observation.source,
					);
					profile.observations.push(structuredClone(observation));
				}
			},
			revision,
			signal,
		);
	}
	async reconcileFromCollectors(signal?: AbortSignal): Promise<PersonProfile> {
		const profile = await this.get();
		const sources = profile.configuredSources.filter(id => this.#collectors.has(id));
		return sources.length ? this.refresh(sources, undefined, signal) : profile;
	}
	async refresh(
		sources: readonly string[],
		revision?: number,
		signal?: AbortSignal,
		configure = false,
	): Promise<PersonProfile & { collectors: { id: string; status: "collected" | "unavailable" | "error" }[] }> {
		if (!sources.length || sources.some(s => !this.#collectors.has(s)))
			throw new Error("Invalid person profile sources");
		const outputs: { id: string; facts: UserProfile }[] = [];
		const collectors: { id: string; status: "collected" | "unavailable" | "error" }[] = [];
		for (const id of new Set(sources)) {
			cancelled(signal);
			const collector = this.#collectors.get(id)!;
			const timeout = AbortSignal.timeout(15000);
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
			let onAbort: () => void = () => {};
			try {
				const work = async () => {
					if (!(await collector.available(combined))) return undefined;
					cancelled(combined);
					const facts = normalize(await collector.collect(combined));
					validateFacts(facts);
					cancelled(combined);
					return facts;
				};
				const facts = await Promise.race([
					work(),
					new Promise<never>((_, reject) => {
						onAbort = () => reject(new Error("Collector unavailable"));
						combined.addEventListener("abort", onAbort, { once: true });
					}),
				]);
				if (facts) outputs.push({ id, facts });
				collectors.push({ id, status: facts ? "collected" : "unavailable" });
			} catch {
				cancelled(signal);
				collectors.push({ id, status: "error" });
			} finally {
				combined.removeEventListener("abort", onAbort);
			}
		}
		const profile = await this.#mutate(
			profile => {
				if (configure) profile.configuredSources = [...new Set(sources)];
				for (const { id, facts } of outputs)
					for (const [field, value] of Object.entries(facts)) {
						const key = field as keyof UserProfile;
						if (profile.suppressed[key] || (profile.provenance[key] && profile.provenance[key]?.owner !== id))
							continue;
						Object.assign(profile.facts, { [key]: value });
						profile.provenance[key] = { owner: id, source: id, observedAt: new Date().toISOString() };
					}
			},
			revision,
			signal,
		);
		return { ...profile, collectors };
	}
}
export const personProfileService = new PersonProfileService();
for (const collector of PROFILE_COLLECTORS) personProfileService.registerProfileCollector(collector);
