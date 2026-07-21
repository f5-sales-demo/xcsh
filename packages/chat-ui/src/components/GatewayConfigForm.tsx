/**
 * In-pane Gateway connection form (base URL + token + optional model), reskinned
 * from the Office Fluent form to the terminal aesthetic (plain elements + the
 * PANEL_CSS `.gateway-*` classes — no @fluentui). Validation is delegated to a
 * host-provided `validate` callback (the host wraps its own
 * `normalizeGatewayConfig`), so this form never imports host config code and the
 * result type `T` is whatever the host's normalized config is. The saved
 * config's `model` feeds the composer's ModelSelector downstream.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { useState } from "react";
import type { GatewayConfigDraft, GatewayValidateResult } from "../types";

export interface GatewayConfigFormProps<T> {
	/** Wraps the host's normalizeGatewayConfig; returns ok+config or an error. */
	validate: (draft: GatewayConfigDraft) => GatewayValidateResult<T>;
	/** Called with the validated, normalized config when the user saves. */
	onSave: (config: T) => void;
	/** Optional prefill (an existing config being edited, or a manifest default). */
	initial?: Partial<GatewayConfigDraft>;
	/** Shown as the Model field hint / placeholder. */
	defaultModel?: string;
	/** When provided, renders a Cancel button. */
	onCancel?: () => void;
}

export function GatewayConfigForm<T>({ validate, onSave, initial, defaultModel, onCancel }: GatewayConfigFormProps<T>) {
	const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
	const [token, setToken] = useState(initial?.token ?? "");
	const [model, setModel] = useState(initial?.model ?? "");
	const [error, setError] = useState<string | null>(null);

	function handleSave() {
		const result = validate({ baseUrl, token, model: model.trim() || undefined });
		if (result.ok) {
			setError(null);
			onSave(result.config);
		} else {
			setError(result.error);
		}
	}

	return (
		<div className="gateway-form">
			<div className="gateway-field">
				<label htmlFor="gateway-url">Gateway URL</label>
				<input
					id="gateway-url"
					type="url"
					value={baseUrl}
					placeholder="https://127-0-0-1.local-ip.sh:8443/anthropic"
					onChange={e => setBaseUrl(e.currentTarget.value)}
				/>
			</div>
			<div className="gateway-field">
				<label htmlFor="gateway-token">Token</label>
				<input id="gateway-token" type="password" value={token} onChange={e => setToken(e.currentTarget.value)} />
			</div>
			<div className="gateway-field">
				<label htmlFor="gateway-model">Model</label>
				<input
					id="gateway-model"
					value={model}
					placeholder={defaultModel ?? ""}
					onChange={e => setModel(e.currentTarget.value)}
				/>
				{defaultModel && <span className="gateway-hint">Optional — defaults to {defaultModel}</span>}
			</div>
			{error && (
				<div role="alert" className="gateway-error">
					{error}
				</div>
			)}
			<div className="gateway-actions">
				<button type="button" className="gateway-save" onClick={handleSave}>
					Save &amp; connect
				</button>
				{onCancel && (
					<button type="button" className="gateway-cancel" onClick={onCancel}>
						Cancel
					</button>
				)}
			</div>
		</div>
	);
}
