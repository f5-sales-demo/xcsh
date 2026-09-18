import { createHash } from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const text = () => Type.String({ minLength: 1, maxLength: 4096 });
const strings = () => Type.Array(text(), { maxItems: 100 });
export const PropertyIdSchema = Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" });
export const PersonalPropertySchema = Type.Object(
	{
		propertyID: PropertyIdSchema,
		name: Type.Optional(text()),
		value: Type.Union([text(), Type.Number(), Type.Boolean(), strings()]),
	},
	{
		additionalProperties: false,
		description: "Schema.org PropertyValue representation for an explicitly xcsh-specific personal attribute",
	},
);
export type PersonalProperty = Static<typeof PersonalPropertySchema>;
const name = Type.Partial(Type.Object({ givenName: text(), familyName: text() }, { additionalProperties: false }));
const address = Type.Partial(
	Type.Object(
		{
			streetAddress: text(),
			addressLocality: text(),
			addressRegion: text(),
			postalCode: text(),
			addressCountry: text(),
		},
		{ additionalProperties: false },
	),
);
/** Schema.org Person vocabulary; xcsh-specific business fields are explicitly annotated. */
export const PersonFactsSchema = Type.Partial(
	Type.Object(
		{
			givenName: text(),
			additionalProperty: Type.Array(PersonalPropertySchema, {
				minItems: 1,
				maxItems: 100,
				description:
					"xcsh-specific extension to Person, using structured PropertyValue entries; merge and forget by propertyID",
			}),
			familyName: text(),
			additionalName: text(),
			email: Type.Union([text(), strings()]),
			telephone: Type.Union([text(), strings()]),
			jobTitle: text(),
			worksFor: Type.Partial(Type.Object({ name: text(), url: text() }, { additionalProperties: false })),
			address,
			birthDate: text(),
			birthPlace: address,
			nationality: text(),
			gender: text(),
			knowsLanguage: strings(),
			preferredLanguage: Type.String({
				...text(),
				description:
					"xcsh-specific UI language preference; OS locale is evidence of a preference, not proof of languages spoken",
			}),
			spouse: name,
			children: Type.Array(
				Type.Partial(
					Type.Object(
						{ givenName: text(), familyName: text(), birthDate: text() },
						{ additionalProperties: false },
					),
				),
				{ maxItems: 100 },
			),
			parent: Type.Array(name, { maxItems: 100 }),
			sibling: Type.Array(name, { maxItems: 100 }),
			url: text(),
			description: text(),
			knowsAbout: strings(),
			alumniOf: strings(),
			affiliation: strings(),
			memberOf: strings(),
			award: strings(),
			hasCredential: strings(),
			interactionDevices: Type.Array(
				Type.Object({ identifier: text(), relationship: Type.Literal("uses") }, { additionalProperties: false }),
				{
					maxItems: 100,
					description: "xcsh-specific references to machines used for interaction; not ownership claims",
				},
			),
			accounts: Type.Array(
				Type.Object(
					{
						provider: text(),
						identifier: text(),
						principalType: Type.Union([
							Type.Literal("user"),
							Type.Literal("service"),
							Type.Literal("role"),
							Type.Literal("unknown"),
						]),
						accountId: Type.Optional(text()),
						tenantId: Type.Optional(text()),
						username: Type.Optional(text()),
					},
					{ additionalProperties: false },
				),
				{
					maxItems: 100,
					description:
						"xcsh-specific account associations; observed principals are not confirmed human identities",
				},
			),
			image: text(),
			sameAs: strings(),
			department: Type.String({ ...text(), description: "xcsh-specific department" }),
			division: Type.String({ ...text(), description: "xcsh-specific division" }),
			manager: Type.Partial(
				Type.Object(
					{ givenName: text(), familyName: text(), email: text() },
					{ additionalProperties: false, description: "xcsh-specific manager" },
				),
			),
			identifiers: Type.Partial(
				Type.Object(
					{ github: text(), twitter: text(), salesforceId: text() },
					{ additionalProperties: false, description: "xcsh-specific source identifiers" },
				),
			),
			role: Type.String({ ...text(), description: "xcsh-specific business role" }),
			partner: Type.Object(
				{ id: Type.Optional(text()), name: text(), title: Type.Optional(text()), role: Type.Optional(text()) },
				{ additionalProperties: false, description: "xcsh-specific business partner" },
			),
			territories: Type.Array(text(), { maxItems: 100, description: "xcsh-specific territories" }),
			quota: Type.Number({ minimum: 0, description: "xcsh-specific quota" }),
		},
		{ additionalProperties: false, description: "Local person facts using https://schema.org/Person vocabulary" },
	),
);
export type UserProfile = Static<typeof PersonFactsSchema>;
export type ProviderAccount = NonNullable<UserProfile["accounts"]>[number];
export const accountKey = (account: ProviderAccount): string =>
	createHash("sha256")
		.update(JSON.stringify([account.provider, account.identifier, account.accountId ?? "", account.tenantId ?? ""]))
		.digest("hex");
export const FieldSchema = Type.KeyOf(PersonFactsSchema);
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const source = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" });
const provenance = Type.Object({ owner: source, source, observedAt: timestamp }, { additionalProperties: false });
export const ObservationSchema = Type.Object(
	{
		field: FieldSchema,
		value: Type.Union(Object.values(PersonFactsSchema.properties)),
		source,
		observedAt: timestamp,
		kind: Type.Union([Type.Literal("inferred"), Type.Literal("observed")]),
	},
	{ additionalProperties: false },
);
export type UserProfileObservation = Static<typeof ObservationSchema>;
export function validateObservation(value: unknown): asserts value is UserProfileObservation {
	if (!Value.Check(ObservationSchema, value) || !Value.Check(PersonFactsSchema.properties[value.field], value.value))
		throw new Error("Invalid person profile observations");
}
export const PersonProfileSchema = Type.Object(
	{
		schemaVersion: Type.Literal(2),
		revision: Type.Integer({ minimum: 0 }),
		state: Type.Union([Type.Literal("empty"), Type.Literal("ready")]),
		facts: PersonFactsSchema,
		provenance: Type.Partial(
			Type.Record(
				FieldSchema,
				Type.Object({ owner: source, source, observedAt: timestamp }, { additionalProperties: false }),
				{ additionalProperties: false },
			),
		),
		observations: Type.Array(ObservationSchema, { maxItems: 100 }),
		suppressed: Type.Partial(
			Type.Record(FieldSchema, Type.Object({ forgottenAt: timestamp }, { additionalProperties: false }), {
				additionalProperties: false,
			}),
		),
		configuredSources: Type.Array(source, { maxItems: 32, uniqueItems: true }),
		propertyProvenance: Type.Optional(Type.Record(PropertyIdSchema, provenance, { additionalProperties: false })),
		suppressedProperties: Type.Optional(
			Type.Record(PropertyIdSchema, Type.Object({ forgottenAt: timestamp }, { additionalProperties: false }), {
				additionalProperties: false,
			}),
		),
		accountProvenance: Type.Optional(
			Type.Record(Type.String({ pattern: "^[a-f0-9]{64}$" }), provenance, { additionalProperties: false }),
		),
		suppressedAccounts: Type.Optional(
			Type.Record(
				Type.String({ pattern: "^[a-f0-9]{64}$" }),
				Type.Object({ forgottenAt: timestamp }, { additionalProperties: false }),
				{ additionalProperties: false },
			),
		),
		discoveryMode: Type.Optional(Type.Union([Type.Literal("automatic"), Type.Literal("configured")])),
		collectionState: Type.Optional(
			Type.Record(
				source,
				Type.Object(
					{
						attemptedAt: timestamp,
						succeededAt: Type.Optional(timestamp),
						durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
						state: Type.Union([
							Type.Literal("ready"),
							Type.Literal("setup_required"),
							Type.Literal("unavailable"),
							Type.Literal("degraded"),
							Type.Literal("rate_limited"),
							Type.Literal("error"),
						]),
						reason: Type.Optional(
							Type.Union([
								Type.Literal("cli_missing"),
								Type.Literal("not_authenticated"),
								Type.Literal("expired"),
								Type.Literal("permission_denied"),
								Type.Literal("dependency_missing"),
								Type.Literal("network"),
								Type.Literal("rate_limited"),
								Type.Literal("invalid_response"),
							]),
						),
						retryAt: Type.Optional(timestamp),
					},
					{ additionalProperties: false },
				),
			),
		),
		updatedAt: Type.Optional(timestamp),
	},
	{ additionalProperties: false },
);
export type PersonProfile = Static<typeof PersonProfileSchema>;
export function validateFacts(value: unknown): asserts value is UserProfile {
	if (!Value.Check(PersonFactsSchema, value)) throw new Error("Invalid person profile input");
	const properties = value.additionalProperty ?? [];
	if (new Set(properties.map(property => property.propertyID)).size !== properties.length)
		throw new Error("Invalid person profile input");
}
export function validateProfile(value: unknown): asserts value is PersonProfile {
	if (!Value.Check(PersonProfileSchema, value)) throw new Error("Invalid person profile storage");
	const profile = value as PersonProfile;
	for (const field of Object.keys(profile.facts) as (keyof UserProfile)[]) {
		if (field === "accounts") continue;
		if (!profile.provenance[field] || profile.suppressed[field]) throw new Error("Invalid person profile storage");
	}
	for (const field of Object.keys(profile.provenance) as (keyof UserProfile)[]) {
		if (profile.facts[field] === undefined) throw new Error("Invalid person profile storage");
	}
	if (profile.observations.some(o => profile.suppressed[o.field])) throw new Error("Invalid person profile storage");
	for (const observation of profile.observations) validateObservation(observation);
	const properties = profile.facts.additionalProperty ?? [];
	if (new Set(properties.map(property => property.propertyID)).size !== properties.length)
		throw new Error("Invalid person profile storage");
	for (const property of properties) {
		if (
			!Object.hasOwn(profile.propertyProvenance ?? {}, property.propertyID) ||
			Object.hasOwn(profile.suppressedProperties ?? {}, property.propertyID)
		)
			throw new Error("Invalid person profile storage");
	}
	for (const id of Object.keys(profile.propertyProvenance ?? {}))
		if (!properties.some(property => property.propertyID === id)) throw new Error("Invalid person profile storage");
	for (const observation of profile.observations)
		if (observation.field === "additionalProperty") {
			const values = observation.value as PersonalProperty[];
			if (values.length !== 1 || Object.hasOwn(profile.suppressedProperties ?? {}, values[0].propertyID))
				throw new Error("Invalid person profile storage");
		}
	const accounts = profile.facts.accounts ?? [];
	const accountKeys = new Set(accounts.map(accountKey));
	if (accountKeys.size !== accounts.length) throw new Error("Invalid person profile storage");
	for (const key of accountKeys)
		if (!Object.hasOwn(profile.accountProvenance ?? {}, key) || Object.hasOwn(profile.suppressedAccounts ?? {}, key))
			throw new Error("Invalid person profile storage");
	for (const key of Object.keys(profile.accountProvenance ?? {}))
		if (!accountKeys.has(key)) throw new Error("Invalid person profile storage");
	if (profile.state !== (Object.keys(profile.facts).length || profile.observations.length ? "ready" : "empty"))
		throw new Error("Invalid person profile storage");
}
export function emptyProfile(): PersonProfile {
	return {
		schemaVersion: 2,
		revision: 0,
		state: "empty",
		facts: {},
		provenance: {},
		observations: [],
		suppressed: {},
		configuredSources: [],
	};
}
