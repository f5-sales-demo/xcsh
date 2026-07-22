/**
 * Config-or-chat orchestration, reskinned to the terminal aesthetic and made
 * headless: no Transport / store / ChatPanel imports (those stay per-host). The
 * host owns the persisted config (passes it in as `config`, persists via
 * `onSaveConfig`); this gate decides whether to show the {@link GatewayConfigForm}
 * or the host-rendered chat (`children(config, api)`), plus a Settings affordance
 * to reconfigure. `api.reconfigure()` lets the child reopen the (prefilled) form
 * itself — e.g. a configure-error banner's recovery action — without routing
 * through the generic Settings button.
 *
 * Two modes:
 *  - **config-required** (default): a missing config forces the form first (the
 *    gateway is mandatory before chat).
 *  - **chat-first** (`optional`): a missing config renders the chat anyway, with
 *    config demoted to the optional Settings affordance. For a single-engine host
 *    (xcsh) whose agent already has provider credentials, so the pane should not
 *    gate on a redundant login; `children` may then be called with `config: null`.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { useCallback, useState } from "react";
import type { GatewayConfigDraft, GatewayValidateResult, ReactNode } from "../types";
import { GatewayConfigForm } from "./GatewayConfigForm";

/** Imperative capabilities handed to the chat child so it can drive the gate. */
export interface GatewayGateChildApi {
	/** Reopen the config form (prefilled via `configToDraft`) — e.g. a recovery
	 *  action on a configure-error banner. */
	reconfigure: () => void;
}

export interface GatewayGateProps<T> {
	/** The host's currently persisted config, or null when unconfigured. */
	config: T | null;
	validate: (draft: GatewayConfigDraft) => GatewayValidateResult<T>;
	/** Host persists the new config (and re-renders with an updated `config`). */
	onSaveConfig: (config: T) => void;
	/** Renders the chat. In chat-first (`optional`) mode `config` may be null. */
	children: (config: T | null, api: GatewayGateChildApi) => ReactNode;
	/**
	 * Chat-first mode: a missing config does NOT force the form — render `children`
	 * (chat) with config demoted to the Settings affordance. Default false
	 * (config-required: a missing config shows the form first).
	 */
	optional?: boolean;
	/** First-run prefill (e.g. a manifest `gateway_url`). */
	initial?: Partial<GatewayConfigDraft>;
	/**
	 * Project the current config back onto an editable draft so re-opening the
	 * form via Settings is prefilled. Without it the gate cannot read `T` (it is
	 * opaque here), so editing would start from `initial`/blank. Falls back to
	 * `initial` when omitted.
	 */
	configToDraft?: (config: T) => Partial<GatewayConfigDraft>;
	defaultModel?: string;
}

export function GatewayGate<T>({
	config,
	validate,
	onSaveConfig,
	children,
	optional = false,
	initial,
	configToDraft,
	defaultModel,
}: GatewayGateProps<T>) {
	const [editing, setEditing] = useState(false);
	const reconfigure = useCallback(() => setEditing(true), []);

	// The form shows on explicit edit, or on first run ONLY when config is required.
	// In chat-first (optional) mode a missing config falls through to the chat.
	if (editing || (!config && !optional)) {
		// When editing an existing config, prefill from it (via configToDraft);
		// on first run there is no config, so fall back to the `initial` prefill.
		const prefill = editing && config ? (configToDraft?.(config) ?? initial) : initial;
		return (
			<GatewayConfigForm<T>
				validate={validate}
				initial={prefill}
				defaultModel={defaultModel}
				onSave={cfg => {
					onSaveConfig(cfg);
					setEditing(false);
				}}
				// Cancellable back to chat when there's a config to fall back to, or
				// when chat works without one (optional/chat-first mode).
				onCancel={config || optional ? () => setEditing(false) : undefined}
			/>
		);
	}

	return (
		<>
			<button type="button" className="gateway-settings-btn" onClick={reconfigure}>
				Settings
			</button>
			{children(config, { reconfigure })}
		</>
	);
}
