import { stringify as yamlStringify } from "yaml";

const METADATA_KEEP_KEYS = new Set(["name", "namespace", "labels", "annotations", "description", "disable"]);

const SPEC_STRIP_KEYS = new Set([
	"host_name",
	"dns_info",
	"state",
	"auto_cert_info",
	"internet_vip_info",
	"cert_state",
	"create_form",
	"replace_form",
	"status",
]);

export interface ExportedManifest {
	kind: string;
	metadata: Record<string, unknown>;
	spec: Record<string, unknown>;
}

export function toManifest(apiResponse: Record<string, unknown>, kind: string): ExportedManifest {
	const objectData = apiResponse.object as Record<string, unknown> | undefined;
	const getSpec = apiResponse.get_spec as Record<string, unknown> | undefined;

	const rawMeta = (apiResponse.metadata ?? objectData?.metadata ?? getSpec?.metadata ?? {}) as Record<string, unknown>;
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

	const rawSpec = (apiResponse.spec ?? objectData?.spec ?? getSpec ?? {}) as Record<string, unknown>;
	const spec = cleanSpec(rawSpec);

	return { kind, metadata, spec };
}

function cleanSpec(raw: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(raw)) {
		if (SPEC_STRIP_KEYS.has(key)) continue;
		const cleaned = cleanValue(val);
		if (cleaned !== undefined) {
			result[key] = cleaned;
		}
	}
	return result;
}

function cleanValue(val: unknown): unknown {
	if (val === null || val === undefined) return undefined;
	if (Array.isArray(val)) {
		if (val.length === 0) return undefined;
		const cleaned = val.map(cleanValue).filter(v => v !== undefined);
		return cleaned.length > 0 ? cleaned : undefined;
	}
	if (typeof val === "object") {
		const obj = val as Record<string, unknown>;
		const keys = Object.keys(obj);
		if (keys.length === 0) return val;
		const result: Record<string, unknown> = {};
		let hasContent = false;
		for (const [k, v] of Object.entries(obj)) {
			const cleaned = cleanValue(v);
			if (cleaned !== undefined) {
				result[k] = cleaned;
				hasContent = true;
			}
		}
		return hasContent ? result : val;
	}
	return val;
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
