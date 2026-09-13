import { $which } from "@f5-sales-demo/pi-utils";
import { type CliResult, runCli } from "./collectors";
import type { UserProfile, UserProfileObservation } from "./schema";
import type { ProfileCollector } from "./service";

type Runner = (argv: string[], signal?: AbortSignal) => Promise<CliResult>;
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() && value.length <= 4096 ? value.trim() : undefined;
const escapeSoql = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

/** Feature-detect territory fields; never interpolate arbitrary metadata into SOQL. */
export function rankTerritoryCandidates(fields: unknown[]): string[] {
	return fields
		.map(object)
		.filter(
			field =>
				typeof field.name === "string" &&
				/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name) &&
				/territor/i.test(`${field.name} ${field.label ?? ""}`) &&
				field.groupable === true &&
				field.filterable === true,
		)
		.flatMap(field => {
			const name = field.name as string;
			if (["string", "picklist", "combobox"].includes(String(field.type))) return [name];
			if (
				field.type === "reference" &&
				Array.isArray(field.referenceTo) &&
				field.referenceTo.some(target => target === "Territory2" || target === "Territory")
			)
				return name.endsWith("__c")
					? [`${name.slice(0, -3)}__r.Name`]
					: name.endsWith("Id")
						? [`${name.slice(0, -2)}.Name`]
						: [];
			return [];
		})
		.sort()
		.slice(0, 8);
}
function readPath(value: unknown, path: string): string | undefined {
	for (const part of path.split(".")) value = object(value)[part];
	return text(value);
}

/** Restore person-related business discovery without requiring external extensions or storing pipeline records. */
export function createSalesforceRelationshipCollector(
	loadFacts: () => Promise<UserProfile>,
	run: Runner = (argv, signal) => runCli(argv, undefined, signal),
	available: () => boolean = () => Boolean($which("sf")),
): ProfileCollector {
	return {
		id: "salesforce_relationships",
		name: "Salesforce role and relationships",
		timeoutMs: 60000,
		available: async () => available(),
		async collect(signal) {
			const query = async (argv: string[]): Promise<Record<string, unknown>> => {
				const response = await run(argv, signal);
				if (response.exitCode !== 0) throw new Error("Salesforce discovery unavailable");
				try {
					return object(object(JSON.parse(response.stdout)).result);
				} catch {
					throw new Error("Salesforce discovery unavailable");
				}
			};
			const records = async (soql: string): Promise<Record<string, unknown>[]> => {
				const result = await query(["sf", "data", "query", "--query", soql, "--json"]);
				if (!Array.isArray(result.records)) throw new Error("Salesforce discovery unavailable");
				return result.records.map(object);
			};
			const facts = await loadFacts(),
				userId = facts.identifiers?.salesforceId;
			const observations: UserProfileObservation[] = [];
			if (!userId || !/^[A-Za-z0-9]{15,18}$/.test(userId)) return { facts: {}, observations };
			const org = await query(["sf", "org", "display", "--json"]),
				username = text(org.username);
			if (!username || username.length > 320) throw new Error("Salesforce discovery unavailable");
			const user = (
				await records(`SELECT Id, UserRole.Name FROM User WHERE Username = '${escapeSoql(username)}'`)
			)[0];
			// A different authenticated principal must not redirect relationship discovery to another human.
			if (!user || user.Id !== userId) return { facts: {}, observations };
			const now = new Date().toISOString();
			const role = text(object(user.UserRole).Name);
			if (role)
				observations.push({
					field: "role",
					value: role,
					source: "salesforce_relationships",
					kind: "observed",
					observedAt: now,
				});
			await Promise.all([
				(async () => {
					const peers = await records(
						`SELECT UserId, User.Name, User.Title, COUNT(Id) cnt FROM OpportunityTeamMember WHERE OpportunityId IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false) AND UserId != '${userId}' GROUP BY UserId, User.Name, User.Title ORDER BY COUNT(Id) DESC LIMIT 3`,
					);
					const top = peers[0];
					if (!top) return;
					const person = object(top.User),
						name = text(person.Name),
						id = text(top.UserId),
						title = text(person.Title);
					if (name && id)
						observations.push({
							field: "partner",
							value: { id, name, ...(title ? { title } : {}) },
							source: "salesforce_relationships",
							kind: "inferred",
							observedAt: now,
						});
				})().catch(() => {}),
				(async () => {
					const described = await query(["sf", "sobject", "describe", "--sobject", "Opportunity", "--json"]);
					const candidates = rankTerritoryCandidates(Array.isArray(described.fields) ? described.fields : []);
					const probes: { field: string; counts: Map<string, number> }[] = [];
					for (let offset = 0; offset < candidates.length; offset += 4) {
						if (signal?.aborted) return;
						const batch = await Promise.all(
							candidates.slice(offset, offset + 4).map(async field => {
								const counts = new Map<string, number>();
								try {
									const rows = await records(
										`SELECT Opportunity.${field} FROM OpportunityTeamMember WHERE UserId = '${userId}' AND Opportunity.IsClosed = false AND Opportunity.${field} != null`,
									);
									for (const row of rows) {
										const value = readPath(row.Opportunity, field);
										if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
									}
								} catch {
									/* One unsupported candidate must not discard other usable territory evidence. */
								}
								return { field, counts };
							}),
						);
						probes.push(...batch);
					}
					const covered = (probe: (typeof probes)[number]) =>
						[...probe.counts.values()].reduce((sum, count) => sum + count, 0);
					const best = probes
						.filter(probe => probe.counts.size > 0)
						.sort(
							(a, b) =>
								covered(b) - covered(a) || b.counts.size - a.counts.size || a.field.localeCompare(b.field),
						)[0];
					if (best)
						observations.push({
							field: "territories",
							value: [...best.counts.keys()].sort().slice(0, 100),
							source: "salesforce_relationships",
							kind: "inferred",
							observedAt: now,
						});
				})().catch(() => {}),
			]);
			return { facts: {}, observations };
		},
	};
}
