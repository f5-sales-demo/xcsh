import type { PropertyCandidate } from "../../src/internal-urls/terraform-property-ranking";

// Source-only candidate inventory for independent label review. It never decides
// whether a prompt supplies the distinguishing context or changes expected labels.
export function sourceCollisionAlternatives(expected: PropertyCandidate, source: readonly PropertyCandidate[]) {
	const leaf = expected.schema_path.split(".").at(-1);
	const description = expected.description.replace(/\s+/g, " ").trim();
	return source
		.filter(
			row =>
				row.provider_name === expected.provider_name &&
				row.schema_path.split(".").at(-1) === leaf &&
				row.description.replace(/\s+/g, " ").trim() === description,
		)
		.sort(
			(a, b) =>
				(a.provider_type < b.provider_type ? -1 : a.provider_type > b.provider_type ? 1 : 0) ||
				(a.schema_path < b.schema_path ? -1 : a.schema_path > b.schema_path ? 1 : 0),
		);
}
