/**
 * Pure, deterministic scoring for the console CRUD sweep harness.
 *
 * The whole point of the honest sweep is that a "pass" must be CROSS-CHECKED:
 * the workflow runner reporting success is NOT sufficient — the API must confirm
 * the post-condition AND the console form must show no error banner. A create
 * that the runner "skipped" because the resource already existed is NOT a pass;
 * it is indeterminate (the operation was never actually exercised).
 *
 * These functions are pure so they can be unit-tested without a live browser.
 */

export type SweepOperation = "create" | "read" | "update" | "delete";

/** API-kind plural overrides — must mirror catalog-workflow-runner.ts:649-655. */
const API_KIND_OVERRIDES: Record<string, string> = {
	"health-check": "healthcheck",
	"http-load-balancer": "http_loadbalancer",
	"tcp-load-balancer": "tcp_loadbalancer",
	"route-object": "route",
};

/**
 * Map a catalog resource id (kebab-case) to its F5 XC API kind (plural).
 * e.g. "health-check" → "healthchecks", "bgp-asn-set" → "bgp_asn_sets".
 */
export function apiKindFor(resource: string): string {
	const base = API_KIND_OVERRIDES[resource] ?? resource.replace(/-/g, "_");
	return `${base}s`;
}

/**
 * API-group path prefix per resource (before `/namespaces/`). Most resources live
 * under `/api/config`, but several use a different API group — verified live against
 * the tenant. Resources NOT listed here use the default `/api/config`.
 */
const API_GROUP: Record<string, string> = {
	"dns-zone": "/api/config/dns",
	"dns-lb-health-check": "/api/config/dns",
	"dns-lb-pool": "/api/config/dns",
	"dns-load-balancer": "/api/config/dns",
	"geo-location-set": "/api/config/dns",
	"secret-policy": "/api/secret_management",
	"api-credential": "/api/web",
	"service-credential": "/api/web",
	role: "/api/web/custom",
	"v1-dns-monitor": "/api/observability/synthetic_monitor",
	"v1-http-monitor": "/api/observability/synthetic_monitor",
};

/**
 * Build the API collection path (no host) for a resource, e.g.
 * `/api/config/dns/namespaces/demo/dns_zones`. Routes non-standard API groups so
 * both the strict cross-check (GET) and the spec-prober (POST) hit the right path.
 */
export function apiCollectionPath(resource: string, namespace: string): string {
	const group = API_GROUP[resource] ?? "/api/config";
	return `${group}/namespaces/${namespace}/${apiKindFor(resource)}`;
}

/**
 * Build the API item path (no host) for a resource GET, e.g.
 * `/api/config/dns/namespaces/demo/dns_zones/<name>`.
 */
export function apiItemPath(resource: string, namespace: string, name: string): string {
	return `${apiCollectionPath(resource, namespace)}/${name}`;
}

export interface ScoreInput {
	operation: SweepOperation;
	/** The workflow runner's overall verdict for this operation. */
	runnerStatus: "pass" | "fail";
	/** True when the runner short-circuited create because the resource already existed. */
	runnerSkipped: boolean;
	/**
	 * Result of the independent API-GET post-condition check at the correct namespace:
	 * - true  → resource present
	 * - false → resource absent
	 * - null  → the check could not be performed (treated as indeterminate, never a pass)
	 */
	apiExists: boolean | null;
	/** True when the console showed a "We found N errors" banner. */
	errorBanner: boolean;
}

export type Verdict = "pass" | "fail" | "indeterminate";

export interface ScoreResult {
	verdict: Verdict;
	reason: string;
}

/**
 * Strict cross-check scoring. A pass requires BOTH the runner and the
 * independent API post-condition to agree, with no error banner.
 */
export function scoreOperation(input: ScoreInput): ScoreResult {
	const { operation, runnerStatus, runnerSkipped, apiExists, errorBanner } = input;

	// A skipped create never exercised the operation → indeterminate.
	if (runnerSkipped) {
		return {
			verdict: "indeterminate",
			reason: "create skipped — resource already existed (not exercised; delete-first to test)",
		};
	}

	// The API post-condition is authoritative; if we couldn't check it, we cannot claim a pass.
	if (apiExists === null) {
		return { verdict: "indeterminate", reason: "API post-condition check unavailable" };
	}

	if (runnerStatus === "fail") {
		return { verdict: "fail", reason: "workflow runner reported failure" };
	}

	if (errorBanner) {
		return { verdict: "fail", reason: "console showed an error banner after submit" };
	}

	// Expected API post-condition per operation.
	const expectedPresent = operation !== "delete";
	if (apiExists !== expectedPresent) {
		return {
			verdict: "fail",
			reason: expectedPresent
				? "runner reported pass but API-GET shows the resource does not exist"
				: "runner reported delete but API-GET shows the resource still exists",
		};
	}

	return { verdict: "pass", reason: "runner + API post-condition agree" };
}
