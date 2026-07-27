/**
 * A credential-free snapshot of the model serving the current session.
 *
 * `xcsh://about` is the authoritative self-identity document, but it reported only the build
 * fingerprint and platform context — nothing said which model was answering (#2459). Asked "what
 * model are you?", the agent had to shell out, and the best it could measure was the default a *new*
 * session would resolve, not this one's.
 *
 * Sanitization happens here rather than in the renderer, because by the time the renderer sees
 * `gatewayHost` the secret is already gone: a leak test against the renderer would prove nothing.
 */
import type { Model } from "@f5-sales-demo/pi-ai";

/**
 * Where the active model came from.
 *
 * No `env` member: there is no environment variable for the *default* model — `PI_SMOL_MODEL` and
 * friends set the role models only — so an `env` value would be unreachable.
 */
export type ModelResolutionSource = "launch-flag" | "config" | "runtime-switch";

export interface ActiveModelSnapshot {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly api: string;
	/** Host of the model's base URL. Host only, never a full URL — see `gatewayHost()`. */
	readonly gatewayHost: string;
	readonly contextWindow: number;
	readonly resolutionSource: ModelResolutionSource;
	/** Plain-language gloss on `resolutionSource`, so the doc explains itself. */
	readonly resolutionSourceNote: string;
	/** Role model selectors as configured; a role is absent when unset. */
	readonly roles: { readonly smol?: string; readonly slow?: string; readonly plan?: string };
}

const SOURCE_NOTES: Record<ModelResolutionSource, string> = {
	"launch-flag": "(selected with --model at launch)",
	config: "(from settings, a remembered role, or a resumed session)",
	"runtime-switch": "(switched during this session)",
};

/**
 * The host of a base URL, and nothing else.
 *
 * `.host` rather than `.href` is deliberate: it excludes userinfo by definition and drops the path
 * and query, which is where Azure-style deployment ids and `?api-version=` live. A gateway host is
 * useful for diagnosing a demo; a credential never is.
 */
export function gatewayHost(baseUrl: string | undefined): string {
	if (!baseUrl) return "unknown";
	try {
		return new URL(baseUrl).host || "unknown";
	} catch {
		return "unknown";
	}
}

export interface ActiveModelSources {
	readonly model: Model | undefined;
	readonly resolutionSource: ModelResolutionSource;
	readonly roles: { smol?: string; slow?: string; plan?: string };
}

/** Build the snapshot, or null when no model has been resolved for the session yet. */
export function buildActiveModelSnapshot(sources: ActiveModelSources): ActiveModelSnapshot | null {
	const { model } = sources;
	if (!model) return null;

	const roles: { smol?: string; slow?: string; plan?: string } = {};
	if (sources.roles.smol) roles.smol = sources.roles.smol;
	if (sources.roles.slow) roles.slow = sources.roles.slow;
	if (sources.roles.plan) roles.plan = sources.roles.plan;

	return {
		id: model.id,
		name: model.name,
		provider: String(model.provider),
		api: String(model.api),
		gatewayHost: gatewayHost(model.baseUrl),
		contextWindow: model.contextWindow,
		resolutionSource: sources.resolutionSource,
		resolutionSourceNote: SOURCE_NOTES[sources.resolutionSource],
		roles,
	};
}
