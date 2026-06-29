/**
 * Error-driven spec prober. POSTs a candidate spec to the live API and patches it
 * from the validation error until the API accepts it (2xx) or it stalls. Accepts a
 * SEED spec — pass the OpenAPI walker's output to clean up its near-complete specs
 * (walker-seed → prober-patch hybrid); pass {} for pure error-driven discovery.
 *
 * Deletes anything it successfully creates. Network I/O is injected via `fetchFn`
 * so the patch logic stays testable.
 */
import { apiCollectionPath } from "./sweep-scoring";

type Json = Record<string, unknown>;

export interface ProbeOpts {
	baseUrl: string;
	token: string;
	namespace: string;
	resource: string;
	name: string;
	seedSpec?: Json;
	maxIters?: number;
	fetchFn?: typeof fetch;
}
export interface ProbeResult {
	ok: boolean;
	spec: Json;
	namespace: string;
	iters: number;
	lastError?: string;
}

/**
 * Pick a plausible value for a leaf field from its dotted path/name. This is a
 * FALLBACK for the pure error-driven prober (which has no schema access). The
 * OpenAPI walker (openapi-spec.ts) derives values deterministically from the spec
 * constraints (x-ves-validation-rules gte/lte, examples, enums, format) — that is
 * the single source of truth. This heuristic only fires when the prober patches a
 * field the walker didn't cover.
 */
export function leafValue(pathName: string): unknown {
	const p = pathName.toLowerCase();
	if (/prefix|cidr|subnet/.test(p)) return "10.10.0.0/24";
	if (/port/.test(p)) return 80;
	if (/email/.test(p)) return "xcsh-sweep@example.com";
	if (/url|uri|endpoint|server|address/.test(p)) return "https://xcsh-sweep.example.com";
	if (/domain|fqdn|host/.test(p)) return "xcsh-sweep.example.com";
	// Use conservative values (within common UI max constraints like 900 for waits).
	if (/timeout|interval|wait/.test(p)) return 10;
	if (/threshold|priority|ratio|batch/.test(p)) return 1;
	if (/asn|number|count|weight|ttl/.test(p)) return 1;
	if (/password|secret|key/.test(p)) return "Xcsh-Sweep-Pw-2026!";
	return "xcsh-sweep";
}

// Dotted paths come from (untrusted) API error strings — reject prototype-chain
// keys so a crafted "__proto__.x" path can't pollute Object.prototype.
const PROTO_POISON = new Set(["__proto__", "constructor", "prototype"]);

export function setPath(root: Json, dotted: string, value: unknown): void {
	const parts = dotted.split(".");
	if (parts.some(k => PROTO_POISON.has(k))) return;
	let cur: Json = root;
	for (let i = 0; i < parts.length - 1; i++) {
		const k = parts[i]!;
		if (!Object.hasOwn(cur, k) || typeof cur[k] !== "object" || cur[k] === null) {
			cur[k] = {};
		}
		cur = cur[k] as Json;
	}
	cur[parts[parts.length - 1]!] = value;
}

export function getPath(root: Json, dotted: string): unknown {
	const parts = dotted.split(".");
	if (parts.some(k => PROTO_POISON.has(k))) return undefined;
	return parts.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), root);
}

/** Actionable hint from an F5 validation error (field path + how to fix). */
export function parseError(msg: string): { path?: string; kind: "empty" | "unmarshal-map" | "required" | "semantic" } {
	let m = msg.match(/Field\s+([a-z0-9_.]+)\s+should\s+be?\s+not\s+be?\s+empty/i);
	if (m) return { path: m[1], kind: "empty" };
	m = msg.match(/Field\s+([a-z0-9_.]+)\s+is required/i);
	if (m) return { path: m[1], kind: "required" };
	const m2 = msg.match(/Field\s+([a-z0-9_.]+)\s+fails rule/i);
	if (m2) return { path: m2[1], kind: "empty" };
	if (/cannot unmarshal string into .*map/i.test(msg)) return { kind: "unmarshal-map" };
	return { kind: "semantic" };
}

/** Type-mismatch hints (these often omit the field name → apply to last-touched path). */
export function typeFix(msg: string): "array" | "object" | "numeric" | "choice" | "string" | null {
	if (/cannot unmarshal .* into Go value of type \[\]/i.test(msg)) return "array";
	if (/cannot unmarshal .* into Go value of type map\[/i.test(msg)) return "object";
	if (/cannot unmarshal string into Go value of type .*isCreateSpecType|oneOf/i.test(msg)) return "choice";
	if (/invalid character .* looking for beginning of value/i.test(msg)) return "numeric";
	if (/cannot unmarshal number into Go value of type string/i.test(msg)) return "string";
	return null;
}

export async function probeSpec(opts: ProbeOpts): Promise<ProbeResult> {
	const fetchFn = opts.fetchFn ?? fetch;
	const maxIters = opts.maxIters ?? 14;
	const spec: Json = structuredClone(opts.seedSpec ?? {});
	let ns = opts.namespace;
	let lastPath = "";
	let lastError = "";
	for (let iter = 1; iter <= maxIters; iter++) {
		const url = `${opts.baseUrl}${apiCollectionPath(opts.resource, ns)}`;
		const body = { metadata: { name: opts.name, namespace: ns }, spec };
		const r = await fetchFn(url, {
			method: "POST",
			headers: { Authorization: `APIToken ${opts.token}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000),
		});
		if (r.ok) {
			await fetchFn(`${url}/${opts.name}`, {
				method: "DELETE",
				headers: { Authorization: `APIToken ${opts.token}` },
			}).catch(() => {});
			return { ok: true, spec, namespace: ns, iters: iter };
		}
		const txt = await r.text();
		// DNS objects etc. must be created in the system namespace.
		if (/system namespace/i.test(txt) && ns !== "system") {
			ns = "system";
			continue;
		}
		const tf = typeFix(txt);
		if (tf && lastPath) {
			const cur = getPath(spec, lastPath);
			if (tf === "array") setPath(spec, lastPath, [cur ?? {}]);
			else if (tf === "object" || tf === "choice") setPath(spec, lastPath, {});
			else if (tf === "numeric") setPath(spec, lastPath, 65000);
			else if (tf === "string") setPath(spec, lastPath, "xcsh-sweep");
			lastError = txt;
			continue;
		}
		if (txt === lastError)
			return { ok: false, spec, namespace: ns, iters: iter, lastError: `no progress: ${txt.slice(0, 150)}` };
		lastError = txt;
		const hint = parseError(txt);
		if (hint.kind === "semantic" || !hint.path) {
			return { ok: false, spec, namespace: ns, iters: iter, lastError: txt.slice(0, 180) };
		}
		const rel = hint.path.replace(/^spec\./, "");
		lastPath = rel;
		if (hint.kind === "unmarshal-map") {
			setPath(spec, rel, [{}]);
		} else {
			const head = getPath(spec, rel.split(".")[0]!);
			if (Array.isArray(head)) {
				const sub = rel.split(".").slice(1).join(".");
				(head as Json[])[0] = (head as Json[])[0] ?? {};
				if (sub) setPath((head as Json[])[0]!, sub, leafValue(rel));
				else (head as unknown[])[0] = leafValue(rel);
			} else {
				setPath(spec, rel, leafValue(rel));
			}
		}
	}
	return { ok: false, spec, namespace: ns, iters: maxIters, lastError: `${lastError.slice(0, 150)} (max iters)` };
}
