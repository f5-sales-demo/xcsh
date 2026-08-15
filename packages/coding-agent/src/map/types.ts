export const MAP_PRECISIONS = ["exact", "address", "city", "metro", "approximate", "inferred", "unresolved"] as const;
export type MapPrecision = (typeof MAP_PRECISIONS)[number];

export const MAP_RESOLUTIONS = ["resolved", "candidate", "ambiguous", "approximate", "unresolved"] as const;
export type MapResolution = (typeof MAP_RESOLUTIONS)[number];

export const MAP_CONFIDENCES = ["high", "medium", "low", "unknown"] as const;
export type MapConfidence = (typeof MAP_CONFIDENCES)[number];

export interface MapLocationSourceV1 {
	url: string;
	sourceName: string;
	observedAt: string;
	claim: string;
}

export interface MapLocationV1 {
	id: string;
	label: string;
	longitude?: number;
	latitude?: number;
	precision: MapPrecision;
	resolution: MapResolution;
	confidence: MapConfidence;
	sources: MapLocationSourceV1[];
}

export interface FittedMapLocation {
	location: MapLocationV1;
	worldX: number;
	worldY: number;
}

export interface FittedMapLocations {
	locations: FittedMapLocation[];
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	spanX: number;
	spanY: number;
}

const MAX_WEB_MERCATOR_LATITUDE = 85.05112878;

function requiredString(value: unknown, field: string, max = 2048): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} is required`);
	return value.trim();
}

export function validateMapLocationV1(value: unknown): MapLocationV1 {
	if (!value || typeof value !== "object") throw new Error("map location must be an object");
	const location = value as Partial<MapLocationV1>;
	const id = requiredString(location.id, "location id", 128);
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(id)) throw new Error("location id must be stable and URL-safe");
	const label = requiredString(location.label, "location label", 256);
	if (!MAP_PRECISIONS.includes(location.precision as MapPrecision)) throw new Error("invalid location precision");
	if (!MAP_RESOLUTIONS.includes(location.resolution as MapResolution)) throw new Error("invalid location resolution");
	if (!MAP_CONFIDENCES.includes(location.confidence as MapConfidence)) throw new Error("invalid location confidence");
	const hasLongitude = location.longitude !== undefined;
	const hasLatitude = location.latitude !== undefined;
	if (hasLongitude !== hasLatitude) throw new Error("longitude and latitude must be supplied together");
	if (hasLongitude) {
		if (!Number.isFinite(location.longitude) || location.longitude! < -180 || location.longitude! > 180) {
			throw new Error("longitude must be between -180 and 180");
		}
		if (!Number.isFinite(location.latitude) || location.latitude! < -90 || location.latitude! > 90) {
			throw new Error("latitude must be between -90 and 90");
		}
		if (location.precision === "unresolved" || location.resolution === "unresolved") {
			throw new Error("unresolved locations cannot contain plottable coordinates");
		}
	}
	if (!Array.isArray(location.sources)) throw new Error("location sources are required");
	const sources = location.sources.map((source, index): MapLocationSourceV1 => {
		if (!source || typeof source !== "object") throw new Error(`sources[${index}] must be an object`);
		const candidate = source as Partial<MapLocationSourceV1>;
		const url = requiredString(candidate.url, `sources[${index}].url`);
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error(`sources[${index}].url must be a valid URL`);
		}
		if (parsed.protocol !== "https:") throw new Error(`sources[${index}].url must use HTTPS`);
		const observedAt = requiredString(candidate.observedAt, `sources[${index}].observedAt`, 64);
		if (!Number.isFinite(Date.parse(observedAt))) throw new Error(`sources[${index}].observedAt must be an ISO time`);
		return {
			url: parsed.toString(),
			sourceName: requiredString(candidate.sourceName, `sources[${index}].sourceName`, 256),
			observedAt,
			claim: requiredString(candidate.claim, `sources[${index}].claim`, 2048),
		};
	});
	if (hasLongitude && sources.length === 0) throw new Error("plottable coordinates require provenance");
	return {
		id,
		label,
		longitude: location.longitude,
		latitude: location.latitude,
		precision: location.precision!,
		resolution: location.resolution!,
		confidence: location.confidence!,
		sources,
	};
}

export function projectWebMercator(longitude: number, latitude: number): { x: number; y: number } {
	const x = (longitude + 180) / 360;
	const clampedLatitude = Math.max(-MAX_WEB_MERCATOR_LATITUDE, Math.min(MAX_WEB_MERCATOR_LATITUDE, latitude));
	const radians = (clampedLatitude * Math.PI) / 180;
	const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
	return { x, y };
}

/** Choose the smallest circular longitude interval, so antimeridian neighbors remain neighbors. */
export function fitMapLocations(locations: readonly MapLocationV1[]): FittedMapLocations {
	const projected = locations
		.filter(location => location.longitude !== undefined && location.latitude !== undefined)
		.map(location => ({ location, ...projectWebMercator(location.longitude!, location.latitude!) }));
	if (projected.length === 0) throw new Error("no resolved locations are available to plot");
	const sortedX = [...projected].sort((a, b) => a.x - b.x || a.location.id.localeCompare(b.location.id));
	let largestGap = -1;
	let cut = 0;
	for (let index = 0; index < sortedX.length; index++) {
		const current = sortedX[index]!.x;
		const next = index === sortedX.length - 1 ? sortedX[0]!.x + 1 : sortedX[index + 1]!.x;
		const gap = next - current;
		if (gap > largestGap) {
			largestGap = gap;
			cut = index === sortedX.length - 1 ? sortedX[0]!.x : sortedX[index + 1]!.x;
		}
	}
	const fitted = projected.map(({ location, x, y }) => ({
		location,
		worldX: x < cut ? x + 1 : x,
		worldY: y,
	}));
	let minX = Math.min(...fitted.map(point => point.worldX));
	let maxX = Math.max(...fitted.map(point => point.worldX));
	let minY = Math.min(...fitted.map(point => point.worldY));
	let maxY = Math.max(...fitted.map(point => point.worldY));
	const minimumSpan = 1 / 128;
	if (maxX - minX < minimumSpan) {
		const center = (minX + maxX) / 2;
		minX = center - minimumSpan / 2;
		maxX = center + minimumSpan / 2;
	}
	if (maxY - minY < minimumSpan) {
		const center = (minY + maxY) / 2;
		minY = center - minimumSpan / 2;
		maxY = center + minimumSpan / 2;
	}
	return { locations: fitted, minX, maxX, minY, maxY, spanX: maxX - minX, spanY: maxY - minY };
}
