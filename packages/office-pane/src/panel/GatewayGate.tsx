/**
 * GatewayGate — config-or-chat orchestration.
 *
 * Mirrors Claude for Office's flow: if the pane has no gateway config yet, show
 * the {@link GatewayConfigForm}; once configured, show the {@link ChatPanel} over
 * a transport built from that config, with a Settings affordance to reconfigure.
 *
 * The gate is transport-agnostic: it persists via an injected
 * {@link GatewayConfigStore} and builds the transport via an injected factory,
 * so the panel never hard-depends on a concrete transport (the Office add-in
 * supplies the transport + host-tool wiring).
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { Button } from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";

import type { GatewayConfig, GatewayConfigInput, GatewayConfigStore, Transport } from "../core";
import { ChatPanel } from "./ChatPanel";
import { GatewayConfigForm } from "./GatewayConfigForm";

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

export function GatewayGate({ store, buildTransport, initial }: GatewayGateProps) {
	const [config, setConfig] = useState<GatewayConfig | null>(() => store.load());
	const [editing, setEditing] = useState(false);

	// Build the transport once per config identity — not per render. buildTransport
	// is intentionally omitted from the deps: a new config is the only thing that
	// should rebuild the transport.
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only on config change
	const built = useMemo<BuiltTransport | null>(() => (config ? buildTransport(config) : null), [config]);

	// Tear down a superseded transport (on reconfigure) and on unmount.
	useEffect(() => () => built?.transport.dispose(), [built]);

	if (!config || editing) {
		return (
			<GatewayConfigForm
				initial={editing && config ? config : initial}
				onSave={cfg => {
					store.save(cfg);
					setConfig(cfg);
					setEditing(false);
				}}
				onCancel={config ? () => setEditing(false) : undefined}
			/>
		);
	}

	if (!built) return null; // unreachable: config is set here

	return (
		<div>
			<Button size="small" onClick={() => setEditing(true)}>
				Settings
			</Button>
			<ChatPanel transport={built.transport} onConnected={built.onConnected} />
		</div>
	);
}
