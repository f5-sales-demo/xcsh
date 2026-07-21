/**
 * Config-or-chat orchestration, reskinned to the terminal aesthetic and made
 * headless: no Transport / store / ChatPanel imports (those stay per-host). The
 * host owns the persisted config (passes it in as `config`, persists via
 * `onSaveConfig`); this gate only decides whether to show the
 * {@link GatewayConfigForm} or the host-rendered chat (`children(config)`), plus
 * a Settings affordance to reconfigure.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { useState } from "react";
import type { GatewayConfigDraft, GatewayValidateResult, ReactNode } from "../types";
import { GatewayConfigForm } from "./GatewayConfigForm";

export interface GatewayGateProps<T> {
	/** The host's currently persisted config, or null when unconfigured. */
	config: T | null;
	validate: (draft: GatewayConfigDraft) => GatewayValidateResult<T>;
	/** Host persists the new config (and re-renders with an updated `config`). */
	onSaveConfig: (config: T) => void;
	/** Renders the chat over a configured gateway. */
	children: (config: T) => ReactNode;
	/** First-run prefill (e.g. a manifest `gateway_url`). */
	initial?: Partial<GatewayConfigDraft>;
	defaultModel?: string;
}

export function GatewayGate<T>({
	config,
	validate,
	onSaveConfig,
	children,
	initial,
	defaultModel,
}: GatewayGateProps<T>) {
	const [editing, setEditing] = useState(false);

	if (!config || editing) {
		return (
			<GatewayConfigForm<T>
				validate={validate}
				initial={initial}
				defaultModel={defaultModel}
				onSave={cfg => {
					onSaveConfig(cfg);
					setEditing(false);
				}}
				onCancel={config ? () => setEditing(false) : undefined}
			/>
		);
	}

	return (
		<>
			<button type="button" className="gateway-settings-btn" onClick={() => setEditing(true)}>
				Settings
			</button>
			{children(config)}
		</>
	);
}
