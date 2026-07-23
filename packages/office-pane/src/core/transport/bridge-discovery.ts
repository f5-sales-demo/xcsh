/**
 * Pure helpers for multi-port bridge discovery.
 *
 * Browser-safe: no node:* imports, no Office.js, no runtime @f5-sales-demo/* deps.
 * Mirrors xcsh's extension bridge-discovery semantics; re-implemented here to
 * keep office-pane's transport dependency-free.
 */

/**
 * Inclusive loopback ws discovery range (mirrors xcsh's extension-bridge.ts).
 * Kept for internal ws consumers; the office-pane transport connects on the
 * wss range below (see {@link wssPortCandidates}).
 */
export const PORT_RANGE_START = 19222;
export const PORT_RANGE_END = 19241;

/**
 * Inclusive loopback wss discovery range. Mirrors xcsh's dual-listen scheme,
 * where each ws port P also serves wss on P + 100 (WSS_PORT_OFFSET). The
 * transport reaches the bridge's TLS listener on these ports via the
 * publicly-trusted `127-0-0-1.local-ip.sh` cert.
 */
export const WSS_RANGE_START = 19322;
export const WSS_RANGE_END = 19341;

/**
 * Inclusive loopback wss discovery range for `xcsh office serve` bridges. Office
 * serve binds a DEDICATED ws sub-range (19242–19261) whose paired wss listeners
 * (ws + 100) land here — DISJOINT from the chrome worker's wss range (19322–19341).
 * The office pane scans THIS range, so a Chrome worker (chrome range) can never
 * even be reached by office discovery (structural elimination of the port
 * collision). The serveKind filter in {@link pickBridge} is the correctness
 * backstop for the shared-port edge case.
 */
export const OFFICE_WSS_RANGE_START = 19342;
export const OFFICE_WSS_RANGE_END = 19361;

/** Every port in the ws discovery range, lowest first. */
export function portCandidates(): number[] {
	const out: number[] = [];
	for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) out.push(p);
	return out;
}

/** Every port in the chrome-worker wss discovery range, lowest first. */
export function wssPortCandidates(): number[] {
	const out: number[] = [];
	for (let p = WSS_RANGE_START; p <= WSS_RANGE_END; p++) out.push(p);
	return out;
}

/** Every port in the office-serve wss discovery range, lowest first. */
export function officeWssPortCandidates(): number[] {
	const out: number[] = [];
	for (let p = OFFICE_WSS_RANGE_START; p <= OFFICE_WSS_RANGE_END; p++) out.push(p);
	return out;
}

/** How an xcsh bridge was STARTED — its intrinsic scope, from hello_ack. Distinct
 * from the connecting client's announced host. `null` = a bridge that did not
 * advertise the field (stale/legacy) — treated as ineligible by a serveKind filter. */
export type ServeKind = "office" | "browser";

/** Identity of a bridge reported via hello_ack, plus liveness bookkeeping. */
export interface BridgeInfo {
	port: number;
	tenant: string | null;
	env: string | null;
	sessionId: string | null;
	/** Whether this bridge's xcsh worker has an active stored context (from hello_ack). */
	contextBound: boolean;
	/** How the bridge was started (from hello_ack); null when the field is absent. */
	serveKind: ServeKind | null;
	/** Epoch ms of the last inbound frame on this socket. */
	lastSeen: number;
}

/** Options for pickBridge(). */
export interface PickBridgeOpts {
	/**
	 * If non-undefined, only bridges whose tenant matches are eligible.
	 * Pass `null` to match bridges that report no tenant.
	 */
	tenant?: string | null;
	/**
	 * Prefer bridges with an active stored context (contextBound=true).
	 * Defaults to true.
	 */
	preferContextBound?: boolean;
	/**
	 * When set, ONLY bridges whose serveKind matches are eligible. A bridge whose
	 * serveKind is `null` (did not advertise the field) is filtered out too — the
	 * fail-safe that stops the Office pane ever adopting a Chrome worker on a shared
	 * port. Applied BEFORE the tenant step.
	 */
	requireServeKind?: ServeKind;
}

/**
 * Select the best bridge from a list of candidates.
 *
 * Selection order:
 * 1. Filter by tenant when opts.tenant is specified (including null-match).
 * 2. Prefer contextBound=true when preferContextBound is true (default).
 * 3. Among ties, prefer the most recently active bridge (highest lastSeen).
 *
 * Returns undefined when no candidate survives filtering.
 */
export function pickBridge(infos: BridgeInfo[], opts?: PickBridgeOpts): BridgeInfo | undefined {
	let candidates = infos.slice();

	// Step 0: serveKind filter (BEFORE tenant). A candidate whose serveKind !==
	// requireServeKind — including serveKind===null — is ineligible (fail-safe).
	if (opts?.requireServeKind !== undefined) {
		const want = opts.requireServeKind;
		candidates = candidates.filter(b => b.serveKind === want);
	}

	// Step 1: optional tenant filter
	if (opts !== undefined && opts.tenant !== undefined) {
		const wantTenant = opts.tenant;
		candidates = candidates.filter(b => b.tenant === wantTenant);
	}

	if (candidates.length === 0) return undefined;

	const preferBound = opts?.preferContextBound ?? true;

	// Step 2 + 3: sort; contextBound desc (if preferred), then lastSeen desc
	candidates.sort((a, b) => {
		if (preferBound && a.contextBound !== b.contextBound) {
			return a.contextBound ? -1 : 1;
		}
		return b.lastSeen - a.lastSeen;
	});

	return candidates[0];
}
