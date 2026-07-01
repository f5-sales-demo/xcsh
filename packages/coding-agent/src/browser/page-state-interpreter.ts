/**
 * Page-state interpreter — deterministic URL→CRUD-state resolution.
 *
 * Parses a raw console URL against the route patterns from `console_ui.yaml`
 * (the single source of truth) to produce a structured {@link PageState}: which
 * workspace, resource, namespace, and CRUD operation the user is on. Combined
 * with UI-state signals (modal visible, Enable Edits, active tab) captured by
 * CDP, the chat agent receives INTERPRETED context on every turn — not a raw
 * URL string the LLM must guess about.
 *
 * Pure and chrome-free: unit-testable with synthetic URLs and routes.
 */

export interface RouteEntry {
	resourceId: string;
	workspace: string;
	/** Route pattern from console_ui.yaml, e.g. "/namespaces/{namespace}/manage/load_balancers/origin_pools" */
	routePattern: string;
}

export interface UiSignals {
	formVisible?: boolean;
	newBadge?: boolean;
	enableEditsActive?: boolean;
	modalBlocking?: boolean;
	modalText?: string;
	activeFormTab?: string;
	errorBannerText?: string;
	itemCount?: number;
}

export type CrudOperation = "list" | "create" | "view" | "edit" | "login" | "unknown";

export interface PageState {
	/** The workspace slug (e.g. "web-app-and-api-protection") or null. */
	workspace: string | null;
	/** The matched resource id (e.g. "origin-pool") or null. */
	resource: string | null;
	/** The detected CRUD operation. */
	operation: CrudOperation;
	/** The namespace extracted from the URL, if present. */
	namespace: string | null;
	/** The specific resource instance name (from the URL tail), if viewing/editing. */
	resourceName: string | null;
	/** The F5 XC tenant name (first segment of the hostname, e.g. the first segment of the hostname). */
	tenant: string | null;
	/** The environment: "staging" (<tenant>.staging.volterra.us) or "production" (<tenant>.console.ves.volterra.io). */
	environment: "staging" | "production" | null;
	/** True when a blocking modal/overlay is visible. */
	modalBlocking: boolean;
	/** Text of the blocking modal (for the LLM to describe / the catalog to match). */
	modalText: string | null;
	/** The raw URL path for reference. */
	path: string;
}

/**
 * Interpret a console URL + optional UI signals into a structured page state.
 *
 * @param url      The full console URL (https://tenant.volterra.us/web/workspaces/...).
 * @param signals  UI-state signals from CDP (null if not available).
 * @param routes   Route entries from console_ui.yaml.
 */
export function interpretPageState(url: string, signals: UiSignals | null, routes: readonly RouteEntry[]): PageState {
	let path: string;
	let hostname = "";
	try {
		const parsed = new URL(url);
		path = parsed.pathname;
		hostname = parsed.hostname;
	} catch {
		path = url;
	}

	// Detect tenant + environment from hostname.
	// F5 XC environments:
	//   Production: <tenant>.console.ves.volterra.io (e.g. <tenant>.console.ves.volterra.io)
	//   Staging:    <tenant>.staging.volterra.us     (e.g. <tenant>.staging.volterra.us)
	let tenant: string | null = null;
	let environment: "staging" | "production" | null = null;

	const stagingMatch = hostname.match(/^([a-z0-9-]+)\.staging\.volterra\.us$/);
	const prodMatch = hostname.match(/^([a-z0-9-]+)\.console\.ves\.volterra\.io$/);
	if (stagingMatch) {
		tenant = stagingMatch[1];
		environment = "staging";
	} else if (prodMatch) {
		tenant = prodMatch[1];
		environment = "production";
	}

	// Detect LOGIN page (Keycloak OIDC) — session expired or first login.
	// Keycloak URL: https://login-staging.volterra.us/auth/realms/<realm>/protocol/openid-connect/<action>
	// The realm is the tenant identifier (e.g. <tenant>-<realm-suffix>).
	// OIDC actions: auth (login form), token, logout, userinfo, certs.
	const isLoginHost =
		hostname === "login.ves.volterra.io" || // production Keycloak
		hostname === "login-staging.volterra.us" || // staging Keycloak
		/^login(-[a-z0-9]+)?\.volterra\.(us|io)$/.test(hostname);
	const oidcMatch = path.match(/^\/auth\/realms\/([^/]+)\/protocol\/openid-connect(?:\/([a-z]+))?/i);
	if (isLoginHost && oidcMatch) {
		const realm = oidcMatch[1]; // tenant realm identifier (e.g. <tenant>-<realm-suffix>)
		const oidcAction = oidcMatch[2] ?? "auth"; // auth, token, logout, etc.
		// Detect environment from the login hostname.
		if (!environment) {
			environment = hostname.includes("staging") ? "staging" : "production";
		}
		if (!tenant && realm) {
			tenant = realm.replace(/-[a-z0-9]+$/, ""); // strip the realm suffix to get the tenant name
		}
		return {
			workspace: null,
			resource: null,
			operation: "login" as CrudOperation,
			namespace: null,
			resourceName: oidcAction, // the OIDC action (auth/token/logout) as the "resource name"
			tenant,
			environment,
			modalBlocking: signals?.modalBlocking ?? false,
			modalText: signals?.modalText ?? null,
			path,
		};
	}

	// Extract workspace from /web/workspaces/<workspace>/...
	const wsMatch = path.match(/\/web\/workspaces\/([^/]+)/);
	const workspace = wsMatch?.[1] ?? null;

	// Extract namespace from /namespaces/<namespace>/...
	const nsMatch = path.match(/\/namespaces\/([^/]+)/);
	const namespace = nsMatch?.[1] ?? null;

	// Strip the workspace + namespace prefix to get the resource path.
	// e.g. /web/workspaces/waap/namespaces/demo/manage/load_balancers/origin_pools
	//   → /manage/load_balancers/origin_pools
	let resourcePath = path;
	if (wsMatch) {
		const afterWs = path.indexOf(wsMatch[0]) + wsMatch[0].length;
		resourcePath = path.slice(afterWs);
	}
	if (nsMatch) {
		const afterNs = resourcePath.indexOf(nsMatch[0]) + nsMatch[0].length;
		resourcePath = resourcePath.slice(afterNs);
	}

	// Match against route patterns (longest match wins).
	let bestMatch: { entry: RouteEntry; tail: string } | null = null;
	for (const entry of routes) {
		// Normalize: strip {namespace} from the pattern for matching.
		const pattern = entry.routePattern.replace(/\/namespaces\/\{namespace\}/g, "");
		if (resourcePath.startsWith(pattern)) {
			const tail = resourcePath.slice(pattern.length);
			if (
				!bestMatch ||
				pattern.length > bestMatch.entry.routePattern.replace(/\/namespaces\/\{namespace\}/g, "").length
			) {
				bestMatch = { entry, tail };
			}
		}
	}

	if (!bestMatch) {
		return {
			workspace,
			resource: null,
			operation: "unknown",
			namespace,
			resourceName: null,
			tenant,
			environment,
			modalBlocking: signals?.modalBlocking ?? false,
			modalText: signals?.modalText ?? null,
			path,
		};
	}

	// Determine operation from the URL tail + UI signals.
	const tail = bestMatch.tail.replace(/^\//, "").replace(/\/$/, "");
	let operation: CrudOperation;
	let resourceName: string | null = null;

	if (!tail) {
		// URL ends at the collection (no resource name in the path).
		if (signals?.formVisible && signals?.newBadge) {
			operation = "create";
		} else {
			operation = "list";
		}
	} else {
		// URL has a tail segment = resource instance name.
		resourceName = decodeURIComponent(tail.split("/")[0]);
		if (signals?.enableEditsActive) {
			operation = "edit";
		} else {
			operation = "view";
		}
	}

	return {
		workspace: bestMatch.entry.workspace || workspace,
		resource: bestMatch.entry.resourceId,
		operation,
		namespace,
		resourceName,
		tenant,
		environment,
		modalBlocking: signals?.modalBlocking ?? false,
		modalText: signals?.modalText ?? null,
		path,
	};
}
