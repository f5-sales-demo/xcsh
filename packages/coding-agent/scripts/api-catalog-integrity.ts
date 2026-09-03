// Keep this definition aligned with api-specs-enriched's catalog compiler. HEAD/TRACE
// path entries are OpenAPI metadata in this corpus, not authoritative xcsh operations.
const HTTP_METHODS = new Set(["delete", "get", "options", "patch", "post", "put"]);
const CANONICAL_CRUD_RE = /\.API\.(Create|List|Get|Replace|Delete)$/;

export interface CatalogOperationLike {
	operationId?: string;
	method?: string;
	path?: string;
	minimumPayload?: { json?: unknown };
}

export interface CatalogCategoryLike {
	name: string;
	operations?: CatalogOperationLike[];
}

export interface OpenApiDocumentLike {
	paths?: Record<string, Record<string, unknown>>;
	components?: { schemas?: Record<string, Record<string, unknown>> };
}

export interface CanonicalCrudOperation {
	method: string;
	path: string;
	operationId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeApiPath(apiPath: string): string {
	return apiPath.replace(/\{(?:metadata|system_metadata)\.(namespace|name)\}/g, "{$1}");
}

export function buildPathToCatalogCategories(
	categories: readonly CatalogCategoryLike[],
): ReadonlyMap<string, readonly string[]> {
	const mapped = new Map<string, Set<string>>();
	for (const category of categories) {
		for (const operation of category.operations ?? []) {
			if (!operation.path) continue;
			const normalizedPath = normalizeApiPath(operation.path);
			const names = mapped.get(normalizedPath) ?? new Set<string>();
			names.add(category.name);
			mapped.set(normalizedPath, names);
		}
	}
	return new Map(
		[...mapped.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([apiPath, names]) => [apiPath, [...names].sort((left, right) => left.localeCompare(right))]),
	);
}

export function authoritativeOperations(specs: readonly OpenApiDocumentLike[]): CanonicalCrudOperation[] {
	const operations = new Map<string, CanonicalCrudOperation>();
	for (const spec of specs) {
		for (const [apiPath, pathItem] of Object.entries(spec.paths ?? {})) {
			for (const [method, rawOperation] of Object.entries(pathItem)) {
				if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(rawOperation)) continue;
				const operationId = rawOperation.operationId;
				if (typeof operationId !== "string" || operationId.length === 0) continue;
				const operation = { method: method.toUpperCase(), path: normalizeApiPath(apiPath), operationId };
				operations.set(operationKey(operation), operation);
			}
		}
	}
	return [...operations.values()].sort(compareOperations);
}

function compareOperations(left: CanonicalCrudOperation, right: CanonicalCrudOperation): number {
	return (
		left.method.localeCompare(right.method) ||
		left.path.localeCompare(right.path) ||
		left.operationId.localeCompare(right.operationId)
	);
}

export function deriveCanonicalCrudOperations(
	spec: OpenApiDocumentLike,
	resourcePaths: readonly string[],
): CanonicalCrudOperation[] {
	const normalizedPaths = new Set(resourcePaths.map(normalizeApiPath));
	return authoritativeOperations([spec])
		.filter(operation => CANONICAL_CRUD_RE.test(operation.operationId) && normalizedPaths.has(operation.path))
		.sort(compareOperations);
}

export function assertCanonicalCrudMapped(
	resourceIdentity: string,
	canonicalOperations: readonly CanonicalCrudOperation[],
	mappedCategoryNames: readonly string[],
	categories: readonly CatalogCategoryLike[],
): void {
	for (const operation of canonicalOperations) {
		const catalogContainsOperation = mappedCategoryNames.some(categoryName =>
			categories
				.find(category => category.name === categoryName)
				?.operations?.some(
					catalogOperation =>
						catalogOperation.operationId === operation.operationId &&
						String(catalogOperation.method).toUpperCase() === operation.method &&
						normalizeApiPath(String(catalogOperation.path)) === operation.path,
				),
		);
		if (!catalogContainsOperation) {
			throw new Error(
				`Canonical CRUD operation ${operation.operationId} for ${resourceIdentity} is absent from catalog categories`,
			);
		}
	}
}

function operationKey(operation: CanonicalCrudOperation): string {
	return `${operation.method} ${operation.path} ${operation.operationId}`;
}

function resolveSchema(
	schema: Record<string, unknown>,
	spec: OpenApiDocumentLike,
	seen = new Set<string>(),
): Record<string, unknown> {
	const ref = schema.$ref;
	if (typeof ref === "string") {
		const prefix = "#/components/schemas/";
		if (!ref.startsWith(prefix) || seen.has(ref)) throw new Error(`cannot resolve schema reference ${ref}`);
		const target = spec.components?.schemas?.[decodeURIComponent(ref.slice(prefix.length))];
		if (!target) throw new Error(`cannot resolve schema reference ${ref}`);
		return resolveSchema(target, spec, new Set([...seen, ref]));
	}

	const allOf = Array.isArray(schema.allOf) ? schema.allOf : [];
	if (allOf.length === 0) return schema;
	const merged: Record<string, unknown> = { ...schema };
	delete merged.allOf;
	const required = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
	const properties: Record<string, unknown> = isRecord(schema.properties) ? { ...schema.properties } : {};
	for (const member of allOf) {
		if (!isRecord(member)) continue;
		const resolved = resolveSchema(member, spec, seen);
		Object.assign(merged, resolved);
		if (isRecord(resolved.properties)) Object.assign(properties, resolved.properties);
		if (Array.isArray(resolved.required)) for (const field of resolved.required) required.add(String(field));
	}
	if (Object.keys(properties).length > 0) merged.properties = properties;
	if (required.size > 0) merged.required = [...required];
	return merged;
}

function validateValue(
	value: unknown,
	rawSchema: Record<string, unknown>,
	spec: OpenApiDocumentLike,
	location: string,
): string[] {
	let schema: Record<string, unknown>;
	try {
		schema = resolveSchema(rawSchema, spec);
	} catch (error) {
		return [`${location}: ${error instanceof Error ? error.message : String(error)}`];
	}

	const alternatives = Array.isArray(schema.oneOf)
		? schema.oneOf
		: Array.isArray(schema.anyOf)
			? schema.anyOf
			: undefined;
	if (alternatives) {
		const results = alternatives
			.filter(isRecord)
			.map(alternative => validateValue(value, alternative, spec, location));
		if (results.some(errors => errors.length === 0)) return [];
		return [`${location}: does not match any declared schema variant`];
	}

	const type = schema.type;
	if (type === "object" || isRecord(schema.properties)) {
		if (!isRecord(value)) return [`${location}: expected object`];
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const errors: string[] = [];
		for (const key of Object.keys(value)) {
			if (!(key in properties)) errors.push(`${location}.${key}: property is not declared by the request schema`);
		}
		for (const required of Array.isArray(schema.required) ? schema.required : []) {
			if (!(String(required) in value)) errors.push(`${location}.${String(required)}: required property is missing`);
		}
		for (const [key, child] of Object.entries(value)) {
			const childSchema = properties[key];
			if (isRecord(childSchema)) errors.push(...validateValue(child, childSchema, spec, `${location}.${key}`));
		}
		return errors;
	}
	if (type === "array") {
		if (!Array.isArray(value)) return [`${location}: expected array`];
		const itemSchema = schema.items;
		if (isRecord(itemSchema))
			return value.flatMap((item, index) => validateValue(item, itemSchema, spec, `${location}[${index}]`));
		return [];
	}
	if (type === "string" && typeof value !== "string") return [`${location}: expected string`];
	if ((type === "integer" && !Number.isInteger(value)) || (type === "number" && typeof value !== "number")) {
		return [`${location}: expected ${type}`];
	}
	if (type === "boolean" && typeof value !== "boolean") return [`${location}: expected boolean`];
	return [];
}

function requestSchema(operation: Record<string, unknown>): Record<string, unknown> | undefined {
	const requestBody = operation.requestBody;
	if (!isRecord(requestBody) || !isRecord(requestBody.content)) return undefined;
	const mediaType = requestBody.content["application/json"] ?? requestBody.content["application/yaml"];
	return isRecord(mediaType) && isRecord(mediaType.schema) ? mediaType.schema : undefined;
}

export function assertCatalogIntegrity(
	categories: readonly CatalogCategoryLike[],
	specs: readonly OpenApiDocumentLike[],
): void {
	const authoritative = authoritativeOperations(specs);
	const catalogOperations = categories.flatMap(category =>
		(category.operations ?? []).map(operation => ({
			method: String(operation.method ?? "").toUpperCase(),
			path: normalizeApiPath(String(operation.path ?? "")),
			operationId: String(operation.operationId ?? ""),
		})),
	);
	const authoritativeKeys = authoritative.map(operationKey).sort();
	const catalogKeys = catalogOperations.map(operationKey).sort();
	if (new Set(catalogKeys).size !== catalogKeys.length) throw new Error("API catalog contains duplicate operations");
	if (JSON.stringify(catalogKeys) !== JSON.stringify(authoritativeKeys)) {
		const missing = authoritativeKeys.filter(key => !new Set(catalogKeys).has(key));
		const extra = catalogKeys.filter(key => !new Set(authoritativeKeys).has(key));
		throw new Error(
			`API catalog inventory differs from the authoritative specs (${missing.length} missing, ${extra.length} extra): missing=${JSON.stringify(missing.slice(0, 5))}, extra=${JSON.stringify(extra.slice(0, 5))}`,
		);
	}

	const authoritativeById = new Map<string, { operation: Record<string, unknown>; spec: OpenApiDocumentLike }>();
	for (const spec of specs) {
		for (const pathItem of Object.values(spec.paths ?? {})) {
			for (const [method, rawOperation] of Object.entries(pathItem)) {
				if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(rawOperation)) continue;
				if (typeof rawOperation.operationId === "string") {
					authoritativeById.set(rawOperation.operationId, { operation: rawOperation, spec });
				}
			}
		}
	}

	for (const category of categories) {
		for (const operation of category.operations ?? []) {
			if (!operation.minimumPayload) continue;
			const match = operation.operationId ? authoritativeById.get(operation.operationId) : undefined;
			if (!match) throw new Error(`Catalog operation ${operation.operationId ?? "<missing>"} is not authoritative`);
			const schema = requestSchema(match.operation);
			if (!schema)
				throw new Error(`Catalog operation ${operation.operationId} publishes a payload without a request schema`);
			const errors = validateValue(operation.minimumPayload.json, schema, match.spec, "payload");
			if (errors.length > 0)
				throw new Error(`Invalid minimum payload for ${operation.operationId}: ${errors.join("; ")}`);
		}
	}
}
