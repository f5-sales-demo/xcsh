// Group equivalent leaves by the first undecided schema branch.
import { type PropertyCandidate, propertyQueryTerms, propertyTerms } from "./terraform-property-ranking";

export function terraformBranchChoices(rows: readonly PropertyCandidate[], limit = 5, query = ""): string[] {
	const terms = new Set(propertyQueryTerms(query));
	rows = rows.filter(row => {
		const path = new Set(propertyTerms(row.schema_path));
		return ![
			["mobile", "web"],
			["success", "failure"],
			["inside", "outside"],
			["ipv4", "ipv6"],
		].some(
			([a, b]) =>
				(terms.has(a!) && !terms.has(b!) && path.has(b!) && !path.has(a!)) ||
				(terms.has(b!) && !terms.has(a!) && path.has(a!) && !path.has(b!)),
		);
	});
	if (limit < 2 || rows.length <= limit) return [];
	const first = rows[0];
	if (
		!first ||
		rows.some(
			row =>
				row.provider_name !== first.provider_name ||
				row.provider_type !== first.provider_type ||
				row.description !== first.description ||
				row.schema_path.split(".").at(-1) !== first.schema_path.split(".").at(-1),
		)
	)
		return [];
	let paths = [...new Set(rows.map(row => row.schema_path))].map(value => value.split("."));
	if (paths.length <= limit) return [];
	for (let iteration = 0; iteration < 40; iteration++) {
		let depth = 0;
		while (paths.every(parts => parts[depth] !== undefined && parts[depth] === paths[0]![depth])) depth++;
		if (!paths.every(parts => depth < parts.length - 1)) return [];
		const segments = [...new Set(paths.map(parts => parts[depth]!))];
		const vocabulary = segments.map(segment => propertyTerms(segment));
		const named = segments.filter((_segment, index) =>
			vocabulary[index]!.some(
				term => terms.has(term) && !vocabulary.some((other, peer) => peer !== index && other.includes(term)),
			),
		);
		if (named.length === 1 && !["and", "or", "none"].some(operator => named[0]!.endsWith(`_${operator}`))) {
			paths = paths.filter(parts => parts[depth] === named[0]);
			if (paths.length <= limit) return [];
			continue;
		}
		const branches = [...new Set(paths.map(parts => parts.slice(0, depth + 1).join(".")))].sort();
		return branches.length >= 2 && branches.length <= limit ? branches : [];
	}
	return [];
}
