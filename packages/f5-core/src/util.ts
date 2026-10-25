import { createHash } from "node:crypto";

/** Canonical JSON refuses objects with executable accessors and non-JSON values. */
export function canonicalJson(value: unknown): string {
	const seen = new Set<object>();
	function visit(input: unknown): unknown {
		if (input === null || typeof input === "string" || typeof input === "boolean") return input;
		if (typeof input === "number" && Number.isFinite(input)) return input;
		if (!input || typeof input !== "object" || seen.has(input)) throw new TypeError("Expected finite JSON");
		if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
			throw new TypeError("Expected plain JSON");
		}
		seen.add(input);
		let result: unknown;
		if (Array.isArray(input)) result = input.map(visit);
		else {
			const out = Object.create(null) as Record<string, unknown>;
			for (const key of Object.keys(input).sort()) {
				const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
				if (!Object.hasOwn(descriptor, "value")) throw new TypeError("JSON accessors are unsupported");
				if (descriptor.value !== undefined) out[key] = visit(descriptor.value);
			}
			result = out;
		}
		seen.delete(input);
		return result;
	}
	return JSON.stringify(visit(value));
}
export function digest(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function cloneJson<T>(value: T): T {
	return JSON.parse(canonicalJson(value)) as T;
}
export function freezeJson<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freezeJson(child);
		Object.freeze(value);
	}
	return value;
}

/** Retains private mappings only in the host instance, never in receipts or plan output. */
export class SecretReferenceError extends Error {}
export class CoreRedactor {
	#secrets = new Map<string, string>();
	add(secret: string): void {
		if (secret && !this.#secrets.has(secret)) {
			this.#secrets.set(secret, `#${createHash("sha256").update(secret).digest("hex").slice(0, 16)}#`);
		}
	}
	collect(value: unknown, sensitive = false): void {
		if (typeof value === "string") {
			if (sensitive) this.add(value);
			return;
		}
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			this.collect(
				child,
				sensitive || /api.?token|password|secret|private.?key|credential|authorization|access.?key/i.test(key),
			);
		}
	}
	redact<T>(value: T): T {
		const secrets = [...this.#secrets.keys()].sort((a, b) => b.length - a.length);
		const pattern = secrets.length
			? new RegExp(secrets.map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
			: undefined;
		const transform = (input: unknown): unknown => {
			if (typeof input === "string") {
				return pattern ? input.replace(pattern, secret => this.#secrets.get(secret)!) : input;
			}
			if (Array.isArray(input)) return input.map(transform);
			if (input && typeof input === "object")
				return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, transform(child)]));
			return input;
		};
		return transform(value) as T;
	}
	restore<T>(value: T): T {
		const reverse = new Map([...this.#secrets].map(([secret, reference]) => [reference, secret]));
		const transform = (input: unknown): unknown => {
			if (typeof input === "string")
				return input.replace(/#[a-f0-9]{16}#/g, reference => {
					const secret = reverse.get(reference);
					if (secret === undefined) throw new SecretReferenceError("Secret reference unavailable in this binding");
					return secret;
				});
			if (Array.isArray(input)) return input.map(transform);
			if (input && typeof input === "object")
				return Object.fromEntries(Object.entries(input).map(([key, child]) => [transform(key), transform(child)]));
			return input;
		};
		return transform(value) as T;
	}
	clear(): void {
		this.#secrets.clear();
	}
}
