/**
 * Config-or-chat orchestration for the Office add-in.
 *
 * A thin, office-specific wrapper over the shared headless
 * `@f5-sales-demo/xcsh-chat-ui` `GatewayGate<T>`: it owns the office concerns the
 * shared gate is deliberately blind to — persisting the config via a
 * {@link GatewayConfigStore}, building (and tearing down) the concrete
 * {@link Transport} per config, and validating input through core's
 * `normalizeGatewayConfig`. The shared gate owns the config-vs-chat decision, the
 * form, and the Settings affordance.
 *
 * CHAT-FIRST: the shared gate runs in `optional` mode — an unconfigured pane opens
 * straight into chat over xcsh's already-configured provider (no forced login),
 * with the gateway form demoted to Settings. A stored config additionally points
 * xcsh's provider at that gateway (the `configure` round-trip). If a turn fails
 * because the provider rejected us (`provider-4xx`), the config form auto-opens.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */

import type { GatewayConfigDraft, GatewayValidateResult } from "@f5-sales-demo/xcsh-chat-ui";
import { GatewayGate as SharedGatewayGate } from "@f5-sales-demo/xcsh-chat-ui";
import { useEffect, useMemo, useState } from "react";

import {
	type GatewayConfig,
	GatewayConfigError,
	type GatewayConfigInput,
	type GatewayConfigStore,
	normalizeGatewayConfig,
	type Transport,
} from "../core";
import { ChatPanel } from "./ChatPanel";

/** A transport plus the optional post-connect lifecycle hooks. */
export interface BuiltTransport {
	transport: Transport;
	/**
	 * Point xcsh's provider at the saved gateway (the single-engine `configure`
	 * round-trip). Runs after `connect()` and BEFORE {@link onConnected}; resolves
	 * on `configure_ack` and REJECTS on `configure_error` / mid-configure
	 * disconnect so the panel can surface the failure instead of proceeding
	 * silently against xcsh's baked-in default provider (#2134). Absent when the
	 * bridge did not advertise the capability (nothing to configure).
	 */
	provision?: () => Promise<void>;
	/** Advertise host tools once provisioning succeeds (needs an open socket). */
	onConnected?: () => void;
}

export interface GatewayGateProps {
	store: GatewayConfigStore;
	/** Build the transport for the current config. A `null` config is the
	 *  chat-first default — connect and chat over xcsh's existing provider,
	 *  without a `configure` (provision) step. */
	buildTransport: (config: GatewayConfig | null) => BuiltTransport;
	/** Optional prefill for the first-run form (e.g. a manifest `gateway_url`). */
	initial?: Partial<GatewayConfigInput>;
}

/** Wrap core's throwing `normalizeGatewayConfig` into the shared result shape. */
function validate(draft: GatewayConfigDraft): GatewayValidateResult<GatewayConfig> {
	try {
		const config = normalizeGatewayConfig({
			baseUrl: draft.baseUrl,
			token: draft.token,
			model: draft.model?.trim() || undefined,
		});
		return { ok: true, config };
	} catch (err) {
		// Surface the actionable message; rethrow anything unexpected so it isn't swallowed.
		if (err instanceof GatewayConfigError) return { ok: false, error: err.message };
		throw err;
	}
}

export function GatewayGate({ store, buildTransport, initial }: GatewayGateProps) {
	const [config, setConfig] = useState<GatewayConfig | null>(() => store.load());

	// Build the transport once per config identity — not per render. A null config
	// (chat-first) still builds a transport (connect only, no provision). buildTransport
	// is intentionally omitted from the deps: a new config is the only thing that
	// should rebuild the transport.
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only on config change
	const built = useMemo<BuiltTransport>(() => buildTransport(config), [config]);

	// Tear down a superseded transport (on reconfigure) and on unmount.
	useEffect(() => () => built.transport.dispose(), [built]);

	return (
		<SharedGatewayGate<GatewayConfig>
			config={config}
			validate={validate}
			onSaveConfig={cfg => {
				store.save(cfg);
				setConfig(cfg);
			}}
			// Chat-first: an unconfigured pane opens straight into chat (xcsh already
			// has provider creds); the form is the optional Settings affordance.
			optional
			initial={initial}
			// GatewayConfig is a superset of the draft — reopen Settings prefilled.
			configToDraft={cfg => cfg}
		>
			{(_cfg, { reconfigure }) => (
				<ChatPanel
					transport={built.transport}
					provision={built.provision}
					onConnected={built.onConnected}
					onReconfigure={reconfigure}
					onProviderConfigError={reconfigure}
				/>
			)}
		</SharedGatewayGate>
	);
}
