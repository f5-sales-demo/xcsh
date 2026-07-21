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
 * Browser-safe: no node:* imports, no Office.js.
 */

import type { GatewayConfigDraft, GatewayValidateResult } from "@f5-sales-demo/xcsh-chat-ui";
import { GatewayGate as SharedGatewayGate } from "@f5-sales-demo/xcsh-chat-ui";
import { useEffect, useMemo, useState } from "react";

import {
	DEFAULT_GATEWAY_MODEL,
	type GatewayConfig,
	GatewayConfigError,
	type GatewayConfigInput,
	type GatewayConfigStore,
	normalizeGatewayConfig,
	type Transport,
} from "../core";
import { ChatPanel } from "./ChatPanel";

/** A transport plus the optional post-connect hook (e.g. advertise host tools). */
export interface BuiltTransport {
	transport: Transport;
	onConnected?: () => void;
}

export interface GatewayGateProps {
	store: GatewayConfigStore;
	/** Build the transport for a saved config. */
	buildTransport: (config: GatewayConfig) => BuiltTransport;
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

	// Build the transport once per config identity — not per render. buildTransport
	// is intentionally omitted from the deps: a new config is the only thing that
	// should rebuild the transport.
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only on config change
	const built = useMemo<BuiltTransport | null>(() => (config ? buildTransport(config) : null), [config]);

	// Tear down a superseded transport (on reconfigure) and on unmount.
	useEffect(() => () => built?.transport.dispose(), [built]);

	return (
		<SharedGatewayGate<GatewayConfig>
			config={config}
			validate={validate}
			onSaveConfig={cfg => {
				store.save(cfg);
				setConfig(cfg);
			}}
			initial={initial}
			// GatewayConfig is a superset of the draft — reopen Settings prefilled.
			configToDraft={cfg => cfg}
			defaultModel={DEFAULT_GATEWAY_MODEL}
		>
			{() => (built ? <ChatPanel transport={built.transport} onConnected={built.onConnected} /> : null)}
		</SharedGatewayGate>
	);
}
