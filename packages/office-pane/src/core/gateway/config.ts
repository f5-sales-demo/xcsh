/**
 * Gateway connection config for the single-engine provider-configure flow.
 *
 * The pane collects an OpenAI-compatible gateway base URL + token (+ optional
 * model override) and sends it to xcsh over the bridge's `configure` frame.
 * xcsh remains the intelligence engine and owns the production model default;
 * this is just the validated shape of what the user enters.
 *
 * Browser-safe: no node:* imports, no Office.js, no runtime @f5-sales-demo/* deps.
 */

/** A validated, normalized gateway connection. */
export interface GatewayConfig {
	/**
	 * Gateway root URL: scheme + host (and optional port), with no provider path
	 * (for example `https://gateway.example.com`).
	 */
	baseUrl: string;
	/** Gateway API key / token. */
	token: string;
	/** Optional model id override. Omitted means xcsh uses its configured default. */
	model?: string;
}

/** User-supplied gateway settings before normalization/validation. */
export interface GatewayConfigInput {
	baseUrl: string;
	token: string;
	model?: string;
}

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

	const rawBaseUrl = (input.baseUrl ?? "").trim();
	if (!rawBaseUrl) {
		throw new GatewayConfigError("A gateway base URL is required.");
	}

	let parsed: URL;
	try {
		parsed = new URL(rawBaseUrl);
	} catch {
		throw new GatewayConfigError(`Gateway base URL is not a valid URL: ${rawBaseUrl}`);
	}
	if (parsed.protocol !== "https:") {
		throw new GatewayConfigError("Gateway base URL must use https:// (the WebView blocks mixed content).");
	}
	if (!parsed.hostname) {
		throw new GatewayConfigError(`Gateway base URL is missing a host: ${rawBaseUrl}`);
	}
	// Saved v2 configs may contain /v1, /api/v1, /openai/v1, or /anthropic.
	// Keep them working by recovering the gateway origin. xcsh derives the active
	// provider's path from the selected model instead of trusting this legacy path.
	const baseUrl = parsed.origin;

	const model = (input.model ?? "").trim();

	return model ? { baseUrl, token, model } : { baseUrl, token };
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
