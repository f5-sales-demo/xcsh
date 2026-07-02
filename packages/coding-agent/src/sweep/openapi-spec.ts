/**
 * Build a minimal valid create-spec for a resource by walking the enriched
 * OpenAPI schemas. Driven by the `x-f5xc-minimum-configuration` annotation
 * (required_fields + mutually_exclusive_groups), `x-f5xc-recommended-oneof-variant`,
 * and per-field `x-ves-example` / `x-f5xc-example`. Pure: callers pass a schema
 * index { schemaName -> schema } so the walk is unit-testable without disk/network.
 *
 * Output: { metadata: {name, namespace}, spec: {...} } — feed to the JSON-tab
 * create path, or POST to validate. Walker output is a best-effort SEED; the API
 * is the source of truth (validate, and fall back to error-driven probing).
 */

type Schema = Record<string, any>;
export type SchemaIndex = Record<string, Schema>;

const MAX_DEPTH = 6;

/** Resolve a `#/components/schemas/X` ref (or bare name) to its schema. */
function deref(index: SchemaIndex, ref: string | undefined): Schema | undefined {
	if (!ref) return undefined;
	return index[ref.split("/").pop() as string];
}

/** Follow allOf[single]/$ref down to the concrete object schema. */
function concrete(index: SchemaIndex, schema: Schema | undefined, depth = 0): Schema | undefined {
	if (!schema || depth > MAX_DEPTH) return schema;
	if (schema.$ref) return concrete(index, deref(index, schema.$ref), depth + 1);
	if (Array.isArray(schema.allOf) && schema.allOf.length === 1) {
		return concrete(index, schema.allOf[0], depth + 1);
	}
	return schema;
}

function exampleOf(schema: Schema): unknown {
	// Prefer x-f5xc-example: x-ves-example sometimes carries display artifacts
	// (e.g. a trailing "." on a CIDR) that fail server validation.
	return schema["x-f5xc-example"] ?? schema["x-ves-example"];
}

/** All field names that belong to any `x-ves-oneof-field-*` group on this schema. */
function oneofMemberSet(schema: Schema): Set<string> {
	const set = new Set<string>();
	for (const [key, val] of Object.entries(schema)) {
		if (!key.startsWith("x-ves-oneof-field-")) continue;
		try {
			const members = typeof val === "string" ? JSON.parse(val) : (val as string[]);
			for (const m of members) set.add(m);
		} catch {
			/* ignore malformed oneof annotation */
		}
	}
	return set;
}

/**
 * The create-required field names for a spec/object schema (strips spec./metadata.).
 * Excludes oneof members — exactly one per group is added separately via
 * chosenOneofMembers, so including all of them would violate exclusivity.
 */
export function requiredSpecFields(schema: Schema): string[] {
	const mc = schema["x-f5xc-minimum-configuration"];
	const raw: string[] = (mc && Array.isArray(mc.required_fields) ? mc.required_fields : []) as string[];
	const props = schema.properties ?? {};
	const oneofs = oneofMemberSet(schema);
	const out: string[] = [];
	for (const entry of raw) {
		if (entry.startsWith("metadata.")) continue;
		const field = entry.startsWith("spec.") ? entry.slice(5) : entry;
		if (field in props && !oneofs.has(field) && !out.includes(field)) out.push(field);
	}
	return out;
}

/** For each mutually-exclusive group, the chosen member field (recommended or first). */
export function chosenOneofMembers(schema: Schema): string[] {
	const chosen: string[] = [];
	const recommended: Record<string, string> = schema["x-f5xc-recommended-oneof-variant"] ?? {};
	for (const [key, val] of Object.entries(schema)) {
		if (!key.startsWith("x-ves-oneof-field-")) continue;
		const group = key.slice("x-ves-oneof-field-".length);
		let members: string[] = [];
		try {
			members = typeof val === "string" ? JSON.parse(val) : (val as string[]);
		} catch {
			members = [];
		}
		if (!members.length) continue;
		const pick = recommended[group] && members.includes(recommended[group]) ? recommended[group] : members[0]!;
		if (pick && !chosen.includes(pick)) chosen.push(pick);
	}
	return chosen;
}

/** Produce a value for a single field schema (scalar / array / nested object). */
function valueForField(index: SchemaIndex, fieldSchema: Schema, depth: number): unknown {
	const s = concrete(index, fieldSchema, depth) ?? fieldSchema;
	if (s.type === "array") {
		const item = concrete(index, s.items, depth);
		return [item ? buildObjectOrScalar(index, item, depth + 1) : (exampleOf(s) ?? "xcsh-sweep")];
	}
	return buildObjectOrScalar(index, s, depth);
}

/**
 * Derive a valid numeric value from the schema's validation rules. The OpenAPI
 * specs are the SINGLE SOURCE OF TRUTH for input constraints (gte/lte/gt/lt in
 * x-ves-validation-rules, or standard minimum/maximum). Falls back to the example,
 * then a safe default within the declared range — never a hardcoded guess.
 */
function numericValue(schema: Schema): number {
	const rules: Record<string, string> = schema["x-ves-validation-rules"] ?? {};
	const gte = rules["ves.io.schema.rules.uint32.gte"] ?? rules["ves.io.schema.rules.int32.gte"];
	const lte = rules["ves.io.schema.rules.uint32.lte"] ?? rules["ves.io.schema.rules.int32.lte"];
	const gt = rules["ves.io.schema.rules.uint32.gt"] ?? rules["ves.io.schema.rules.int32.gt"];
	const lt = rules["ves.io.schema.rules.uint32.lt"] ?? rules["ves.io.schema.rules.int32.lt"];
	const min = schema.minimum ?? (gte !== undefined ? Number(gte) : gt !== undefined ? Number(gt) + 1 : undefined);
	const max = schema.maximum ?? (lte !== undefined ? Number(lte) : lt !== undefined ? Number(lt) - 1 : undefined);
	// Prefer the example if in range.
	const ex = exampleOf(schema);
	if (ex !== undefined) {
		const n = Number(ex);
		if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) return n;
	}
	// Pick a value within the declared range.
	if (min !== undefined && max !== undefined) return Math.round((Number(min) + Number(max)) / 2);
	if (min !== undefined) return Number(min);
	if (max !== undefined) return Math.min(Number(max), 1);
	return 1;
}

/**
 * Derive a valid string value from the schema's constraints. Uses the example
 * (x-f5xc-example preferred), then enum[0], then format-aware fallbacks — all
 * from the spec, no hardcoded guesses.
 */
function stringValue(schema: Schema): string {
	const ex = exampleOf(schema);
	if (typeof ex === "string" && ex) return ex;
	if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0] as string;
	const fmt = schema.format ?? "";
	if (/ipv4|ip_address/.test(fmt)) return "10.0.0.1";
	if (/ipv6/.test(fmt)) return "fd00::1";
	if (/uri|url/.test(fmt)) return "https://xcsh-sweep.example.com";
	if (/hostname|domain|fqdn/.test(fmt)) return "xcsh-sweep.example.com";
	if (/email/.test(fmt)) return "xcsh-sweep@example.com";
	// Check validation-rule patterns for CIDR/IP/domain/email hints
	const rules = JSON.stringify(schema["x-ves-validation-rules"] ?? {});
	if (/ipv4_prefix|cidr/.test(rules)) return "10.10.0.0/24";
	if (/ipv4_address/.test(rules)) return "10.0.0.1";
	if (/vh_domain|hostname/.test(rules)) return "xcsh-sweep.example.com";
	return "xcsh-sweep";
}

function buildObjectOrScalar(index: SchemaIndex, schema: Schema, depth: number): unknown {
	const s = concrete(index, schema, depth) ?? schema;
	// Object with its own required fields → recurse.
	if (s.type === "object" || s.properties) {
		if (depth >= MAX_DEPTH) return {};
		return buildSpecObject(index, s, depth + 1);
	}
	if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
	if (s.type === "integer" || s.type === "number") return numericValue(s);
	if (s.type === "boolean") {
		const ex = exampleOf(s);
		return ex !== undefined ? ex === "true" || ex === true : false;
	}
	return stringValue(s);
}

/** Build the object for a spec/sub-schema from its required fields + oneof choices. */
export function buildSpecObject(index: SchemaIndex, schema: Schema, depth = 0): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const props = schema.properties ?? {};
	const fields = [...requiredSpecFields(schema), ...chosenOneofMembers(schema)];
	for (const f of fields) {
		if (f in out) continue;
		const fs = props[f];
		if (!fs) continue;
		out[f] = valueForField(index, fs, depth);
	}
	return out;
}

/** Map a resource id (kebab) to its `<kind>CreateSpecType` schema name. */
export function specTypeName(apiKindSingular: string): string {
	return `${apiKindSingular}CreateSpecType`;
}

/**
 * Resolve the CreateSpecType schema for a kind, trying the known F5 naming
 * prefixes (bare, `schema`, `views`) — e.g. service_policy →
 * `schemaservice_policyCreateSpecType`, origin_pool → `viewsorigin_poolCreateSpecType`.
 */
export function findSpecType(index: SchemaIndex, apiKindSingular: string): Schema | undefined {
	for (const prefix of ["", "schema", "views"]) {
		const s = index[`${prefix}${apiKindSingular}CreateSpecType`];
		if (s) return s;
	}
	return undefined;
}

/**
 * Build the full minimal create body for a resource.
 * `apiKindSingular` is the singular API kind (e.g. "dns_zone", "healthcheck").
 */
export function buildMinimalSpec(
	index: SchemaIndex,
	apiKindSingular: string,
	name: string,
	namespace: string,
): { ok: boolean; body: Record<string, unknown>; reason?: string } {
	const schema = findSpecType(index, apiKindSingular);
	if (!schema) {
		return { ok: false, body: { metadata: { name, namespace }, spec: {} }, reason: "no CreateSpecType schema" };
	}
	const spec = buildSpecObject(index, schema, 0);
	return { ok: true, body: { metadata: { name, namespace }, spec } };
}
