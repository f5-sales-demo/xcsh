import { homedir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { createAccountCollectors } from "./account-collectors";
import { PROFILE_COLLECTORS } from "./collectors";
import { PrivateProfileStore } from "./private-store";
import {
	expandObservations,
	forgetPersonalProperties,
	observationPropertyId,
	putPersonalProperties,
	recordObservation,
	syncPropertyProvenance,
} from "./properties";
import { createSalesforceRelationshipCollector } from "./salesforce-discovery";
import {
	emptyProfile,
	FieldSchema,
	PersonFactsSchema,
	type PersonProfile,
	PropertyIdSchema,
	type UserProfile,
	type UserProfileObservation,
	validateFacts,
	validateProfile,
} from "./schema";
export interface ProfileCollection {
	facts: UserProfile;
	observations: UserProfileObservation[];
}
export interface ProfileCollector {
	readonly id: string;
	readonly name: string;
	readonly timeoutMs?: number;
	readonly authoritativeFields?: readonly string[];
	available(signal?: AbortSignal): Promise<boolean>;
	collect(signal?: AbortSignal): Promise<Partial<UserProfile> | ProfileCollection>;
}
const defaultPath = () => join(homedir(), ".xcsh", "user-profile.json");
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
function applySuppression(
	facts: UserProfile,
	suppressed: PersonProfile["suppressed"],
	properties: PersonProfile["suppressedProperties"] = {},
): UserProfile {
	const pruneEmail = (value: unknown): unknown => {
		if (typeof value === "string") return /[^\s/@]+@[^\s/@]+/.test(value) ? undefined : value;
		if (Array.isArray(value)) return value.map(pruneEmail).filter(v => v !== undefined);
		if (value && typeof value === "object") {
			const entries = Object.entries(value)
				.map(([key, v]) => [key, pruneEmail(v)])
				.filter(([, v]) => v !== undefined);
			return entries.length ? Object.fromEntries(entries) : undefined;
		}
		return value;
	};
	const result: UserProfile = {};
	for (const [field, original] of Object.entries(facts)) {
		const key = field as keyof UserProfile;
		if (suppressed[key]) continue;
		let value = suppressed.email ? pruneEmail(original) : original;
		if (key === "additionalProperty" && Array.isArray(value))
			value = value.filter(
				property =>
					property &&
					typeof property === "object" &&
					!Object.hasOwn(properties, property.propertyID) &&
					Value.Check(PersonFactsSchema.properties.additionalProperty.items, property),
			);
		if (key === "accounts" && Array.isArray(value))
			value = value.filter(account => Value.Check(PersonFactsSchema.properties.accounts.items, account));
		if (suppressed.email && Array.isArray(original) && original.length && Array.isArray(value) && !value.length)
			continue;
		if (value !== undefined && Value.Check(PersonFactsSchema.properties[key], value))
			Object.assign(result, { [key]: value });
	}
	return result;
}
/** One OS-user boundary. Never derives identity from cwd, provider, model or transport. */
export class PersonProfileService {
	readonly #collectors = new Map<string, ProfileCollector>();
	readonly #registrants = new Map<string, string>();
	readonly #store: PrivateProfileStore<PersonProfile>;
	constructor(readonly path = defaultPath()) {
		this.#store = new PrivateProfileStore(path, emptyProfile, validateProfile, profile => {
			profile.state = Object.keys(profile.facts).length || profile.observations.length ? "ready" : "empty";
		});
	}
	registerProfileCollector(collector: ProfileCollector, registrant?: string): void {
		// Preserve the built-in bootstrap adapter and separately register richer plugin evidence.
		// A plugin never replaces another source merely by choosing the same ID.
		if (collector && registrant && this.#collectors.has(collector.id) && !this.#registrants.has(collector.id)) {
			collector = { ...collector, id: `${collector.id}_extension` };
		}
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
			(collector.timeoutMs !== undefined &&
				(!Number.isInteger(collector.timeoutMs) || collector.timeoutMs < 1000 || collector.timeoutMs > 60000)) ||
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
	listCollectors(): { id: string; name: string }[] {
		return [...this.#collectors.values()].map(({ id, name }) => ({ id, name }));
	}
	unregisterProfileCollector(id: string, registrant?: string): boolean {
		if (
			registrant &&
			this.#registrants.get(id) !== registrant &&
			this.#registrants.get(`${id}_extension`) === registrant
		)
			id = `${id}_extension`;
		if (this.#registrants.get(id) !== registrant) return false;
		this.#registrants.delete(id);
		return this.#collectors.delete(id);
	}
	async get(): Promise<PersonProfile> {
		return this.#store.get();
	}
	async #mutate(
		change: (profile: PersonProfile) => void,
		revision?: number,
		signal?: AbortSignal,
		canCommit?: () => boolean,
	): Promise<PersonProfile> {
		return this.#store.mutate(
			profile => {
				change(profile);
				const beforeProperties = JSON.stringify(profile.facts.additionalProperty);
				profile.facts = applySuppression(profile.facts, profile.suppressed, profile.suppressedProperties);
				if (beforeProperties !== JSON.stringify(profile.facts.additionalProperty))
					syncPropertyProvenance(profile, new Date().toISOString());
				for (const field of Object.keys(profile.provenance) as (keyof UserProfile)[])
					if (profile.facts[field] === undefined) delete profile.provenance[field];
				profile.observations = profile.observations.flatMap(observation => {
					const facts = applySuppression(
						{ [observation.field]: observation.value },
						profile.suppressed,
						profile.suppressedProperties,
					);
					const value = facts[observation.field];
					return value === undefined ? [] : [{ ...observation, value }];
				});
			},
			revision,
			signal,
			canCommit,
		);
	}
	async update(
		input: UserProfile,
		revision?: number,
		signal?: AbortSignal,
		canCommit?: () => boolean,
	): Promise<PersonProfile> {
		validateFacts(input);
		const facts = normalize(input);
		validateFacts(facts);
		return this.#mutate(
			profile => {
				for (const [field, value] of Object.entries(facts)) {
					const key = field as keyof UserProfile;
					if (key === "additionalProperty") {
						putPersonalProperties(
							profile,
							facts.additionalProperty!,
							"user",
							"conversation",
							new Date().toISOString(),
						);
						continue;
					}
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
			canCommit,
		);
	}
	async forget(
		fields: readonly string[],
		revision?: number,
		signal?: AbortSignal,
		canCommit?: () => boolean,
		propertyIds: readonly string[] = [],
	): Promise<PersonProfile> {
		if (
			(!fields.length && !propertyIds.length) ||
			fields.some(f => !Value.Check(FieldSchema, f)) ||
			propertyIds.length > 100 ||
			propertyIds.some(id => !Value.Check(PropertyIdSchema, id))
		)
			throw new Error("Invalid person profile fields");
		return this.#mutate(
			profile => {
				if (propertyIds.length) forgetPersonalProperties(profile, propertyIds, new Date().toISOString());
				for (const field of fields) {
					const key = field as keyof UserProfile;
					if (key === "additionalProperty") {
						const ids = [
							...new Set([
								...(profile.facts.additionalProperty ?? []).map(property => property.propertyID),
								...profile.observations.map(observationPropertyId).filter((id): id is string => Boolean(id)),
							]),
						];
						forgetPersonalProperties(profile, ids, new Date().toISOString());
					}
					delete profile.facts[key];
					delete profile.provenance[key];
					profile.observations = profile.observations.filter(o => o.field !== key);
					profile.suppressed[key] ??= { forgottenAt: new Date().toISOString() };
				}
			},
			revision,
			signal,
			canCommit,
		);
	}

	async observe(
		observations: UserProfileObservation[],
		revision?: number,
		signal?: AbortSignal,
		canCommit?: () => boolean,
	): Promise<PersonProfile> {
		if (!Array.isArray(observations) || observations.length > 100)
			throw new Error("Invalid person profile observations");
		observations = expandObservations(normalize(observations) as UserProfileObservation[]);
		return this.#mutate(
			profile => {
				for (const observation of observations) recordObservation(profile, observation);
			},
			revision,
			signal,
			canCommit,
		);
	}
	async reconcileFromCollectors(
		signal?: AbortSignal,
		freshForMs = 0,
		canCommit?: () => boolean,
	): Promise<PersonProfile> {
		const profile = await this.get();
		const configured =
			profile.discoveryMode === "configured" ||
			(profile.discoveryMode === undefined && profile.configuredSources.length > 0);
		const sources = (configured ? profile.configuredSources : [...this.#collectors.keys()]).filter(
			id =>
				this.#collectors.has(id) &&
				Date.now() - Date.parse(profile.collectionState?.[id]?.attemptedAt ?? "1970-01-01") >= freshForMs,
		);
		let current = profile;
		// Dependencies such as the Salesforce plugin can read IDs saved by the bootstrap adapter.
		for (const source of sources) current = await this.refresh([source], undefined, signal, false, canCommit);
		return current;
	}
	async refresh(
		sources: readonly string[],
		revision?: number,
		signal?: AbortSignal,
		configure = false,
		canCommit?: () => boolean,
	): Promise<PersonProfile & { collectors: { id: string; status: "collected" | "unavailable" | "error" }[] }> {
		if ((!sources.length && !configure) || sources.some(s => !this.#collectors.has(s)))
			throw new Error("Invalid person profile sources");
		const outputs: { id: string; facts: UserProfile; observations: UserProfileObservation[] }[] = [];
		const collectors: { id: string; status: "collected" | "unavailable" | "error" }[] = [];
		for (const id of new Set(sources)) {
			cancelled(signal);
			const collector = this.#collectors.get(id)!;
			const timeout = AbortSignal.timeout(collector.timeoutMs ?? 15000);
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
			let onAbort: () => void = () => {};
			try {
				const work = async () => {
					if (!(await collector.available(combined))) return undefined;
					cancelled(combined);
					const result = normalize(await collector.collect(combined));
					const envelope = result && typeof result === "object" && "facts" in result;
					const facts = envelope ? (result as ProfileCollection).facts : result;
					const rawObservations = envelope ? (result as ProfileCollection).observations : [];
					validateFacts(facts);
					if (!Array.isArray(rawObservations) || rawObservations.length > 100)
						throw new Error("Invalid person profile observations");
					const observations = expandObservations(rawObservations);
					cancelled(combined);
					return { facts, observations };
				};
				const facts = await Promise.race([
					work(),
					new Promise<never>((_, reject) => {
						onAbort = () => reject(new Error("Collector unavailable"));
						combined.addEventListener("abort", onAbort, { once: true });
					}),
				]);
				if (facts) outputs.push({ id, ...facts });
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
				if (configure) {
					profile.configuredSources = [...new Set(sources)];
					profile.discoveryMode = "configured";
				}
				profile.collectionState ??= {};
				const now = new Date().toISOString();
				for (const { id, status } of collectors) {
					profile.collectionState[id] = {
						...profile.collectionState[id],
						attemptedAt: now,
						status,
						...(status === "collected" ? { succeededAt: now } : {}),
					};
				}
				for (const { id, facts, observations } of outputs) {
					const priorIds =
						profile.provenance.identifiers?.owner === id
							? profile.facts.identifiers
							: profile.observations.find(o => o.source === id && o.field === "identifiers")?.value;
					const subjectChanged =
						Boolean(
							facts.identifiers &&
								priorIds &&
								typeof priorIds === "object" &&
								Object.entries(facts.identifiers).some(
									([key, value]) => key in priorIds && (priorIds as Record<string, unknown>)[key] !== value,
								),
						) ||
						(profile.provenance.identifiers?.owner !== id &&
							(["givenName", "familyName", "email"] as const).some(
								key =>
									profile.provenance[key]?.owner === id &&
									facts[key] !== undefined &&
									JSON.stringify(profile.facts[key]) !== JSON.stringify(facts[key]),
							));
					for (const observation of observations) {
						recordObservation(profile, { ...observation, source: id, observedAt: now });
					}
					for (const [field, value] of Object.entries(facts)) {
						const key = field as keyof UserProfile;
						if (key === "additionalProperty") {
							if (!subjectChanged) putPersonalProperties(profile, facts.additionalProperty!, id, id, now);
							else
								for (const observation of expandObservations([
									{ field: key, value, source: id, kind: "observed", observedAt: now },
								]))
									recordObservation(profile, observation);
							continue;
						}
						if (profile.suppressed[key]) continue;
						if (subjectChanged || (profile.provenance[key] && profile.provenance[key]?.owner !== id)) {
							if (JSON.stringify(profile.facts[key]) !== JSON.stringify(value)) {
								profile.observations = profile.observations.filter(o => o.field !== key || o.source !== id);
								profile.observations.push({
									field: key,
									value: structuredClone(value),
									source: id,
									kind: "observed",
									observedAt: now,
								});
							}
							continue;
						}
						Object.assign(profile.facts, { [key]: value });
						profile.provenance[key] = { owner: id, source: id, observedAt: new Date().toISOString() };
					}
				}
				profile.observations = profile.observations.slice(-100);
			},
			revision,
			signal,
			canCommit,
		);
		return { ...profile, collectors };
	}
}
export const personProfileService = new PersonProfileService();
for (const collector of PROFILE_COLLECTORS) personProfileService.registerProfileCollector(collector);
for (const collector of createAccountCollectors()) personProfileService.registerProfileCollector(collector);
personProfileService.registerProfileCollector(
	createSalesforceRelationshipCollector(async () => (await personProfileService.get()).facts),
);

/** Read-only compatibility for marketplace collectors expecting the historical flat facts shape. */
export async function loadProfile(): Promise<UserProfile> {
	return (await personProfileService.get()).facts;
}
