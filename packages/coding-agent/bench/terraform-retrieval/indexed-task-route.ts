// Development-only adaptive task route; all reads use the pinned canonical index.
import type { Database } from "bun:sqlite";
import {
	terraformProviderSetupDestination,
	terraformTaskDestination,
} from "../../src/internal-urls/terraform-documentation";
import type { RankedProperty } from "./property-selection";
export interface TaskScope {
	providerType?: string;
	providerName?: string;
	// Query-derived identities are hints; caller-supplied filters remain binding.
	inferredIdentity?: boolean;
	filters?: Array<{ key: string; value: string }>;
	node?: string;
}
export function resolveIndexedTask(
	db: Database,
	query: string,
	scope: TaskScope,
): { kind: "leaf" | "choices" | "none"; destinations: RankedProperty[]; reason: string } | undefined {
	const argumentReference =
		/\bprovider\b/i.test(query) &&
		/\bargument reference\b|\bprovider block\b.*\b(?:arguments?|options?)\b/i.test(query) &&
		!/\bresource|\bdata[ -]source|\baction\b/i.test(query);
	const setup = argumentReference ? "argument-reference" : terraformProviderSetupDestination(query);
	const task = setup ? undefined : terraformTaskDestination(query);
	if (!setup && !task) return undefined;
	const clauses: string[] = [],
		values: Array<string | number | null> = [];
	if (setup) {
		if (/\bxcsh_(?!provider\b)[a-z][a-z0-9_]*\b/i.test(query))
			return { kind: "none", destinations: [], reason: "Incompatible explicit provider identifier for setup" };
		if (!scope.inferredIdentity && scope.providerName && scope.providerName !== "setup")
			return { kind: "none", destinations: [], reason: "Incompatible provider name for setup" };
		clauses.push("d.provider_type='provider'", "d.provider_name='setup'", "s.anchor=?");
		if (setup === "authentication-options") {
			clauses.pop();
			const certificate = /\bcertificates?\b|\bmutual[ -]tls\b|\bmtls\b/i.test(query);
			const anchors = certificate
				? ["option-2-p12-certificate-authentication", "option-3-pem-certificate-authentication"]
				: [
						"option-1-api-token-authentication",
						"option-2-p12-certificate-authentication",
						"option-3-pem-certificate-authentication",
					];
			clauses.push(`s.anchor IN (${anchors.map(() => "?").join(",")})`);
			values.push(...anchors);
		} else values.push(setup);
	} else {
		if (!scope.providerName)
			return { kind: "choices", destinations: [], reason: "Missing provider identity for task" };
		clauses.push("d.provider_name=?", "d.role=?");
		values.push(scope.providerName, task!.role);
		if (task!.anchor) {
			clauses.push("s.anchor=?");
			values.push(task!.anchor);
		} else clauses.push("s.ordinal=0");
	}
	if (scope.providerType && !(setup && scope.inferredIdentity)) {
		clauses.push("d.provider_type=?");
		values.push(scope.providerType);
	}
	for (const filter of scope.filters ?? []) {
		clauses.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=d.path AND f.facet=? AND f.value=?)");
		values.push(filter.key, filter.value);
	}
	if (scope.node) {
		if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scope.node))
			throw new Error("Task node not found");
		clauses.push(
			"d.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT child.id FROM terraform_documents child JOIN descendants parent ON child.parent_id=parent.id) SELECT id FROM descendants)",
		);
		values.push(scope.node);
	}
	const rows = db
		.query(
			`SELECT d.provider_type,d.provider_name,d.path,d.summary,s.anchor,s.context_markdown FROM terraform_documents d JOIN terraform_sections s ON s.path=d.path WHERE ${clauses.join(" AND ")} ORDER BY d.path,s.anchor LIMIT 10`,
		)
		.all(...values) as Array<{
		provider_type: string;
		provider_name: string;
		path: string;
		summary: string;
		anchor: string;
		context_markdown: string;
	}>;
	const identifiers = (query.toLowerCase().match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) ?? []).filter(
		term => !term.startsWith("xcsh_") && term !== scope.providerName,
	);
	if (
		identifiers.some(
			term =>
				!rows.some(row =>
					(
						`${row.summary} ${row.context_markdown}`.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? ([] as string[])
					).includes(term),
				),
		)
	)
		return { kind: "none", destinations: [], reason: "Unsupported explicit task identifier" };
	const destinations = rows.map(row => ({
		provider_type: row.provider_type,
		provider_name: row.provider_name,
		path: row.path,
		anchor: row.anchor,
		schema_path: "",
		description: row.summary,
		score: 100,
		coverage: 1,
	}));
	const methodChoice = setup === "authentication-options";
	return {
		kind: !rows.length ? "none" : rows.length > 1 || methodChoice ? "choices" : "leaf",
		destinations,
		reason: methodChoice
			? "Missing authentication method"
			: rows.length > 1
				? "Missing provider role"
				: "Exact documented task section",
	};
}
