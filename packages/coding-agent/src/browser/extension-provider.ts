import type { Page } from "puppeteer";
import { type AxNode, matchNode } from "./ax";
import { type BridgeServer, startBridgeServer, type ToolResult } from "./extension-bridge";
import type { AcquiredBrowser, BrowserProvider, BrowserProviderStatus } from "./provider";
import { parseLocator } from "./selector";

/** The extension's AX tree shape: an {@link AxNode} carrying a `ref` handle. */
export type AxRefNode = AxNode & { ref?: string; children?: AxRefNode[] };

/**
 * Pure adapter: resolve a selector to the extension's `ref` handle by reusing
 * xcsh's existing AX matcher. Throws if nothing matches (via {@link matchNode})
 * or the matched node carries no `ref`.
 */
export function resolveRef(tree: AxRefNode, selector: string): string {
	const node = matchNode(tree as AxNode, parseLocator(selector)) as AxRefNode;
	if (!node.ref) throw new Error(`matched node for "${selector}" has no ref handle`);
	return node.ref;
}

/** Thin wrapper over the bridge for the page-level operations the agent needs. */
export interface ExtensionPage {
	navigate(url: string): Promise<void>;
	readAx(): Promise<AxRefNode>;
	click(ref: string): Promise<void>;
	screenshot(): Promise<string>;
}

/** Unwrap a {@link ToolResult}, throwing on the error flag. */
function unwrap(result: ToolResult, tool: string): unknown {
	if (result.is_error) {
		throw new Error(`extension tool "${tool}" failed: ${JSON.stringify(result.content)}`);
	}
	return result.content;
}

class BridgeExtensionPage implements ExtensionPage {
	#server: BridgeServer;

	constructor(server: BridgeServer) {
		this.#server = server;
	}

	async navigate(url: string): Promise<void> {
		unwrap(await this.#server.request("navigate", { url }), "navigate");
	}

	async readAx(): Promise<AxRefNode> {
		return unwrap(await this.#server.request("read_ax", {}), "read_ax") as AxRefNode;
	}

	async click(ref: string): Promise<void> {
		unwrap(await this.#server.request("click", { ref }), "click");
	}

	async screenshot(): Promise<string> {
		return unwrap(await this.#server.request("screenshot", {}), "screenshot") as string;
	}
}

const CONNECT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

/** Wait (bounded) for the extension to connect to the bridge server. */
async function waitForConnection(server: BridgeServer, timeoutMs: number): Promise<void> {
	if (server.connected) return;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (server.connected) return;
		await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	if (!server.connected) {
		throw new Error(
			`extension did not connect within ${timeoutMs}ms — is the Chrome extension installed and running?`,
		);
	}
}

/**
 * BrowserProvider that drives the page through the Chrome extension over the
 * bridge socket. Acquires by ensuring the bridge is up, waiting for the
 * extension to connect, pinging, and navigating to the console URL.
 */
export class ExtensionBrowserProvider implements BrowserProvider {
	readonly name = "extension";
	#server: BridgeServer | null;

	constructor(opts?: { server?: BridgeServer }) {
		this.#server = opts?.server ?? null;
	}

	/**
	 * Acquire the extension-driven page. The returned `page` is an
	 * {@link ExtensionPage} at runtime; its static type is the base
	 * {@link AcquiredBrowser} (puppeteer `Page`) so this class satisfies
	 * {@link BrowserProvider}. The extension seam substitutes a thin
	 * `ExtensionPage` for puppeteer's `Page` — only the page abstraction
	 * differs, not the `AcquiredBrowser` shape. Consumers that need the
	 * `ExtensionPage` surface cast the page (this is exercised at Task 8).
	 */
	async acquire(consoleUrl: string): Promise<AcquiredBrowser> {
		const server = this.#server ?? (await startBridgeServer());
		this.#server = server;
		await waitForConnection(server, CONNECT_TIMEOUT_MS);
		unwrap(await server.request("ping", {}), "ping");
		unwrap(await server.request("navigate", { url: consoleUrl }), "navigate");
		const page: ExtensionPage = new BridgeExtensionPage(server);
		return {
			page: page as unknown as Page,
			mode: "extension",
			// Best-effort detach. Does NOT close the server — the slice harness
			// owns the bridge lifecycle.
			release: async () => {
				await server.request("detach", {}).catch(() => {});
			},
		};
	}

	async status(): Promise<BrowserProviderStatus & { extensionConnected: boolean }> {
		const extensionConnected = this.#server?.connected === true;
		return {
			debuggableNow: false,
			chromeRunning: false,
			chromeInstalled: false,
			plannedAction: "no-chrome",
			detail: extensionConnected
				? "Chrome extension is connected to the xcsh bridge."
				: "Chrome extension is not connected — install/enable it and reload the console tab.",
			extensionConnected,
		};
	}
}
