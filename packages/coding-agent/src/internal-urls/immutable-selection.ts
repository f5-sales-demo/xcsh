import type { OpenAPISpec } from "./api-spec-types";

type ObjectValue = Record<string, unknown>;
export interface ImmutableGroup {
	path: string[];
	name: string;
	members: string[];
}
export function objectValue(value: unknown): ObjectValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
	return value as ObjectValue;
}
export function resolveSchema(schema: ObjectValue, spec: OpenAPISpec, seen = new Set<string>()): ObjectValue {
	const ref = schema.$ref;
	let result = { ...schema };
	if (typeof ref === "string") {
		if (!ref.startsWith("#/components/schemas/") || seen.has(ref)) return {};
		const target = spec.components?.schemas?.[ref.slice("#/components/schemas/".length)];
		if (!target) throw new Error(`Missing schema ${ref}`);
		result = { ...resolveSchema(target, spec, new Set([...seen, ref])), ...schema };
	}
	for (const child of (schema.allOf as ObjectValue[] | undefined) ?? []) {
		const resolved = resolveSchema(child, spec, seen);
		result = {
			...result,
			...resolved,
			properties: { ...(result.properties as ObjectValue), ...(resolved.properties as ObjectValue) },
			required: [...new Set([...((result.required as string[]) ?? []), ...((resolved.required as string[]) ?? [])])],
		};
	}
	return result;
}
export function immutableGroups(
	schema: ObjectValue,
	spec: OpenAPISpec,
	path: string[] = [],
	seen = new Set<string>(),
): ImmutableGroup[] {
	if (typeof schema.$ref === "string" && seen.has(schema.$ref)) return [];
	const next = new Set(seen);
	if (typeof schema.$ref === "string") next.add(schema.$ref);
	const resolved = resolveSchema(schema, spec);
	const groups: ImmutableGroup[] = [];
	for (const [name, members] of Object.entries((resolved["x-f5xc-immutable-oneof-groups"] as ObjectValue) ?? {})) {
		if (!Array.isArray(members) || members.length < 2 || !members.every(m => typeof m === "string"))
			throw new Error(`Invalid immutable group ${name}`);
		groups.push({ path, name, members });
	}
	for (const [name, child] of Object.entries((resolved.properties as ObjectValue) ?? {}))
		groups.push(...immutableGroups(objectValue(child), spec, [...path, name], next));
	return groups;
}
export function valueAt(value: ObjectValue, path: string[]): ObjectValue {
	let result = value;
	for (const key of path) result = objectValue(result[key]);
	return result;
}
export function selectedMember(value: ObjectValue, group: ImmutableGroup): string {
	const owner = valueAt(value, group.path);
	const selected = group.members.filter(member => owner[member] !== undefined && owner[member] !== null);
	if (selected.length !== 1)
		throw new Error(`${[...group.path, group.name].join(".")} requires exactly one of ${group.members.join(", ")}`);
	objectValue(owner[selected[0]!]);
	return selected[0]!;
}
export function formatImmutableGroups(groups: ImmutableGroup[]): string {
	return groups
		.map(
			g =>
				`Immutable selection ${[...g.path, g.name].join(".")}: ${g.members.join(" | ")}. Changing the selected member requires DELETE then POST; child settings remain mutable.`,
		)
		.join("\n");
}
export function createBody(value: unknown, schema: ObjectValue, spec: OpenAPISpec): unknown {
	const s = resolveSchema(schema, spec);
	if (value === null || value === undefined || s.readOnly === true || s["x-field-mutability"] === "read-only")
		return undefined;
	if (Array.isArray(value)) return value.map(v => createBody(v, objectValue(s.items ?? {}), spec));
	if (typeof value !== "object") return value;
	const props = s.properties as ObjectValue | undefined;
	const out: ObjectValue = {};
	const input = { ...(value as ObjectValue) };
	if (
		props?.response_body_encoded &&
		typeof input.response_body === "string" &&
		input.response_body &&
		!input.response_body_encoded
	)
		input.response_body_encoded = `string:///${Buffer.from(input.response_body).toString("base64")}`;
	for (const [key, child] of Object.entries(input)) {
		if (props && !(key in props)) continue;
		const childSchema = props?.[key] ?? (typeof s.additionalProperties === "object" ? s.additionalProperties : {});
		const projected = createBody(child, objectValue(childSchema), spec);
		if (projected !== undefined) out[key] = projected;
	}
	return out;
}
export function validateBody(value: unknown, schema: ObjectValue, spec: OpenAPISpec, path = "body"): string[] {
	const s = resolveSchema(schema, spec);
	const errors: string[] = [];
	if (value === undefined || value === null) return errors;
	const type = Array.isArray(value) ? "array" : typeof value;
	if (
		typeof s.type === "string" &&
		s.type !== type &&
		!(s.type === "integer" && typeof value === "number" && Number.isInteger(value))
	)
		return [`${path}: expected ${s.type}`];
	if (Array.isArray(s.enum) && !s.enum.includes(value)) errors.push(`${path}: invalid enum value`);
	if (typeof value === "number") {
		if (typeof s.minimum === "number" && value < s.minimum) errors.push(`${path}: below minimum`);
		if (typeof s.maximum === "number" && value > s.maximum) errors.push(`${path}: above maximum`);
	}
	if (typeof value === "string") {
		if (typeof s.minLength === "number" && value.length < s.minLength) errors.push(`${path}: too short`);
		if (typeof s.maxLength === "number" && value.length > s.maxLength) errors.push(`${path}: too long`);
		if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
	}
	if (Array.isArray(value)) {
		if (typeof s.minItems === "number" && value.length < s.minItems) errors.push(`${path}: too few items`);
		if (typeof s.maxItems === "number" && value.length > s.maxItems) errors.push(`${path}: too many items`);
		value.forEach((v, i) => {
			errors.push(...validateBody(v, objectValue(s.items ?? {}), spec, `${path}[${i}]`));
		});
	} else if (typeof value === "object") {
		const o = objectValue(value);
		for (const key of (s.required as string[] | undefined) ?? [])
			if (o[key] === undefined || o[key] === null) errors.push(`${path}.${key}: required`);
		for (const [key, child] of Object.entries(o)) {
			const p = (s.properties as ObjectValue)?.[key];
			if (p) errors.push(...validateBody(child, objectValue(p), spec, `${path}.${key}`));
		}
		for (const [key, members] of Object.entries(s))
			if (key.startsWith("x-ves-oneof-field-")) {
				const choices = typeof members === "string" ? JSON.parse(members) : members;
				if (Array.isArray(choices) && choices.filter(k => o[k] !== undefined && o[k] !== null).length > 1)
					errors.push(`${path}.${key}: mutually exclusive members`);
			}
	}
	return errors;
}
export interface MutationContract {
	spec: OpenAPISpec;
	schema: ObjectValue;
	createSchema: ObjectValue;
	groups: ImmutableGroup[];
	collection: string;
}
export function mutationContract(
	data: Readonly<Record<string, unknown>>,
	method: string,
	path: string,
): MutationContract | undefined {
	for (const raw of Object.values(data)) {
		const spec = raw as OpenAPISpec;
		for (const [template, operations] of Object.entries(spec.paths)) {
			const parts = template.split("/");
			const actual = path.split("/");
			if (parts.length !== actual.length || !parts.every((p, i) => /^\{[^}]+\}$/.test(p) || p === actual[i]))
				continue;
			const op = operations[method.toLowerCase()];
			if (!op?.requestBody) continue;
			const schema = ((op.requestBody.content as ObjectValue)?.["application/json"] as ObjectValue)
				?.schema as ObjectValue;
			if (!schema) continue;
			const groups = immutableGroups(schema, spec);
			if (!groups.length) continue;
			const collection = path.slice(0, path.lastIndexOf("/"));
			const createTemplate = template.slice(0, template.lastIndexOf("/"));
			const create = (
				(spec.paths[createTemplate]?.post?.requestBody?.content as ObjectValue)?.["application/json"] as ObjectValue
			)?.schema as ObjectValue;
			if (!create) throw new Error("Immutable mutation has no create schema");
			return { spec, schema, createSchema: create, groups, collection };
		}
	}
	return undefined;
}
