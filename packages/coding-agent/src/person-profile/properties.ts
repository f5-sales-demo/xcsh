import { type PersonalProperty, type PersonProfile, type UserProfileObservation, validateObservation } from "./schema";

export function observationPropertyId(observation: UserProfileObservation): string | undefined {
	return observation.field === "additionalProperty"
		? (observation.value as PersonalProperty[])[0]?.propertyID
		: undefined;
}
export function expandObservations(input: UserProfileObservation[]): UserProfileObservation[] {
	const result: UserProfileObservation[] = [];
	for (const observation of input) {
		validateObservation(observation);
		const expanded =
			observation.field === "additionalProperty"
				? (observation.value as PersonalProperty[]).map(property => ({ ...observation, value: [property] }))
				: [observation];
		if (result.length + expanded.length > 100) throw new Error("Invalid person profile observations");
		result.push(...expanded);
	}
	return result;
}
export function recordObservation(profile: PersonProfile, observation: UserProfileObservation): void {
	const propertyID = observationPropertyId(observation);
	if (
		profile.suppressed[observation.field] ||
		(propertyID && Object.hasOwn(profile.suppressedProperties ?? {}, propertyID))
	)
		return;
	profile.observations = profile.observations.filter(
		old =>
			old.field !== observation.field ||
			old.source !== observation.source ||
			observationPropertyId(old) !== propertyID,
	);
	profile.observations.push(structuredClone(observation));
}
export function syncPropertyProvenance(profile: PersonProfile, now: string): void {
	const properties = profile.facts.additionalProperty ?? [];
	for (const id of Object.keys(profile.propertyProvenance ?? {}))
		if (!properties.some(property => property.propertyID === id)) delete profile.propertyProvenance![id];
	if (!properties.length) {
		delete profile.facts.additionalProperty;
		delete profile.provenance.additionalProperty;
		delete profile.propertyProvenance;
		return;
	}
	const metadata = properties.map(property => profile.propertyProvenance![property.propertyID]);
	const owners = new Set(metadata.map(meta => meta.owner)),
		sources = new Set(metadata.map(meta => meta.source));
	profile.provenance.additionalProperty = {
		owner: owners.size === 1 ? metadata[0].owner : "mixed",
		source: sources.size === 1 ? metadata[0].source : "mixed",
		observedAt: now,
	};
}
/** PropertyValue entries merge by stable propertyID, with ownership and freshness for each attribute. */
export function putPersonalProperties(
	profile: PersonProfile,
	incoming: PersonalProperty[],
	owner: string,
	source: string,
	now: string,
): void {
	const user = owner === "user";
	if (!user && profile.suppressed.additionalProperty) return;
	const properties = new Map(
		(profile.facts.additionalProperty ?? []).map(property => [property.propertyID, property]),
	);
	let changed = false;
	for (const property of incoming) {
		const id = property.propertyID;
		if (!user && Object.hasOwn(profile.suppressedProperties ?? {}, id)) continue;
		const prior = Object.hasOwn(profile.propertyProvenance ?? {}, id) ? profile.propertyProvenance![id] : undefined;
		if (!user && prior && prior.owner !== owner) {
			if (JSON.stringify(properties.get(id)) !== JSON.stringify(property))
				recordObservation(profile, {
					field: "additionalProperty",
					value: [property],
					source,
					kind: "observed",
					observedAt: now,
				});
			continue;
		}
		if (user && prior?.owner === "user" && JSON.stringify(properties.get(id)) === JSON.stringify(property)) continue;
		properties.set(id, structuredClone(property));
		profile.propertyProvenance ??= {};
		profile.propertyProvenance[id] = { owner, source, observedAt: now };
		if (user) {
			delete profile.suppressed.additionalProperty;
			if (profile.suppressedProperties) delete profile.suppressedProperties[id];
			profile.observations = profile.observations.filter(observation => observationPropertyId(observation) !== id);
		}
		changed = true;
	}
	if (changed) {
		profile.facts.additionalProperty = [...properties.values()];
		syncPropertyProvenance(profile, now);
	}
}
export function forgetPersonalProperties(profile: PersonProfile, ids: readonly string[], now: string): void {
	profile.suppressedProperties ??= {};
	const before = profile.facts.additionalProperty?.length ?? 0;
	for (const id of ids) {
		if (!Object.hasOwn(profile.suppressedProperties, id)) profile.suppressedProperties[id] = { forgottenAt: now };
		if (profile.propertyProvenance) delete profile.propertyProvenance[id];
	}
	if (profile.facts.additionalProperty)
		profile.facts.additionalProperty = profile.facts.additionalProperty.filter(
			property => !ids.includes(property.propertyID),
		);
	profile.observations = profile.observations.filter(observation => {
		const id = observationPropertyId(observation);
		return !id || !ids.includes(id);
	});
	if (before !== (profile.facts.additionalProperty?.length ?? 0)) syncPropertyProvenance(profile, now);
}
