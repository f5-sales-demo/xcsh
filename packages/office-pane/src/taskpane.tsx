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

import { createLocalStorageGatewayStore } from "./office/gateway-store";
import { initOfficeHost, mountGate } from "./office/host-adapter";
import { makeBuildTransport } from "./office/transport-factory";

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
