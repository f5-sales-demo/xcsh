import type { TerraformRelationship } from "./terraform-documentation";

/** Derive symmetric peer edges only from verified provider choice/conflict groups. */
export function verifiedChoiceEdges(relationships: readonly TerraformRelationship[]) {
	const groups = new Map<string, TerraformRelationship[]>();
	for (const relationship of relationships) {
		if (
			!["conflicts", "choice"].includes(relationship.type) ||
			relationship.enforcement !== "provider-schema" ||
			!relationship.group
		)
			continue;
		const key = JSON.stringify([
			relationship.type,
			relationship.enforcement,
			relationship.source,
			relationship.group,
		]);
		const members = groups.get(key) ?? [];
		if (!members.some(row => row.target_id === relationship.target_id && row.anchor === relationship.anchor))
			members.push(relationship);
		groups.set(key, members);
	}
	const edges = [];
	for (const members of groups.values())
		for (const source of members)
			for (const target of members) {
				if (source.target_id === target.target_id && source.anchor === target.anchor) continue;
				edges.push({ ...target, source_id: source.target_id, source_anchor: source.anchor });
			}
	return edges.sort((a, b) => {
		const left = JSON.stringify([
			a.source_id,
			a.source_anchor,
			a.target_id,
			a.anchor,
			a.type,
			a.enforcement,
			a.source,
			a.group,
		]);
		const right = JSON.stringify([
			b.source_id,
			b.source_anchor,
			b.target_id,
			b.anchor,
			b.type,
			b.enforcement,
			b.source,
			b.group,
		]);
		return left < right ? -1 : left > right ? 1 : 0;
	});
}
