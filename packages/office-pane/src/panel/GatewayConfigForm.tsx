/**
 * GatewayConfigForm — in-pane "Gateway" connection settings.
 *
 * Gives xcsh parity with Claude for Office's built-in Gateway config: the user
 * enters a base URL + token (+ optional model) in the task pane. All validation
 * is delegated to core's {@link normalizeGatewayConfig}, so this form is a thin
 * presentational shell over the shared contract.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { Button, Field, Input } from "@fluentui/react-components";
import { useState } from "react";

import {
	DEFAULT_GATEWAY_MODEL,
	type GatewayConfig,
	GatewayConfigError,
	type GatewayConfigInput,
	normalizeGatewayConfig,
} from "../core";

export interface GatewayConfigFormProps {
	/** Called with the validated, normalized config when the user saves. */
	onSave: (config: GatewayConfig) => void;
	/** Optional prefill (e.g. an existing config being edited, or a manifest default). */
	initial?: Partial<GatewayConfigInput>;
	/** When provided, renders a Cancel button that invokes this. */
	onCancel?: () => void;
}

export function GatewayConfigForm({ onSave, initial, onCancel }: GatewayConfigFormProps) {
	const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
	const [token, setToken] = useState(initial?.token ?? "");
	const [model, setModel] = useState(initial?.model ?? "");
	const [error, setError] = useState<string | null>(null);

	function handleSave() {
		try {
			const config = normalizeGatewayConfig({
				baseUrl,
				token,
				// Empty model → let core apply its default.
				model: model.trim() || undefined,
			});
			setError(null);
			onSave(config);
		} catch (err) {
			// Surface the actionable message from GatewayConfigError; rethrow anything
			// unexpected so it isn't silently swallowed.
			if (err instanceof GatewayConfigError) {
				setError(err.message);
			} else {
				throw err;
			}
		}
	}

	return (
		<div>
			<Field label="Gateway URL">
				<Input
					type="url"
					value={baseUrl}
					placeholder="https://127-0-0-1.local-ip.sh:8443/anthropic"
					onChange={(_e, d) => setBaseUrl(d.value)}
				/>
			</Field>
			<Field label="Token">
				<Input type="password" value={token} onChange={(_e, d) => setToken(d.value)} />
			</Field>
			<Field label="Model" hint={`Optional — defaults to ${DEFAULT_GATEWAY_MODEL}`}>
				<Input value={model} placeholder={DEFAULT_GATEWAY_MODEL} onChange={(_e, d) => setModel(d.value)} />
			</Field>
			{error && (
				<div role="alert" style={{ color: "#b10e1c" }}>
					{error}
				</div>
			)}
			<Button appearance="primary" onClick={handleSave}>
				Save &amp; connect
			</Button>
			{onCancel && <Button onClick={onCancel}>Cancel</Button>}
		</div>
	);
}
