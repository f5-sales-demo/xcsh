import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const text = () => Type.String({ minLength: 1, maxLength: 4096 });
const strings = () => Type.Array(text(), { maxItems: 100 });
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
			familyName: text(),
			additionalName: text(),
			email: text(),
			telephone: text(),
			jobTitle: text(),
			worksFor: Type.Partial(Type.Object({ name: text(), url: text() }, { additionalProperties: false })),
			address,
			birthDate: text(),
			birthPlace: address,
			nationality: text(),
			gender: text(),
			knowsLanguage: strings(),
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
export const FieldSchema = Type.KeyOf(PersonFactsSchema);
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const source = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" });
export const ObservationSchema = Type.Object(
	{ field: FieldSchema, value: text(), source, observedAt: timestamp, kind: Type.Literal("inferred") },
	{ additionalProperties: false },
);
export type UserProfileObservation = Static<typeof ObservationSchema>;
export const PersonProfileSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
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
		updatedAt: Type.Optional(timestamp),
	},
	{ additionalProperties: false },
);
export type PersonProfile = Static<typeof PersonProfileSchema>;
export function validateFacts(value: unknown): asserts value is UserProfile {
	if (!Value.Check(PersonFactsSchema, value)) throw new Error("Invalid person profile input");
}
export function validateProfile(value: unknown): asserts value is PersonProfile {
	if (!Value.Check(PersonProfileSchema, value)) throw new Error("Invalid person profile storage");
	const profile = value as PersonProfile;
	for (const field of Object.keys(profile.facts) as (keyof UserProfile)[]) {
		if (!profile.provenance[field] || profile.suppressed[field]) throw new Error("Invalid person profile storage");
	}
	for (const field of Object.keys(profile.provenance) as (keyof UserProfile)[]) {
		if (profile.facts[field] === undefined) throw new Error("Invalid person profile storage");
	}
	if (profile.observations.some(o => profile.suppressed[o.field])) throw new Error("Invalid person profile storage");
	if (profile.state !== (Object.keys(profile.facts).length || profile.observations.length ? "ready" : "empty"))
		throw new Error("Invalid person profile storage");
}
export function emptyProfile(): PersonProfile {
	return {
		schemaVersion: 1,
		revision: 0,
		state: "empty",
		facts: {},
		provenance: {},
		observations: [],
		suppressed: {},
		configuredSources: [],
	};
}
