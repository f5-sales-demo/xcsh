import { stringify as yamlStringify } from "yaml";

const METADATA_KEEP_KEYS = new Set(["name", "namespace", "labels", "annotations", "description", "disable"]);

export interface ExportedManifest {
	kind: string;
	metadata: Record<string, unknown>;
	spec: Record<string, unknown>;
}

export function toManifest(apiResponse: Record<string, unknown>, kind: string): ExportedManifest {
	const rawMeta = (apiResponse.metadata ?? {}) as Record<string, unknown>;
	const metadata: Record<string, unknown> = {};

	for (const key of Object.keys(rawMeta)) {
		if (METADATA_KEEP_KEYS.has(key)) {
			const val = rawMeta[key];
			if (val !== undefined && val !== null) {
				if (typeof val === "object" && !Array.isArray(val) && Object.keys(val as object).length === 0) continue;
				metadata[key] = val;
			}
		}
	}

	const spec = (apiResponse.spec ?? {}) as Record<string, unknown>;

	return { kind, metadata, spec };
}

export function toManifestList(apiListResponse: Record<string, unknown>, kind: string): ExportedManifest[] {
	const items = Array.isArray(apiListResponse.items) ? (apiListResponse.items as Record<string, unknown>[]) : [];
	return items.map(item => toManifest(item, kind));
}

export type ManifestOutputFormat = "json" | "yaml";

export function formatManifestOutput(manifests: ExportedManifest[], format: ManifestOutputFormat): string {
	if (format === "yaml") {
		if (manifests.length === 1) {
			return yamlStringify(manifests[0]);
		}
		return manifests.map(m => yamlStringify(m)).join("---\n");
	}

	if (manifests.length === 1) {
		return JSON.stringify(manifests[0], null, 2);
	}
	return JSON.stringify(manifests, null, 2);
}
