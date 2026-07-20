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

/** Every port in the ws discovery range, lowest first. */
export function portCandidates(): number[] {
	const out: number[] = [];
	for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) out.push(p);
	return out;
}

/** Every port in the wss discovery range, lowest first. */
export function wssPortCandidates(): number[] {
	const out: number[] = [];
	for (let p = WSS_RANGE_START; p <= WSS_RANGE_END; p++) out.push(p);
	return out;
}

/** Identity of a bridge reported via hello_ack, plus liveness bookkeeping. */
export interface BridgeInfo {
	port: number;
	tenant: string | null;
	env: string | null;
	sessionId: string | null;
	/** Whether this bridge's xcsh worker has an active stored context (from hello_ack). */
	contextBound: boolean;
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
