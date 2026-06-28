import { type AxNode, matchNode } from "./ax";
import { EXTENSION_CONTRACT_VERSION } from "./capabilities.generated";
import { type BridgeServer, startBridgeServer, type ToolResult } from "./extension-bridge";
import { checkContractVersion } from "./extension-contract";
import { ExtensionPageActions } from "./extension-page-actions";
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
	login(
		email: string,
		password: string,
		consoleUrl: string,
	): Promise<{ loggedIn: boolean; finalUrl: string; steps: string[] }>;
	readAx(): Promise<AxRefNode>;
	click(ref: string): Promise<void>;
	screenshot(): Promise<string>;
	// Phase 1 additions:
	formInput(ref: string, value: string): Promise<void>;
	keyPress(key: string): Promise<void>;
	selectOption(ref: string, value: string): Promise<void>;
	scrollTo(ref: string): Promise<void>;
	waitFor(selector: string, context?: string, timeoutMs?: number): Promise<string>;
	assertText(selector: string, expected: string, context?: string): Promise<void>;
	find(selector: string): Promise<Array<{ ref: string; role: string; name: string }>>;
	getPageText(): Promise<string>;
	javascriptTool(code: string): Promise<unknown>;
	tabsList(): Promise<Array<{ id: number; url: string; title: string; active: boolean }>>;
	tabsCreate(url: string): Promise<number>;
	tabsClose(tabId: number): Promise<void>;
	resizeWindow(width: number, height: number): Promise<void>;
	readConsole(pattern?: string): Promise<Array<{ type: string; text: string }>>;
	readNetwork(pattern?: string): Promise<Array<{ method: string; url: string; status?: number }>>;
	fileUpload(ref: string, files: Array<{ data: string; name: string; mimeType: string }>): Promise<void>;
	browserBatch(
		actions: Array<{ tool: string; params: unknown }>,
	): Promise<Array<{ tool: string; content: unknown; is_error: boolean }>>;
	/** Trusted CDP click at viewport coordinates. Last-resort primitive for points
	 * with no backing element (e.g. a computed portal point); prefer clickElement. */
	clickXy(x: number, y: number): Promise<void>;
	/** Deterministic click: `js` is an expression returning an Element (or null).
	 * The extension derives the clickable point from the renderer's layout
	 * (DOM.getContentQuads) and hit-tests it (document.elementFromPoint) before
	 * dispatching — no JS getBoundingClientRect, no silent mis-clicks. `waitMs`
	 * polls for the element (async portals). Throws loudly on occlusion. */
	clickElement(js: string, waitMs?: number): Promise<{ x: number; y: number; hit: boolean }>;
	/** CDP Input.insertText into the focused element (genuine trusted input events). */
	typeText(text: string): Promise<void>;
	/** Atomically type into a CDK-portal typeahead + click the matching option.
	 * Keeps the input focused throughout (uses plain Runtime.evaluate, not the
	 * evaluateWithRecovery path that defocuses by detaching the debugger). */
	labelSelect(
		selector: string,
		value: string,
		waitMs?: number,
	): Promise<{
		selected: string;
		matchedKind: string;
		value: string;
		optionCount: number;
	}>;
	/** Toggle the extension's "explain mode" — the gate for on-page annotation
	 * overlays (fingerprints/highlights), used during human-paced walkthroughs. */
	setExplainMode(enabled: boolean): Promise<void>;
	annotate(spec: {
		kind: string;
		ref?: string;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		text?: string;
	}): Promise<void>;
}

/** Unwrap a {@link ToolResult}, throwing on the error flag. */
function unwrap(result: ToolResult, tool: string): unknown {
	if (result.is_error) {
		throw new Error(`extension tool "${tool}" failed: ${JSON.stringify(result.content)}`);
	}
	return result.content;
}

/**
 * Connect-time discovery handshake: confirm the extension is live and that its
 * published capability contract matches what xcsh was built against. Warns (does
 * not fail) on mismatch — a co-built pair stays in lockstep, while a hand-run
 * mismatch degrades gracefully. Falls back to `ping` for an extension that
 * predates the `capabilities` tool.
 */
async function handshakeCapabilities(server: BridgeServer): Promise<void> {
	let liveContractVersion: string | undefined;
	try {
		const caps = unwrap(await server.request("capabilities", {}), "capabilities") as {
			contractVersion?: string;
		};
		liveContractVersion = caps?.contractVersion;
	} catch {
		// Older extension without the `capabilities` tool — at least confirm liveness.
		unwrap(await server.request("ping", {}), "ping");
	}
	const check = checkContractVersion(liveContractVersion, EXTENSION_CONTRACT_VERSION);
	if (!check.ok) {
		console.warn(`[xcsh] Chrome extension capability mismatch (${check.severity}): ${check.message}`);
	}
}

class BridgeExtensionPage implements ExtensionPage {
	#server: BridgeServer;

	constructor(server: BridgeServer) {
		this.#server = server;
	}

	async navigate(url: string): Promise<void> {
		unwrap(await this.#server.request("navigate", { url }), "navigate");
	}

	async login(
		email: string,
		password: string,
		consoleUrl: string,
	): Promise<{ loggedIn: boolean; finalUrl: string; steps: string[] }> {
		// Defense-in-depth: validate the console URL before sending credentials
		// over the bridge — only https F5 XC console domains are allowed, so a
		// bad consoleUrl can never carry credentials to a foreign host.
		const parsed = new URL(consoleUrl); // throws on malformed
		if (parsed.protocol !== "https:") {
			throw new Error(`login: consoleUrl must use https, got ${parsed.protocol}`);
		}
		if (!/\.volterra\.us$|\.console\.ves\.volterra\.io$/.test(parsed.hostname)) {
			throw new Error(`login: consoleUrl host "${parsed.hostname}" is not an allowed F5 XC console domain`);
		}
		return unwrap(
			await this.#server.request("login", { email, password, consoleUrl: parsed.toString() }, 90_000),
			"login",
		) as { loggedIn: boolean; finalUrl: string; steps: string[] };
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

	async setExplainMode(enabled: boolean): Promise<void> {
		unwrap(await this.#server.request("set_explain_mode", { enabled }), "set_explain_mode");
	}

	async annotate(spec: {
		kind: string;
		ref?: string;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		text?: string;
	}): Promise<void> {
		unwrap(await this.#server.request("annotate", spec), "annotate");
	}

	async formInput(ref: string, value: string): Promise<void> {
		unwrap(await this.#server.request("form_input", { ref, value }), "form_input");
	}

	async keyPress(key: string): Promise<void> {
		unwrap(await this.#server.request("key_press", { key }), "key_press");
	}

	async selectOption(ref: string, value: string): Promise<void> {
		unwrap(await this.#server.request("select_option", { ref, value }), "select_option");
	}

	async scrollTo(ref: string): Promise<void> {
		unwrap(await this.#server.request("scroll_to", { ref }), "scroll_to");
	}

	async waitFor(selector: string, context?: string, timeoutMs?: number): Promise<string> {
		return unwrap(await this.#server.request("wait_for", { selector, context, timeoutMs }), "wait_for") as string;
	}

	async assertText(selector: string, expected: string, context?: string): Promise<void> {
		unwrap(await this.#server.request("assert_text", { selector, expected, context }), "assert_text");
	}

	async find(selector: string): Promise<Array<{ ref: string; role: string; name: string }>> {
		return unwrap(await this.#server.request("find", { selector }), "find") as Array<{
			ref: string;
			role: string;
			name: string;
		}>;
	}

	async getPageText(): Promise<string> {
		return unwrap(await this.#server.request("get_page_text", {}), "get_page_text") as string;
	}

	async javascriptTool(code: string): Promise<unknown> {
		return unwrap(await this.#server.request("javascript_tool", { code }), "javascript_tool");
	}

	async tabsList(): Promise<Array<{ id: number; url: string; title: string; active: boolean }>> {
		return unwrap(await this.#server.request("tabs_list", {}), "tabs_list") as Array<{
			id: number;
			url: string;
			title: string;
			active: boolean;
		}>;
	}

	async tabsCreate(url: string): Promise<number> {
		return unwrap(await this.#server.request("tabs_create", { url }), "tabs_create") as number;
	}

	async tabsClose(tabId: number): Promise<void> {
		unwrap(await this.#server.request("tabs_close", { tabId }), "tabs_close");
	}

	async resizeWindow(width: number, height: number): Promise<void> {
		unwrap(await this.#server.request("resize_window", { width, height }), "resize_window");
	}

	async readConsole(pattern?: string): Promise<Array<{ type: string; text: string }>> {
		return unwrap(await this.#server.request("read_console", { pattern }), "read_console") as Array<{
			type: string;
			text: string;
		}>;
	}

	async readNetwork(pattern?: string): Promise<Array<{ method: string; url: string; status?: number }>> {
		return unwrap(await this.#server.request("read_network", { pattern }), "read_network") as Array<{
			method: string;
			url: string;
			status?: number;
		}>;
	}

	async fileUpload(ref: string, files: Array<{ data: string; name: string; mimeType: string }>): Promise<void> {
		unwrap(await this.#server.request("file_upload", { ref, files }), "file_upload");
	}

	async browserBatch(
		actions: Array<{ tool: string; params: unknown }>,
	): Promise<Array<{ tool: string; content: unknown; is_error: boolean }>> {
		return unwrap(await this.#server.request("browser_batch", { actions }), "browser_batch") as Array<{
			tool: string;
			content: unknown;
			is_error: boolean;
		}>;
	}

	async clickXy(x: number, y: number): Promise<void> {
		unwrap(await this.#server.request("click_xy", { x, y }), "click_xy");
	}

	async clickElement(js: string, waitMs?: number): Promise<{ x: number; y: number; hit: boolean }> {
		const timeout = Math.max(30_000, (waitMs ?? 0) + 5_000);
		return unwrap(await this.#server.request("click_element", { js, wait_ms: waitMs }, timeout), "click_element") as {
			x: number;
			y: number;
			hit: boolean;
		};
	}

	async typeText(text: string): Promise<void> {
		unwrap(await this.#server.request("type_text", { text }), "type_text");
	}

	async labelSelect(
		selector: string,
		value: string,
		waitMs?: number,
	): Promise<{ selected: string; matchedKind: string; value: string; optionCount: number }> {
		// Request timeout must exceed the handler's internal poll budget.
		const timeout = Math.max(30_000, (waitMs ?? 8_000) + 5_000);
		return unwrap(
			await this.#server.request("label_select", { selector, value, wait_ms: waitMs }, timeout),
			"label_select",
		) as { selected: string; matchedKind: string; value: string; optionCount: number };
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
	 * {@link ExtensionPageActions} wrapping the runtime {@link ExtensionPage},
	 * satisfying the {@link AcquiredBrowser.page} {@link PageActions} contract.
	 * The extension seam substitutes a thin `ExtensionPage` for puppeteer's
	 * `Page` behind the shared `PageActions` surface.
	 */
	async acquire(consoleUrl: string): Promise<AcquiredBrowser> {
		const server = this.#server ?? (await startBridgeServer());
		this.#server = server;
		await waitForConnection(server, CONNECT_TIMEOUT_MS);
		await handshakeCapabilities(server);

		const page: ExtensionPage = new BridgeExtensionPage(server);

		// Auto-login: if XCSH_USERNAME + XCSH_CONSOLE_PASSWORD are available (set by
		// ContextService from the context's env map), login automatically — the login
		// tool handles "already authenticated" (instant return) so calling it every
		// time is cheap and guarantees a valid session. Falls back to navigate-only
		// (co-drive) if credentials aren't available.
		const email = process.env.XCSH_USERNAME;
		const password = process.env.XCSH_CONSOLE_PASSWORD;
		if (email && password) {
			await page.login(email, password, consoleUrl);
		} else {
			unwrap(await server.request("navigate", { url: consoleUrl }), "navigate");
		}

		return {
			page: new ExtensionPageActions(page),
			mode: "extension",
			release: async () => {
				await server.request("detach", {}).catch(() => {});
			},
		};
	}

	async status(): Promise<BrowserProviderStatus & { extensionConnected: boolean }> {
		const extensionConnected = this.#server?.connected === true;
		let detail: string;
		if (extensionConnected) {
			detail = "Chrome extension is connected to the xcsh bridge.";
		} else if (chromeDeveloperModeEnabled() === false) {
			// An unpacked (Load-unpacked) extension only runs while Chrome's
			// Developer Mode is ON. If it's off, the extension is loaded but inert,
			// so it never connects — surface that specific, common cause.
			detail =
				"Chrome extension is not connected — Chrome Developer Mode appears to be OFF, so the unpacked xcsh extension won't run. Enable it: chrome://extensions → toggle 'Developer mode' (top-right), then reload the extension.";
		} else {
			detail =
				"Chrome extension is not connected — ensure it's loaded/enabled, Chrome is running, and `xcsh chrome setup` has run.";
		}
		return {
			debuggableNow: false,
			chromeRunning: false,
			chromeInstalled: false,
			plannedAction: "no-chrome",
			detail,
			extensionConnected,
		};
	}
}

/**
 * Best-effort read of whether Chrome's Developer Mode is enabled, from the
 * profile Preferences (`extensions.ui.developer_mode`). Unpacked extensions
 * require Developer Mode to actually run. Returns null if it can't be read.
 */
export function chromeDeveloperModeEnabled(): boolean | null {
	const candidates =
		process.platform === "darwin"
			? [
					"Library/Application Support/Google/Chrome/Default/Preferences",
					"Library/Application Support/Google/Chrome/Profile 1/Preferences",
				]
			: process.platform === "win32"
				? ["AppData/Local/Google/Chrome/User Data/Default/Preferences"]
				: [".config/google-chrome/Default/Preferences"];
	for (const rel of candidates) {
		try {
			const fs = require("node:fs") as typeof import("node:fs");
			const os = require("node:os") as typeof import("node:os");
			const p = `${os.homedir()}/${rel}`;
			if (!fs.existsSync(p)) continue;
			const prefs = JSON.parse(fs.readFileSync(p, "utf8"));
			return prefs?.extensions?.ui?.developer_mode === true;
		} catch {
			/* try next candidate */
		}
	}
	return null;
}
