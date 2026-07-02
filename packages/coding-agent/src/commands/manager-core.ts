/** Pure worker-registry + control-protocol logic for the manager. No I/O. */

export interface WorkerRec {
	tenantKey: string; // "tenant|env"
	port: number;
	pid: number;
	lastSeen: number; // epoch ms
}

export type Registry = Map<string, WorkerRec>;

export type ControlMsg =
	| { type: "provision"; tenantKey: string }
	| { type: "release"; tenantKey: string }
	| { type: "status" };

function isTenantKey(v: unknown): v is string {
	return typeof v === "string" && /^[^|]+\|[^|]+$/.test(v);
}

/** Validate an inbound control frame; null if malformed (fail closed). */
export function parseControlMsg(raw: unknown): ControlMsg | null {
	if (!raw || typeof raw !== "object") return null;
	const m = raw as Record<string, unknown>;
	if (m.type === "status") return { type: "status" };
	if ((m.type === "provision" || m.type === "release") && isTenantKey(m.tenantKey)) {
		return { type: m.type, tenantKey: m.tenantKey };
	}
	return null;
}

/** Idempotency: only provision when there is no live worker for the key. */
export function needsProvision(reg: Registry, tenantKey: string): boolean {
	return !reg.has(tenantKey);
}

/** Lowest free port in the range not already held by a worker. */
export function pickPort(reg: Registry, range: number[]): number | null {
	const used = new Set([...reg.values()].map(w => w.port));
	for (const p of range) if (!used.has(p)) return p;
	return null;
}

/** Keys whose worker has been idle longer than idleMs. */
export function staleKeys(reg: Registry, now: number, idleMs: number): string[] {
	const out: string[] = [];
	for (const w of reg.values()) if (now - w.lastSeen > idleMs) out.push(w.tenantKey);
	return out;
}
