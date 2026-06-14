import type { ResourceManifest } from "./types";

export class ManifestParseError extends Error {
	readonly manifestIndex: number;
	constructor(message: string, index: number) {
		super(message);
		this.name = "ManifestParseError";
		this.manifestIndex = index;
	}
}

export function parseManifests(objects: Record<string, unknown>[], sourcePath: string): ResourceManifest[] {
	const manifests: ResourceManifest[] = [];
	for (let i = 0; i < objects.length; i++) {
		manifests.push(parseSingleManifest(objects[i], i, sourcePath));
	}
	return manifests;
}

function parseSingleManifest(obj: Record<string, unknown>, index: number, sourcePath: string): ResourceManifest {
	const kind = obj.kind;
	if (typeof kind !== "string" || !kind) {
		throw new ManifestParseError(
			`Manifest at index ${index} in ${sourcePath} is missing required field "kind".`,
			index,
		);
	}

	const metadata = obj.metadata;
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		throw new ManifestParseError(
			`Manifest "${kind}" at index ${index} in ${sourcePath} is missing required field "metadata".`,
			index,
		);
	}

	const meta = metadata as Record<string, unknown>;
	const name = meta.name;
	if (typeof name !== "string" || !name) {
		throw new ManifestParseError(
			`Manifest "${kind}" at index ${index} in ${sourcePath} is missing required field "metadata.name".`,
			index,
		);
	}

	const spec = obj.spec;
	if (spec !== undefined && (typeof spec !== "object" || spec === null || Array.isArray(spec))) {
		throw new ManifestParseError(
			`Manifest "${kind}/${name}" at index ${index} in ${sourcePath}: "spec" must be an object.`,
			index,
		);
	}

	return {
		kind,
		metadata: {
			name,
			namespace: typeof meta.namespace === "string" ? meta.namespace : undefined,
			labels: isStringRecord(meta.labels) ? meta.labels : undefined,
			annotations: isStringRecord(meta.annotations) ? meta.annotations : undefined,
			description: typeof meta.description === "string" ? meta.description : undefined,
			disable: typeof meta.disable === "boolean" ? meta.disable : undefined,
		},
		spec: (spec as Record<string, unknown>) ?? {},
		rawObject: obj,
	};
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value as Record<string, unknown>).every(v => typeof v === "string");
}
