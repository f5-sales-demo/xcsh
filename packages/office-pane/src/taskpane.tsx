/**
 * Task-pane entry point.
 *
 * On `Office.onReady`, injects the shared xcsh-terminal theme (tokens + fonts +
 * panel stylesheet) and mounts the config-or-chat `GatewayGate` into `#root`.
 * A fresh pane (no stored gateway config) shows the config form; once configured
 * it shows the chat over a `LoopbackBridgeTransport` (wss → the local xcsh bridge
 * on 127-0-0-1.local-ip.sh) with the host-appropriate Office.js document tools
 * advertised, and xcsh's provider pointed at the saved gateway via the `configure`
 * frame — keeping xcsh the single intelligence engine.
 *
 * Browser-safe: no node:* imports.
 */

import { injectFontFaces, injectTokens, PANEL_CSS } from "@f5-sales-demo/xcsh-chat-ui";

import { type GatewayConfig, LoopbackBridgeTransport } from "./core";
import { wireExcelHostTools } from "./office/excel-tools";
import { createLocalStorageGatewayStore } from "./office/gateway-store";
import { initOfficeHost, mountGate, type OfficeHost } from "./office/host-adapter";
import { wirePowerPointHostTools } from "./office/powerpoint-tools";
import { wireWordHostTools } from "./office/word-tools";
import type { BuiltTransport } from "./panel";

/** Inject the shared terminal theme into the document once (idempotent). */
function injectTheme(doc: Document): void {
	injectTokens(doc);
	// Fonts are served next to the page (dist/fonts/), so the identity resolver's
	// relative `fonts/*.ttf` paths resolve correctly — no host URL scheme needed.
	injectFontFaces(doc);
	if (!doc.getElementById("xcsh-panel-css")) {
		const style = doc.createElement("style");
		style.id = "xcsh-panel-css";
		style.textContent = PANEL_CSS;
		(doc.head ?? doc.documentElement).append(style);
	}
}

/**
 * Build the transport for a saved gateway config: a `LoopbackBridgeTransport` to
 * the local xcsh bridge, with the host-appropriate document tools. On connect it
 * points xcsh's provider at the gateway (base URL + token + model) via `configure`
 * and only then advertises the host tools (both require an open socket).
 */
function makeBuildTransport(host: OfficeHost): (config: GatewayConfig) => BuiltTransport {
	return (config: GatewayConfig): BuiltTransport => {
		const transport = new LoopbackBridgeTransport();
		const wired =
			host === "PowerPoint"
				? wirePowerPointHostTools(transport)
				: host === "Word"
					? wireWordHostTools(transport)
					: wireExcelHostTools(transport);
		return {
			transport,
			onConnected: () => {
				void (async () => {
					try {
						await transport.configure({ baseUrl: config.baseUrl, token: config.token, model: config.model });
					} catch (err) {
						console.error("[taskpane] provider configure failed:", err);
					}
					wired.onConnected();
				})();
			},
		};
	};
}

async function main(): Promise<void> {
	const { host } = await initOfficeHost();

	injectTheme(document);

	const container = document.getElementById("root");
	if (!container) {
		throw new Error("No #root element in taskpane.html");
	}

	mountGate(container, {
		store: createLocalStorageGatewayStore(),
		buildTransport: makeBuildTransport(host),
	});
}

void main();
