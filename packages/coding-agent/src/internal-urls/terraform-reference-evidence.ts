export interface TerraformReferenceIdentity {
	version: 1;
	scope_path: string[];
	member: "name" | "namespace" | "tenant" | "kind" | "uid";
	upstream_message: "ves.io.schema.ObjectRefType" | "ves.io.schema.views.ObjectRefType";
	source: "receipt-pinned-schema-identity";
}
export function validateReferenceIdentity(value: unknown, schemaPath: readonly string[]): TerraformReferenceIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid Terraform reference identity");
	const r = value as Record<string, unknown>;
	if (
		r.version !== 1 ||
		r.source !== "receipt-pinned-schema-identity" ||
		!["ves.io.schema.ObjectRefType", "ves.io.schema.views.ObjectRefType"].includes(r.upstream_message as string) ||
		!["name", "namespace", "tenant", "kind", "uid"].includes(r.member as string) ||
		!Array.isArray(r.scope_path) ||
		!r.scope_path.length ||
		!r.scope_path.every(v => typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(v)) ||
		schemaPath.length !== r.scope_path.length + 1 ||
		schemaPath.at(-1) !== r.member ||
		!r.scope_path.every((v, index) => v === schemaPath[index])
	)
		throw new Error("Invalid Terraform reference identity");
	return value as TerraformReferenceIdentity;
}
