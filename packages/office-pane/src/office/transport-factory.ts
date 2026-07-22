/**
 * The shipped-entry glue that builds a chat transport from a saved gateway
 * config — extracted from `taskpane.tsx` so its behavioral decisions are
 * unit-testable (the bundle entry is not):
 *
 *  - create a `LoopbackBridgeTransport` to the local xcsh bridge;
 *  - wire the host-appropriate Office.js document tools;
 *  - expose a `provision()` that points xcsh's provider at the saved gateway via
 *    the `configure` frame, but only when the bridge advertised the capability
 *    (`canConfigureProvider`) — else `provision` is absent (nothing to configure,
 *    and an awaited `configure()` against a bridge that never answers would hang);
 *  - expose `onConnected()` that advertises the host tools.
 *
 * The panel (`useChatSession`) sequences these: connect → provision → onConnected,
 * gating chat until provisioning resolves. A `configure` rejection PROPAGATES out
 * of `provision()` (it is no longer swallowed here) so the panel surfaces it as a
 * non-silent error instead of proceeding against xcsh's baked-in default (#2134).
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
 * Build the `buildTransport` factory the GatewayGate calls once per config
 * identity. Captures the detected {@link OfficeHost} so each built transport
 * advertises the right document tools.
 *
 * A `null` config is the CHAT-FIRST default (no stored pane config): the built
 * transport just connects and chats over xcsh's already-configured provider — no
 * `provision` step. A non-null config additionally points xcsh's provider at the
 * saved gateway via {@link BuiltTransport.provision}.
 */
export function makeBuildTransport(
	host: OfficeHost,
	deps: TransportFactoryDeps = defaultDeps,
): (config: GatewayConfig | null) => BuiltTransport {
	return (config: GatewayConfig | null): BuiltTransport => {
		const transport = deps.createTransport();
		const wired = deps.wireHostTools(host, transport);
		return {
			transport,
			// Provision only when there IS a config to apply AND the bridge can
			// configure; a rejection propagates (the panel surfaces it) rather than
			// being swallowed here. No config → chat over xcsh's existing provider.
			provision:
				config && transport.canConfigureProvider
					? async () => {
							await transport.configure({ baseUrl: config.baseUrl, token: config.token, model: config.model });
						}
					: undefined,
			onConnected: () => wired.onConnected(),
		};
	};
}
