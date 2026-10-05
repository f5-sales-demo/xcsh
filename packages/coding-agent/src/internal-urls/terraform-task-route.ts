// Indexed adaptive task route; all reads use the pinned canonical index.
import type { Database } from "bun:sqlite";
import {
	terraformProviderSetupDestination,
	terraformTaskDestination,
	terraformTimeoutOperations,
} from "./terraform-documentation";
import type { RankedProperty } from "./terraform-property-selection";
export interface TaskScope {
	providerType?: string;
	providerName?: string;
	// Query-derived identities are hints; caller-supplied filters remain binding.
	inferredIdentity?: boolean;
	filters?: Array<{ key: string; value: string }>;
	node?: string;
}
function maintainedDestination(query: string): { path: string; anchor: string; anchors?: string[] } | undefined {
	if (/\b(?:aws|azure|gcp|google|oci|oracle)\s+(?:terraform\s+)?provider\b/i.test(query)) return undefined;
	if (/\bxcsh_(?!provider\b)[a-z0-9_]+\b/i.test(query)) return undefined;
	if (
		/\b(?:root|top[ -]level)\b/i.test(query) &&
		/\bxcsh\b/i.test(query) &&
		/\b(?:documentation|docs)\b/i.test(query) &&
		/\b(?:index|collection|link|navigation)\b/i.test(query)
	)
		return { path: "documentation/index.md", anchor: "xcsh-provider-documentation" };
	if (
		/\b(?:xcsh\s+(?:terraform\s+)?provider|provider\s+xcsh)\b/i.test(query) &&
		/\bterraform\s+version\b|\bversion\s+of\s+terraform\b/i.test(query) &&
		/\b(?:required|requirements?|support)\b/i.test(query)
	)
		return { path: "documentation/provider/setup/index.md", anchor: "requirements" };
	if (/\bnetwork\s+allowlists?\b/i.test(query) && /\b(?:guide|documentation|explain|documented)\b/i.test(query)) {
		if (/\bAWS\b/i.test(query) && /\bHTTPS\b/i.test(query) && /\bingress\b/i.test(query))
			return {
				path: "documentation/guides/network-allowlists/index.md",
				anchor: "aws-https-origin-ingress",
				...(/\b(?:pinned|compiled|bundled)\b/i.test(query) && /\b(?:release|provider)\b/i.test(query)
					? { anchors: ["aws-https-origin-ingress", "release-pinned-network-allowlists"] }
					: {}),
			};
		if (/\b(?:pinned|compiled|bundled)\b/i.test(query) && /\b(?:release|provider)\b/i.test(query))
			return {
				path: "documentation/guides/network-allowlists/index.md",
				anchor: "release-pinned-network-allowlists",
			};
	}
	return undefined;
}
function resolveMaintainedDestination(db: Database, query: string, scope: TaskScope) {
	const destination = maintainedDestination(query);
	if (!destination) return undefined;
	const anchors = destination.anchors ?? [destination.anchor];
	const clauses = ["d.path=?", `s.anchor IN (${anchors.map(() => "?").join(",")})`],
		values: Array<string> = [destination.path, ...anchors];
	if (!scope.inferredIdentity && scope.providerName) {
		clauses.push("d.provider_name=?");
		values.push(scope.providerName);
	}
	if (!scope.inferredIdentity && scope.providerType) {
		clauses.push("d.provider_type=?");
		values.push(scope.providerType);
	}
	for (const f of scope.filters ?? []) {
		clauses.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=d.path AND f.facet=? AND f.value=?)");
		values.push(f.key, f.value);
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
			`SELECT d.provider_type,d.provider_name,d.path,d.summary,s.anchor,s.context_markdown FROM terraform_documents d JOIN terraform_sections s ON s.path=d.path WHERE ${clauses.join(" AND ")} ORDER BY d.path,s.anchor LIMIT 2`,
		)
		.all(...values) as Array<{
		provider_type: string;
		provider_name: string;
		path: string;
		summary: string;
		anchor: string;
		context_markdown: string;
	}>;
	const identifiers = (query.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi) ?? []).map(term => term.toLowerCase());
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
		return { kind: "none" as const, destinations: [], reason: "Unsupported explicit maintained-document identifier" };
	return {
		kind: rows.length === 1 ? ("leaf" as const) : rows.length > 1 ? ("choices" as const) : ("none" as const),
		destinations: rows.map(row => ({ ...row, schema_path: "", description: row.summary, score: 100, coverage: 1 })),
		reason: "Exact maintained documentation destination",
	};
}
export function resolveIndexedTask(
	db: Database,
	query: string,
	scope: TaskScope,
): { kind: "leaf" | "choices" | "none"; destinations: RankedProperty[]; reason: string } | undefined {
	const maintained = resolveMaintainedDestination(db, query, scope);
	if (maintained) return maintained;
	const originalQuery = query;
	if (/\b(?:aws|azure|gcp|google|oci|oracle)\s+(?:terraform\s+)?provider\b/i.test(query)) return undefined;
	query = query.replace(
		/\bXCSH_(?:API_URL|API_TOKEN|P12_FILE|P12_PASSWORD|CACERT|CERT|KEY)\b/g,
		" environment variable ",
	);
	if (
		/\bprovider\b/i.test(query) &&
		/\b(?:environment|authenticat(?:ion|e)|credentials?)\b/i.test(query) &&
		/\bXCSH_[A-Z0-9_]+\b/.test(query)
	)
		return { kind: "none", destinations: [], reason: "Unsupported explicit task identifier" };
	const argumentReference =
		/\bprovider\b/i.test(query) &&
		/\bargument reference\b|\bprovider block\b.*\b(?:arguments?|options?)\b/i.test(query) &&
		!/\bresources?\b|\bdata[ -]sources?\b|\bactions?\b|\b(?:decryption|secret store|store provider|storage provider)\b/i.test(
			query,
		);
	const environmentSetup = /\bXCSH_[A-Z0-9_]+\b/.test(originalQuery)
		? terraformProviderSetupDestination(originalQuery)
		: undefined;
	const setup =
		environmentSetup ?? (argumentReference ? "argument-reference" : terraformProviderSetupDestination(originalQuery));
	const task = setup ? undefined : terraformTaskDestination(query);
	if (!setup && !task) return undefined;
	if (
		task?.role === "timeouts" &&
		scope.providerName &&
		/\b(?:adjust|change|set|configure|increase|decrease)\b/i.test(query) &&
		!terraformTimeoutOperations(query).length &&
		!(query.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi) ?? []).some(
			term => !term.startsWith("xcsh_") && term !== scope.providerName,
		) &&
		!/\b(?:explain|guidance|overview|example|format|written)\b|\bhow\b.*\bconfigure\b/i.test(query) &&
		db.query("SELECT 1 FROM sqlite_master WHERE name=?").get("terraform_destinations")
	) {
		const conditions = ["dest.provider_name=?", "dest.schema_path IN (?,?,?,?)"];
		const parameters: Array<string | number> = [
			scope.providerName,
			"timeouts.create",
			"timeouts.read",
			"timeouts.update",
			"timeouts.delete",
		];
		if (scope.providerType) {
			conditions.push("dest.provider_type=?");
			parameters.push(scope.providerType);
		}
		for (const filter of scope.filters ?? []) {
			conditions.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=dest.path AND f.facet=? AND f.value=?)");
			parameters.push(filter.key, filter.value);
		}
		if (scope.node) {
			if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scope.node))
				throw new Error("Task node not found");
			conditions.push(
				"dest.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT child.id,child.path FROM terraform_documents child JOIN descendants parent ON child.parent_id=parent.id) SELECT path FROM descendants)",
			);
			parameters.push(scope.node);
		}
		const destinations = (
			db
				.query(
					`SELECT dest.provider_type,dest.provider_name,dest.schema_path,dest.path,dest.anchor,dest.description FROM terraform_destinations dest WHERE ${conditions.join(" AND ")} ORDER BY dest.provider_type,dest.schema_path LIMIT 10`,
				)
				.all(...parameters) as RankedProperty[]
		).map(row => ({ ...row, score: 100, coverage: 1 }));
		if (destinations.length) return { kind: "choices", destinations, reason: "Missing lifecycle operation" };
	}
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
			const certificate =
				/\bcertificates?\b|\bmutual[ -]tls\b|\bmtls\b/i.test(query) &&
				!/\bapi[ -]token\b|\bXCSH_API_TOKEN\b/i.test(originalQuery);
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
		const words = scope.providerName.split("_");
		const variants = words.map((word, index) => {
			const variant = [...words];
			variant[index] = word.endsWith("s") ? word.slice(0, -1) : `${word}s`;
			return variant.join("_");
		});
		const cardinalityMissing =
			scope.inferredIdentity &&
			scope.providerType === "actions" &&
			!/\bxcsh_[a-z][a-z0-9_]*\b/i.test(query) &&
			!/\b(?:single|one|multiple|many|bulk|all|batch)\b/i.test(query);
		const names = cardinalityMissing ? [scope.providerName, ...variants] : [scope.providerName];
		clauses.push(`d.provider_name IN (${names.map(() => "?").join(",")})`, "d.role=?");
		values.push(...names, task!.role);
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
				!(
					/\b(?:draft|write|generate)\s+hcl\b/i.test(query) &&
					task?.anchor === "minimal-configuration" &&
					scope.providerName &&
					db
						.query(
							"SELECT 1 FROM terraform_destinations WHERE provider_name=? AND (? IS NULL OR provider_type=?) AND instr('.'||schema_path||'.',?)>0 LIMIT 1",
						)
						.get(scope.providerName, scope.providerType ?? null, scope.providerType ?? null, `.${term}.`)
				) &&
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
