/**
 * The shipped-entry glue that builds a chat transport from a saved gateway
 * config — extracted from `taskpane.tsx` so its behavioral decisions are
 * unit-testable (the bundle entry is not):
 *
 *  - create a `LoopbackBridgeTransport` to the local xcsh bridge;
 *  - wire the host-appropriate Office.js document tools;
 *  - on connect, point xcsh's provider at the saved gateway via the `configure`
 *    frame BEFORE advertising the host tools (both need an open socket), but only
 *    when the bridge advertised the capability (`canConfigureProvider`) — else the
 *    awaited `configure()` would hang until disconnect against a bridge that
 *    never answers `configure_ack`;
 *  - a `configure` rejection is logged and does NOT block host-tool advertisement
 *    (the session still works against xcsh's baked-in default provider). Surfacing
 *    that failure into the panel is tracked in #2134.
 *
 * The concrete transport + host-tool wiring are injected (defaulting to the real
 * ones) so tests exercise the ordering/gating/error paths with no Office runtime.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { type ConfigurableTransport, type GatewayConfig, LoopbackBridgeTransport, type Transport } from "../core";
import type { BuiltTransport } from "../panel";
import { wireExcelHostTools } from "./excel-tools";
import type { OfficeHost } from "./host-adapter";
import { wirePowerPointHostTools } from "./powerpoint-tools";
import { wireWordHostTools } from "./word-tools";

/** Injectable seams (defaulted to the real ones) so the factory is unit-testable. */
export interface TransportFactoryDeps {
	/** Create the concrete bridge transport (a `ConfigurableTransport`). */
	createTransport: () => ConfigurableTransport;
	/** Wire the host-appropriate document tools; returns the post-connect advertiser. */
	wireHostTools: (host: OfficeHost, transport: Transport) => { onConnected: () => void };
}

const defaultDeps: TransportFactoryDeps = {
	createTransport: () => new LoopbackBridgeTransport(),
	wireHostTools: (host, transport) =>
		host === "PowerPoint"
			? wirePowerPointHostTools(transport)
			: host === "Word"
				? wireWordHostTools(transport)
				: wireExcelHostTools(transport),
};

/**
 * Build the `buildTransport` factory the GatewayGate calls once per saved config.
 * Captures the detected {@link OfficeHost} so each built transport advertises the
 * right document tools.
 */
export function makeBuildTransport(
	host: OfficeHost,
	deps: TransportFactoryDeps = defaultDeps,
): (config: GatewayConfig) => BuiltTransport {
	return (config: GatewayConfig): BuiltTransport => {
		const transport = deps.createTransport();
		const wired = deps.wireHostTools(host, transport);
		return {
			transport,
			onConnected: () => {
				void (async () => {
					if (transport.canConfigureProvider) {
						try {
							await transport.configure({ baseUrl: config.baseUrl, token: config.token, model: config.model });
						} catch (err) {
							console.error("[transport-factory] provider configure failed:", err);
						}
					}
					wired.onConnected();
				})();
			},
		};
	};
}
