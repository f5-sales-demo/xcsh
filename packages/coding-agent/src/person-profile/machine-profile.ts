import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { collectMachine } from "./machine-collectors";
import { PrivateProfileStore, type ProfileResetLease, type ProfileStoreStatus } from "./private-store";

const text = Type.String({ minLength: 1, maxLength: 4096 });
const count = Type.Integer({ minimum: 0 });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const ManagementSchema = Type.Partial(
	Type.Object(
		{
			isManaged: Type.Boolean(),
			mdmVendor: text,
			mdmVersion: text,
			depEnrolled: Type.Boolean(),
			isSupervised: Type.Boolean(),
			userApproved: Type.Boolean(),
			organizationName: text,
		},
		{ additionalProperties: false },
	),
);
const SecuritySchema = Type.Partial(
	Type.Object(
		{
			sipEnabled: Type.Boolean(),
			fileVaultEnabled: Type.Boolean(),
			gatekeeperEnabled: Type.Boolean(),
			firewallEnabled: Type.Boolean(),
			isAdmin: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
);
export type ManagementStatus = Static<typeof ManagementSchema>;
export type SecurityPosture = Static<typeof SecuritySchema>;
export const MachineFactsSchema = Type.Partial(
	Type.Object(
		{
			"@context": Type.Literal("https://schema.org"),
			"@type": Type.Literal("IndividualProduct"),
			name: text,
			machineModel: text,
			platform: text,
			osVersion: text,
			osRelease: text,
			architecture: text,
			cpuModel: text,
			cpuLogicalCores: count,
			cpuPhysicalCores: count,
			totalMemoryBytes: count,
			totalMemoryGB: Type.Number({ minimum: 0 }),
			gpu: text,
			diskTotal: text,
			diskFree: text,
			display: text,
			hostname: text,
			shell: text,
			terminal: text,
			installedTools: Type.Array(text, { maxItems: 100 }),
			management: ManagementSchema,
			security: SecuritySchema,
			endpointAgents: Type.Array(text, { maxItems: 100 }),
		},
		{
			additionalProperties: false,
			description:
				"Schema.org IndividualProduct identity with xcsh-specific runtime environment fields; observations do not grant authority",
		},
	),
);
export type MachineFacts = Static<typeof MachineFactsSchema>;
export const MachineProfileSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		revision: count,
		state: Type.Union([Type.Literal("empty"), Type.Literal("ready")]),
		facts: MachineFactsSchema,
		collectedAt: Type.Optional(timestamp),
		updatedAt: Type.Optional(timestamp),
	},
	{ additionalProperties: false },
);
export type MachineProfile = Static<typeof MachineProfileSchema>;
function validate(value: unknown): void {
	if (!Value.Check(MachineProfileSchema, value)) throw new Error("Invalid machine profile storage");
	if (value.state !== (Object.keys(value.facts).length ? "ready" : "empty"))
		throw new Error("Invalid machine profile storage");
}
/** One device cache, separate from the human schema and never selected by provider or transport. */
export class MachineProfileService {
	readonly #store: PrivateProfileStore<MachineProfile>;
	constructor(
		readonly path = join(homedir(), ".xcsh", "computer-profile.json"),
		private readonly collect = collectMachine,
		lockTimeoutMs = 10000,
	) {
		this.#store = new PrivateProfileStore<MachineProfile>(
			path,
			() => ({ schemaVersion: 1, revision: 0, state: "empty", facts: {} }),
			validate,
			profile => {
				profile.state = Object.keys(profile.facts).length ? "ready" : "empty";
			},
			"computer",
			lockTimeoutMs,
		);
	}
	get(): Promise<MachineProfile> {
		return this.#store.get();
	}
	status(): Promise<ProfileStoreStatus> {
		return this.#store.status();
	}
	reset(signal?: AbortSignal): Promise<boolean> {
		return this.#store.reset(signal);
	}
	acquireResetLease(signal?: AbortSignal): Promise<ProfileResetLease> {
		return this.#store.acquireResetLease(signal);
	}
	async refresh(signal?: AbortSignal, freshForMs = 0, canCommit?: () => boolean): Promise<MachineProfile> {
		if (signal?.aborted) throw new Error("Machine profile operation cancelled");
		const current = await this.get();
		if (Date.now() - Date.parse(current.collectedAt ?? "1970-01-01") < freshForMs) return current;
		const facts = await this.collect(signal);
		if (!Value.Check(MachineFactsSchema, facts)) throw new Error("Invalid machine profile collection");
		return this.#store.mutate(
			profile => {
				profile.facts = { ...facts, "@context": "https://schema.org", "@type": "IndividualProduct" };
				profile.collectedAt = new Date().toISOString();
			},
			undefined,
			signal,
			canCommit,
		);
	}
}
export const machineProfileService = new MachineProfileService();
