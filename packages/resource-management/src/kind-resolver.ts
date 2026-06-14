import type {
	ApiSpecDomainResource,
	ApiSpecIndex,
	ApiSpecValidationResourceEntry,
	KindResolver,
	ResolvedKind,
} from "./types";

export class KindResolutionError extends Error {
	readonly suggestions: string[];
	constructor(message: string, suggestions: string[] = []) {
		super(message);
		this.name = "KindResolutionError";
		this.suggestions = suggestions;
	}
}

export function createKindResolver(
	specIndex: ApiSpecIndex,
	validationData?: Readonly<Record<string, ApiSpecValidationResourceEntry>>,
): KindResolver {
	function resolveKind(kind: string): ResolvedKind {
		let foundWithoutPaths = false;
		for (const domain of specIndex.domains) {
			for (const resource of domain.resources) {
				if (resource.name === kind) {
					const paths = extractPaths(resource);
					if (!paths) {
						foundWithoutPaths = true;
						continue;
					}
					return {
						kind,
						domain: domain.domain,
						resource,
						paths,
						validation: validationData?.[kind],
					};
				}
			}
		}

		if (foundWithoutPaths) {
			throw new KindResolutionError(`Resource kind "${kind}" exists but has no CRUD API paths defined.`);
		}

		const allKinds = getAllKnownKinds();
		const suggestions = findSimilarKinds(kind, allKinds).slice(0, 5);
		const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
		throw new KindResolutionError(`Unknown resource kind: "${kind}".${suggestionText}`, suggestions);
	}

	function getAllKnownKinds(): string[] {
		const kinds: string[] = [];
		for (const domain of specIndex.domains) {
			for (const resource of domain.resources) {
				kinds.push(resource.name);
			}
		}
		return kinds.sort();
	}

	function getKindsWithApiPaths(): string[] {
		const kinds: string[] = [];
		for (const domain of specIndex.domains) {
			for (const resource of domain.resources) {
				if (resource.apiPaths && resource.apiPaths.length > 0) {
					kinds.push(resource.name);
				}
			}
		}
		return kinds.sort();
	}

	return { resolveKind, getAllKnownKinds, getKindsWithApiPaths };
}

function extractPaths(resource: ApiSpecDomainResource): ResolvedKind["paths"] | null {
	if (!resource.apiPaths || resource.apiPaths.length === 0) return null;

	let listPath: string | undefined;
	let itemPath: string | undefined;

	for (const apiPath of resource.apiPaths) {
		const normalized = normalizePathPlaceholders(apiPath);
		const hasNamespace = normalized.includes("{namespace}");
		const hasName = normalized.includes("{name}");

		if (hasNamespace && !hasName && !listPath) {
			listPath = normalized;
		} else if (hasNamespace && hasName && !itemPath) {
			itemPath = normalized;
		}
	}

	if (!listPath && !itemPath) {
		for (const apiPath of resource.apiPaths) {
			const normalized = normalizePathPlaceholders(apiPath);
			if (!normalized.includes("{name}") && !listPath) {
				listPath = normalized;
			} else if (normalized.includes("{name}") && !itemPath) {
				itemPath = normalized;
			}
		}
	}

	if (!listPath) return null;
	if (!itemPath && listPath) {
		itemPath = `${listPath}/{name}`;
	}

	return {
		list: listPath,
		get: itemPath!,
		create: listPath,
		update: itemPath!,
		delete: itemPath!,
	};
}

function normalizePathPlaceholders(apiPath: string): string {
	return apiPath.replace(/\{metadata\.namespace\}/g, "{namespace}").replace(/\{metadata\.name\}/g, "{name}");
}

function findSimilarKinds(input: string, candidates: string[]): string[] {
	const scored = candidates.map(candidate => ({
		kind: candidate,
		score: similarityScore(input, candidate),
	}));
	return scored
		.filter(s => s.score > 0.3)
		.sort((a, b) => b.score - a.score)
		.map(s => s.kind);
}

function similarityScore(a: string, b: string): number {
	const la = a.toLowerCase();
	const lb = b.toLowerCase();

	if (la === lb) return 1;
	if (lb.startsWith(la) || la.startsWith(lb)) return 0.8;
	if (lb.includes(la) || la.includes(lb)) return 0.6;

	const aParts = la.split("_");
	const bParts = lb.split("_");
	let matchCount = 0;
	for (const ap of aParts) {
		if (bParts.some(bp => bp === ap || bp.startsWith(ap) || ap.startsWith(bp))) {
			matchCount++;
		}
	}
	if (aParts.length > 0 && matchCount > 0) {
		return (matchCount / Math.max(aParts.length, bParts.length)) * 0.5;
	}

	return 0;
}
