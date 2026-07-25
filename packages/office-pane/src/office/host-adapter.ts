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
	/** Build the transport for the current config (creates it, wires host tools, and
	 *  configures xcsh when a config is present). A `null` config is chat-first. */
	buildTransport: (config: GatewayConfig | null) => BuiltTransport;
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
 * shared stylesheet lays it out as the full-height terminal column, and
 * `.xcsh-doc` so the Office pane opts into the proportional-sans DOCUMENT
 * typography (Claude-for-Office parity) — the terminal chrome (red frame, glyph
 * gutter, powerline, code) is unchanged; only the prose read switches to sans.
 * This class is Office-only; Chrome/VS Code/CLI never set it.
 *
 * `.xcsh-host-office` is a separate marker for host-specific layout — currently
 * reserving right-side header room so our control row clears the ⓘ button Office
 * itself draws over the top-right of every task pane. It is deliberately NOT
 * folded into `.xcsh-doc`: that one means "sans document typography", and a
 * future non-Office surface could want one without the other.
 */
export function mountGate(container: Element, opts: MountGateOptions): Root {
	container.classList.add("xcsh-panel", "xcsh-doc", "xcsh-host-office");
	const root = createRoot(container);
	root.render(createElement(GatewayGate, opts));
	return root;
}
