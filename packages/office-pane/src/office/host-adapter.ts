/**
 * Office host-adapter — a thin, Office-injectable seam over `Office.onReady`.
 *
 * Browser-safe: no node:* imports. The concrete `Office` runtime is injected
 * (defaulting to the page global) so the module is unit-testable with no Office
 * runtime.
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { GatewayConfig, GatewayConfigInput, GatewayConfigStore } from "../core";
import { type BuiltTransport, GatewayGate } from "../panel";

/** The Office applications this add-in can be hosted in, plus a fallback. */
export type OfficeHost = "Excel" | "PowerPoint" | "Word" | "Outlook" | "unknown";

const KNOWN_HOSTS: readonly OfficeHost[] = ["Excel", "PowerPoint", "Word", "Outlook"];

/** Shape of the object `Office.onReady` resolves with (subset we consume). */
interface OfficeReadyInfo {
	host?: unknown;
	platform?: unknown;
}

/**
 * Minimal structural view of the Office.js global that the adapter depends on.
 * Injecting this (instead of referencing the real global `Office`) keeps the
 * module browser-safe and unit-testable.
 */
export interface OfficeLike {
	onReady(callback?: (info: OfficeReadyInfo) => void): Promise<OfficeReadyInfo>;
	context?: { host?: unknown };
}

/** Seam that resolves the page-global `Office`; overridable via injection. */
function getOffice(): OfficeLike {
	const office = (globalThis as { Office?: OfficeLike }).Office;
	if (!office) {
		throw new Error("Office.js runtime is not available on the global scope");
	}
	return office;
}

/** Map a raw `Office.context.host` value to the {@link OfficeHost} union. */
function normalizeHost(raw: unknown): OfficeHost {
	return KNOWN_HOSTS.find(host => host === raw) ?? "unknown";
}

/**
 * Await `Office.onReady` and report the detected host.
 *
 * Resolves only after `onReady` fires. Unknown/absent hosts map to
 * `'unknown'` rather than throwing.
 */
export async function initOfficeHost(office: OfficeLike = getOffice()): Promise<{ host: OfficeHost }> {
	const info = await office.onReady();
	const raw = office.context?.host ?? info?.host;
	return { host: normalizeHost(raw) };
}

/** What {@link mountGate} needs to render the config-or-chat gate. */
export interface MountGateOptions {
	store: GatewayConfigStore;
	/** Build the transport for a saved config (creates it, wires host tools, configures xcsh). */
	buildTransport: (config: GatewayConfig) => BuiltTransport;
	/** Optional first-run form prefill (e.g. a manifest `gateway_url`). */
	initial?: Partial<GatewayConfigInput>;
}

/**
 * Render the `<GatewayGate>` (config-or-chat) into `container` and return the
 * React root so callers (and tests) can unmount.
 *
 * This is the shipped entry seam: mounting the GATE — not `ChatPanel` directly —
 * means a fresh pane with no stored config shows the gateway config form first,
 * then the chat once configured. The container is marked `.xcsh-panel` so the
 * shared stylesheet lays it out as the full-height terminal column.
 */
export function mountGate(container: Element, opts: MountGateOptions): Root {
	container.classList.add("xcsh-panel");
	const root = createRoot(container);
	root.render(createElement(GatewayGate, opts));
	return root;
}
