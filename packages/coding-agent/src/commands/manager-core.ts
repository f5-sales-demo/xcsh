/** Pure worker-registry + control-protocol logic for the manager. No I/O. */

export interface WorkerRec {
	sessionId: string; // per-tab session key, e.g. "tab-7"
	tenant: string; // "tenant|env" — carried for the worker's context env, not the key
	port: number;
	pid: number;
	lastSeen: number; // epoch ms
}

export type Registry = Map<string, WorkerRec>;

/** Reasons a manager is asked to step down (#1874). Closed set — fail closed. */
export type ShutdownReason = "superseded" | "updated" | "manual";
const SHUTDOWN_REASONS = new Set<string>(["superseded", "updated", "manual"]);

export type ControlMsg =
	| { type: "provision"; sessionId: string; tenant: string }
	| { type: "release"; sessionId: string }
	// An sid-less status is the legacy no-op sink; an sid-carrying status is a
	// keepalive from an actively-chatting worker (see keepaliveFrame/touchLastSeen).
	| { type: "status"; sessionId?: string }
	| { type: "hello" }
	| { type: "shutdown"; reason: ShutdownReason };

/** The manager's on-disk liveness record (`~/.xcsh/manager.json`), used for
 * observability and as the escalation target (pid) when a superseded manager
 * won't release the socket. The control-socket `hello` answer is authoritative. */
export interface ManagerState {
	pid: number;
	version: string;
	socket: string;
	startedAt: number;
}

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
	if (m.type === "status")
		return isNonEmpty(m.sessionId) ? { type: "status", sessionId: m.sessionId } : { type: "status" };
	if (m.type === "provision" && isNonEmpty(m.sessionId) && isTenant(m.tenant))
		return { type: "provision", sessionId: m.sessionId, tenant: m.tenant };
	if (m.type === "release" && isNonEmpty(m.sessionId)) return { type: "release", sessionId: m.sessionId };
	if (m.type === "hello") return { type: "hello" };
	if (m.type === "shutdown" && typeof m.reason === "string" && SHUTDOWN_REASONS.has(m.reason))
		return { type: "shutdown", reason: m.reason as ShutdownReason };
	return null;
}

/** Parse a plain `major.minor.patch` version into a numeric tuple, or null. */
function parseSemver(v: string | null | undefined): [number, number, number] | null {
	if (typeof v !== "string") return null;
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True iff `ourVersion` is a valid version strictly greater than a valid
 * `runningVersion` — the trigger to replace an older manager. Fails closed
 * (false) on equal/newer/any-unparseable input, so we never downgrade or flap. */
export function shouldSupersede(runningVersion: string | null, ourVersion: string): boolean {
	const a = parseSemver(runningVersion);
	const b = parseSemver(ourVersion);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) {
		if (b[i] > a[i]) return true;
		if (b[i] < a[i]) return false;
	}
	return false; // equal
}

/** Serialize the manager liveness record for `~/.xcsh/manager.json`. */
export function serializeManagerState(s: ManagerState): string {
	return JSON.stringify({ pid: s.pid, version: s.version, socket: s.socket, startedAt: s.startedAt });
}

/** Parse `~/.xcsh/manager.json`; null on corrupt/missing/ill-shaped input
 * (a positive pid, non-empty version + socket, and finite startedAt required). */
export function parseManagerState(text: string): ManagerState | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const m = raw as Record<string, unknown>;
	if (typeof m.pid !== "number" || !Number.isInteger(m.pid) || m.pid <= 0) return null;
	if (!isNonEmpty(m.version) || !isNonEmpty(m.socket)) return null;
	if (typeof m.startedAt !== "number" || !Number.isFinite(m.startedAt)) return null;
	return { pid: m.pid, version: m.version, socket: m.socket, startedAt: m.startedAt };
}

/** Idempotency: only provision when there is no live worker for the sessionId. */
export function needsProvision(reg: Registry, sessionId: string): boolean {
	return !reg.has(sessionId);
}

/** sessionIds whose worker has been idle longer than idleMs. */
export function staleKeys(reg: Registry, now: number, idleMs: number): string[] {
	const out: string[] = [];
	for (const w of reg.values()) if (now - w.lastSeen > idleMs) out.push(w.sessionId);
	return out;
}

/** Refresh a worker's `lastSeen` from a keepalive/status frame; true iff a known
 * session was touched. The manager never sees chat traffic (it flows worker↔
 * bridge↔extension), so an actively-used session would otherwise be idle-reaped
 * mid-conversation. An actively-chatting worker emits `keepaliveFrame` to drive
 * this, keeping its session out of `staleKeys`. */
export function touchLastSeen(reg: Registry, sessionId: string | undefined, now: number): boolean {
	if (!sessionId) return false;
	const w = reg.get(sessionId);
	if (!w) return false;
	w.lastSeen = now;
	return true;
}

/** True iff this manager should self-recycle because it is running a STALE on-disk
 * binary. Only for a COMPILED install: after `brew upgrade` + `brew cleanup`, the old
 * versioned binary the manager was launched from is DELETED, yet the process lingers
 * on the freed inode — and can no longer spawn workers/spares (spawn ENOENT), which
 * surfaces as the extension's "xcsh didn't start". Detecting the deleted binary lets
 * the manager step down so a fresh one (launched from the version-stable PATH wrapper)
 * takes over. Dev (`bun src/cli.ts`) has a live interpreter execPath → never stale.
 * Fail-closed: any error from `exists` → NOT stale, so uncertainty never triggers a
 * recycle loop. Only the unambiguous deleted-binary signal is used (a version/realpath
 * drift signal was deliberately NOT added — false positives would flap-recycle). */
export function binaryIsStale(opts: { compiled: boolean; execPath: string; exists: (p: string) => boolean }): boolean {
	if (!opts.compiled) return false;
	try {
		return !opts.exists(opts.execPath);
	} catch {
		return false;
	}
}

/** The NDJSON keepalive an actively-chatting worker writes to the manager control
 * socket to refresh its `lastSeen` (consumed by `touchLastSeen`). Null for the
 * unbound `spare` sentinel or an empty id — a spare has no session to keep alive. */
export function keepaliveFrame(sessionId: string): string | null {
	if (!sessionId || sessionId === "spare") return null;
	return `${JSON.stringify({ type: "status", sessionId })}\n`;
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

/**
 * Choose a port to spawn on, probing ONLY ports that are not already spoken for.
 *
 * `isFree` is not a read — every implementation of it binds the port to find out,
 * then releases it. Probing a port that has already been handed to a worker which
 * is still starting up can therefore win that bind, and a worker whose forced
 * `XCSH_BRIDGE_PORT` is occupied throws and exits rather than retrying
 * ("XCSH_BRIDGE_PORT N is already in use", extension-bridge.ts). `proc.exited`
 * then drops its registry entry, so the session ends up with no worker at all.
 *
 * That is the two-tab flake (#2463): provisioning a second tab swept the whole
 * range, including the first tab's port, and could kill the first tab's worker
 * mid-bind — leaving exactly one port advertising the tenant.
 *
 * `reserved` covers ports promised but not yet in the registry (pre-warmed spares
 * live there until adopted). Probing is lazy: it stops at the first free port, so
 * this binds no more ports than it has to.
 */
export function selectSpawnPort(
	reg: Registry,
	range: readonly number[],
	reserved: readonly number[],
	isFree: (port: number) => boolean,
): number | null {
	const taken = new Set<number>([...reg.values()].map(w => w.port).concat(reserved));
	for (const port of range) {
		if (taken.has(port)) continue; // ours already — never probe it
		if (isFree(port)) return port;
	}
	return null;
}
