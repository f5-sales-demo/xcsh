/** Pure worker-registry + control-protocol logic for the manager. No I/O. */

export interface WorkerRec {
	sessionId: string; // per-tab session key, e.g. "tab-7"
	tenant: string; // "tenant|env" — carried for the worker's context env, not the key
	port: number;
	pid: number;
	lastSeen: number; // epoch ms
}

export type Registry = Map<string, WorkerRec>;

export type ControlMsg =
	| { type: "provision"; sessionId: string; tenant: string }
	| { type: "release"; sessionId: string }
	| { type: "status" };

function isTenant(v: unknown): v is string {
	return typeof v === "string" && /^[^|]+\|[^|]+$/.test(v);
}
function isNonEmpty(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

/** Validate an inbound control frame; null if malformed (fail closed). */
export function parseControlMsg(raw: unknown): ControlMsg | null {
	if (!raw || typeof raw !== "object") return null;
	const m = raw as Record<string, unknown>;
	if (m.type === "status") return { type: "status" };
	if (m.type === "provision" && isNonEmpty(m.sessionId) && isTenant(m.tenant))
		return { type: "provision", sessionId: m.sessionId, tenant: m.tenant };
	if (m.type === "release" && isNonEmpty(m.sessionId)) return { type: "release", sessionId: m.sessionId };
	return null;
}

/** Idempotency: only provision when there is no live worker for the sessionId. */
export function needsProvision(reg: Registry, sessionId: string): boolean {
	return !reg.has(sessionId);
}

/** Lowest free port in the range not already held by a worker. */
export function pickPort(reg: Registry, range: number[]): number | null {
	const used = new Set([...reg.values()].map(w => w.port));
	for (const p of range) if (!used.has(p)) return p;
	return null;
}

/** sessionIds whose worker has been idle longer than idleMs. */
export function staleKeys(reg: Registry, now: number, idleMs: number): string[] {
	const out: string[] = [];
	for (const w of reg.values()) if (now - w.lastSeen > idleMs) out.push(w.sessionId);
	return out;
}

/** How many new spares to spawn now to reach `target`, without exceeding the port
 * budget: spares + active workers must fit the discovery range. Never negative. */
export function sparesToSpawn(
	target: number,
	currentSpares: number,
	activeWorkers: number,
	totalPorts: number,
): number {
	const want = Math.max(0, target - currentSpares);
	const freeSlots = Math.max(0, totalPorts - activeWorkers - currentSpares);
	return Math.min(want, freeSlots);
}
