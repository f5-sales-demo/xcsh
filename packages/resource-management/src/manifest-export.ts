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

export interface MinimalExportFilter {
	serverDefaults?: Record<string, unknown>;
	serverDefaultFields?: string[];
	minimumConfigFields?: string[];
	oneofDefaultVariants?: Record<string, string>;
}

export interface ExportedManifest {
	kind: string;
	metadata: Record<string, unknown>;
	spec: Record<string, unknown>;
}

export function toManifest(
	apiResponse: Record<string, unknown>,
	kind: string,
	filter?: MinimalExportFilter,
): ExportedManifest {
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
	let spec = cleanSpec(rawSpec);
	if (filter) {
		spec = applyMinimalExportFilter(spec, filter);
	}

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

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || a === undefined || b === undefined) return a === b;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}
	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(key => key in bObj && deepEqual(aObj[key], bObj[key]));
}

function isTriviallyEmpty(val: unknown): boolean {
	if (val === false || val === 0 || val === "") return true;
	if (Array.isArray(val) && val.length === 0) return true;
	if (typeof val === "object" && val !== null && !Array.isArray(val) && Object.keys(val as object).length === 0)
		return true;
	return false;
}

export function applyMinimalExportFilter(
	spec: Record<string, unknown>,
	filter: MinimalExportFilter | undefined,
): Record<string, unknown> {
	if (!filter) return spec;

	const minimumSet = new Set(filter.minimumConfigFields ?? []);
	const serverDefaults = filter.serverDefaults ?? {};
	const serverDefaultFieldsSet = new Set(filter.serverDefaultFields ?? []);
	const oneofDefaults = filter.oneofDefaultVariants ?? {};
	const oneofDefaultKeys = new Set(Object.keys(oneofDefaults));

	function filterObject(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		for (const [key, val] of Object.entries(obj)) {
			const path = prefix ? `${prefix}.${key}` : key;

			if (minimumSet.has(path)) {
				result[key] = val;
				continue;
			}

			if (path in serverDefaults && deepEqual(val, serverDefaults[path])) {
				continue;
			}

			if (serverDefaultFieldsSet.has(path) && isTriviallyEmpty(val)) {
				continue;
			}

			if (oneofDefaultKeys.has(key) && deepEqual(val, {})) {
				continue;
			}

			if (typeof val === "object" && val !== null && !Array.isArray(val) && Object.keys(val as object).length > 0) {
				const filtered = filterObject(val as Record<string, unknown>, path);
				if (Object.keys(filtered).length > 0) {
					result[key] = filtered;
				}
				continue;
			}

			result[key] = val;
		}

		return result;
	}

	return filterObject(spec, "");
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
