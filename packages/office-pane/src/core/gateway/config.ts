/**
 * Gateway connection config for the single-engine provider-configure flow.
 *
 * The pane collects an Anthropic-compatible gateway base URL + token (+ optional
 * model) — mirroring Claude for Office's "Gateway" box — and sends it to xcsh
 * over the bridge's `configure` frame so xcsh points at that gateway. xcsh
 * remains the intelligence engine; this is just the validated shape of what the
 * user enters.
 *
 * Browser-safe: no node:* imports, no Office.js, no runtime @f5-sales-demo/* deps.
 */

/** A validated, normalized gateway connection. */
export interface GatewayConfig {
	/**
	 * Gateway base URL: scheme + host + optional path, NO trailing slash and NOT
	 * including `/v1` (e.g. `https://f5ai.pd.f5net.com/anthropic`).
	 */
	baseUrl: string;
	/** Gateway API key / token. */
	token: string;
	/** Model id (e.g. `claude-opus-4-8`). */
	model: string;
}

/** User-supplied gateway settings before normalization/validation. */
export interface GatewayConfigInput {
	baseUrl: string;
	token: string;
	model?: string;
}

/** Default model, matching the xcsh binary-baked default. */
export const DEFAULT_GATEWAY_MODEL = "claude-opus-4-8";

/** Thrown when {@link normalizeGatewayConfig} rejects invalid user input. */
export class GatewayConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GatewayConfigError";
	}
}

/**
 * Validate + normalize user-supplied gateway settings into a {@link GatewayConfig}.
 * Throws {@link GatewayConfigError} with an actionable message on invalid input.
 */
export function normalizeGatewayConfig(input: GatewayConfigInput): GatewayConfig {
	const token = (input.token ?? "").trim();
	if (!token) {
		throw new GatewayConfigError("A gateway token is required.");
	}

	let baseUrl = (input.baseUrl ?? "").trim();
	if (!baseUrl) {
		throw new GatewayConfigError("A gateway base URL is required.");
	}
	// Strip a trailing slash and a mistakenly-included Anthropic path suffix so the
	// operator can paste either `.../anthropic` or `.../anthropic/v1[/messages]`.
	baseUrl = baseUrl.replace(/\/+$/, "");
	baseUrl = baseUrl.replace(/\/v1(?:\/messages)?$/, "");
	baseUrl = baseUrl.replace(/\/+$/, "");

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new GatewayConfigError(`Gateway base URL is not a valid URL: ${baseUrl}`);
	}
	if (parsed.protocol !== "https:") {
		throw new GatewayConfigError("Gateway base URL must use https:// (the WebView blocks mixed content).");
	}
	if (!parsed.hostname) {
		throw new GatewayConfigError(`Gateway base URL is missing a host: ${baseUrl}`);
	}

	const model = (input.model ?? "").trim() || DEFAULT_GATEWAY_MODEL;

	return { baseUrl, token, model };
}

/**
 * Persistence seam for the gateway config. The Office add-in supplies a concrete
 * store backed by `localStorage`; core ships an in-memory default for tests.
 */
export interface GatewayConfigStore {
	load(): GatewayConfig | null;
	save(config: GatewayConfig): void;
	clear(): void;
}

/** In-memory {@link GatewayConfigStore}; not persistent across reloads. */
export class MemoryGatewayConfigStore implements GatewayConfigStore {
	private _config: GatewayConfig | null = null;

	load(): GatewayConfig | null {
		return this._config;
	}

	save(config: GatewayConfig): void {
		this._config = config;
	}

	clear(): void {
		this._config = null;
	}
}
