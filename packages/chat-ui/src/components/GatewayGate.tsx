/**
 * Config-or-chat orchestration, reskinned to the terminal aesthetic and made
 * headless: no Transport / store / ChatPanel imports (those stay per-host). The
 * host owns the persisted config (passes it in as `config`, persists via
 * `onSaveConfig`); this gate decides whether to show the {@link GatewayConfigForm}
 * or the host-rendered chat (`children(config, api)`).
 *
 * It renders NO chrome of its own: `api.reconfigure()` reopens the (prefilled)
 * form, and the host decides where that lives — the Office pane puts it in the
 * header's "⋯" menu, and a configure-error banner uses it as its recovery action.
 * (This gate used to render its own floating "Settings" button; that stacked a
 * second right-aligned row above the host's header, which in an Office task pane
 * collided with Office's native ⓘ button.)
 *
 * Two modes:
 *  - **config-required** (default): a missing config forces the form first (the
 *    gateway is mandatory before chat).
 *  - **chat-first** (`optional`): a missing config renders the chat anyway, with
 *    config demoted to the host's optional Settings affordance. For a single-engine host
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
}

export function GatewayGate<T>({
	config,
	validate,
	onSaveConfig,
	children,
	optional = false,
	initial,
	configToDraft,
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

	return <>{children(config, { reconfigure })}</>;
}
