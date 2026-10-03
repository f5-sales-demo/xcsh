/** Structured map contract rendering and local extension validation. */
import { isIP } from "node:net";

export interface MapScope {
	type?: string;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
	minimum?: number;
	maximum?: number;
	ranges?: number[][];
}

export interface MapConstraints {
	constraintType: string;
	keys?: MapScope;
	values?: MapScope;
	cardinality?: { minProperties?: number; maxProperties?: number };
	crossEntry?: { uniqueValues?: boolean };
	originalRules?: Record<string, unknown>;
}

export function formatMapConstraints(constraints: MapConstraints): string {
	const parts: string[] = [];
	for (const scope of ["keys", "values", "cardinality", "crossEntry"] as const) {
		for (const [key, value] of Object.entries(constraints[scope] ?? {})) {
			parts.push(`${scope}.${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
		}
	}
	return parts.join(", ");
}

function validateText(value: unknown, scope: MapScope, label: string): string[] {
	const errors: string[] = [];
	if (typeof value !== "string") return [`${label} must be a string`];
	const length = Array.from(value).length;
	if (scope.minLength !== undefined && length < scope.minLength) errors.push(`${label} below minimum length`);
	if (scope.maxLength !== undefined && length > scope.maxLength) errors.push(`${label} exceeds maximum length`);
	if (scope.pattern && !new RegExp(scope.pattern).test(value)) errors.push(`${label} does not match pattern`);
	if (scope.type === "uint32-string") {
		const number = Number(value);
		if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 4294967295)
			errors.push(`${label} must be uint32`);
		if (scope.minimum !== undefined && number < scope.minimum) errors.push(`${label} below minimum`);
		if (scope.maximum !== undefined && number > scope.maximum) errors.push(`${label} exceeds maximum`);
		if (scope.ranges && !scope.ranges.some(([lo, hi]) => number >= lo! && number <= hi!))
			errors.push(`${label} outside ranges`);
	}
	switch (scope.format) {
		case "ipv4":
			if (isIP(value) !== 4) errors.push(`${label} must be IPv4`);
			break;
		case "ipv6":
			if (isIP(value) !== 6) errors.push(`${label} must be IPv6`);
			break;
		case "ip-address":
			if (!isIP(value)) errors.push(`${label} must be IP`);
			break;
		case "mac-address":
			if (!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(value)) errors.push(`${label} must be MAC`);
			break;
		case "regex":
			try {
				new RegExp(value);
			} catch {
				errors.push(`${label} must be a valid regex`);
			}
			break;
		case "k8s-label-value":
			if (value.length > 63 || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?)?$/.test(value))
				errors.push(`${label} must be a Kubernetes label value`);
			break;
		case "uri-reference":
			if (/[^\x21-\x7e]|%(?![\da-f]{2})/i.test(value)) errors.push(`${label} must be a URI-reference`);
			break;
	}
	return errors;
}

export function validateMapConstraints(value: unknown, constraints: MapConstraints): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return ["Expected a map object"];
	const entries = Object.entries(value);
	const errors: string[] = [];
	const cardinality = constraints.cardinality;
	if (cardinality?.minProperties !== undefined && entries.length < cardinality.minProperties)
		errors.push("Too few map pairs");
	if (cardinality?.maxProperties !== undefined && entries.length > cardinality.maxProperties)
		errors.push("Too many map pairs");
	for (const [key, item] of entries) {
		if (constraints.keys) errors.push(...validateText(key, constraints.keys, `key ${key}`));
		if (constraints.values) errors.push(...validateText(item, constraints.values, `value at ${key}`));
	}
	if (
		constraints.crossEntry?.uniqueValues &&
		new Set(entries.map(([, item]) => JSON.stringify(item))).size !== entries.length
	)
		errors.push("Map values must be unique");
	return errors;
}
