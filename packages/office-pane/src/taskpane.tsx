/**
 * Task-pane entry point.
 *
 * On `Office.onReady`, mounts the reused `ChatPanel` wired to a
 * `LoopbackBridgeTransport` (wss → xcsh bridge on 127-0-0-1.local-ip.sh) into
 * the page `#root`, advertising the host-appropriate Office.js document tools.
 *
 * Browser-safe: no node:* imports.
 */

import { LoopbackBridgeTransport } from "./core";
import { wireExcelHostTools } from "./office/excel-tools";
import { initOfficeHost, mountPanel } from "./office/host-adapter";
import { wirePowerPointHostTools } from "./office/powerpoint-tools";

async function main(): Promise<void> {
	const { host } = await initOfficeHost();

	const container = document.getElementById("root");
	if (!container) {
		throw new Error("No #root element in taskpane.html");
	}

	const transport = new LoopbackBridgeTransport();
	// Advertise the host-appropriate document tools once the bridge is open:
	// Excel → read_range/write_range; PowerPoint → read_slides/add_text_box/add_slide.
	const { onConnected } = host === "PowerPoint" ? wirePowerPointHostTools(transport) : wireExcelHostTools(transport);
	mountPanel(container, transport, onConnected);
}

void main();
