/**
 * Headless worker mode — `xcsh worker`.
 *
 * A non-interactive process that starts the Chrome-extension bridge, creates ONE
 * agent session bound to this worker's tenant (`XCSH_SESSION_TENANT`, matched to a
 * context by the session-context bootstrap in `createAgentSession`), attaches the
 * chat handler, and blocks until SIGTERM/SIGINT. It mirrors the extension-bridge
 * startup path in `main.ts` (bridge → setSessionInfo → browser-only tool scoping →
 * createAgentSession → ChatHandler.attach) MINUS the TUI.
 *
 * Unlike the interactive path — whose `hello_ack` tenant is derived purely from the
 * active context's apiUrl (null when contextless) — the worker also falls back to
 * `XCSH_SESSION_TENANT` so it advertises its assigned tenant even before a context
 * is bound. This lets the extension panel lock onto the right tenant immediately.
 */
import { getProjectDir, getXCSHConfigDir } from "@f5-sales-demo/pi-utils";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { ChatHandler } from "../browser/chat-handler";
import { startBridgeServer } from "../browser/extension-bridge";
import { setSharedBridgeServer } from "../browser/provider";
import { initializeWithSettings } from "../discovery";
import { createAgentSession } from "../sdk";
import { ContextService } from "../services/xcsh-context";
import { sessionKeyFromUrl } from "../services/xcsh-env";

/** Tenant identity for the `hello` handshake. The active context wins; when the
 * worker is contextless we parse `XCSH_SESSION_TENANT` (`tenant|env`) so the panel
 * still learns which tenant this process serves (apiUrl stays null). Must be sync —
 * the bridge invokes it synchronously while answering `hello`. */
export function sessionInfoForWorker(): {
	tenant: string | null;
	env: string | null;
	apiUrl: string | null;
	contextBound: boolean;
} {
	let apiUrl: string | null = null;
	let contextBound = false;
	try {
		apiUrl = ContextService.instance.activeApiUrl;
		// A worker is "context-bound" when it has an active stored context (not just an env-derived apiUrl).
		contextBound = ContextService.instance.getStatus().activeContextName != null;
	} catch {
		/* ContextService not initialized — fall through to env; contextBound stays false. */
	}
	apiUrl = apiUrl ?? process.env.XCSH_API_URL ?? null;
	if (apiUrl) {
		const key = sessionKeyFromUrl(apiUrl);
		return { tenant: key?.tenant ?? null, env: key?.env ?? null, apiUrl, contextBound };
	}
	// Contextless: the worker's assigned tenant is carried in XCSH_SESSION_TENANT.
	const raw = process.env.XCSH_SESSION_TENANT;
	if (raw) {
		const [tenant, env] = raw.split("|");
		return { tenant: tenant || null, env: env || null, apiUrl: null, contextBound };
	}
	return { tenant: null, env: null, apiUrl: null, contextBound };
}

/** Browser-automation tool set — identical scoping to `main.ts`'s extension path.
 * With scoped tools the ONLY way to create a resource is the form-driven workflow
 * runner, which is exactly what the human watching the browser wants. */
const BROWSER_TOOL_NAMES = [
	"catalog_workflow_runner",
	"navigate",
	"click",
	"click_element",
	"fill",
	"type_text",
	"screenshot",
	"login",
	"read_ax",
	"get_page_context",
	"query_dom",
	"find",
	"wait_for",
	"key_press",
	"select_option",
	"label_select",
	"scroll_to",
	"annotate",
	"set_explain_mode",
];

export default class Worker extends Command {
	static description = "Run a headless extension-bridge worker (no TUI); blocks until SIGTERM";

	async run(): Promise<void> {
		process.env.XCSH_BROWSER_PROVIDER = "extension";

		const cwd = getProjectDir();
		const { Settings, settings } = await import("../config/settings");
		await Settings.init({ cwd });

		// Init the ContextService singleton so the session-context bootstrap (Task 3)
		// can match XCSH_SESSION_TENANT to a stored context, and so sessionInfoForWorker
		// can read the active apiUrl once bound.
		try {
			ContextService.init(getXCSHConfigDir());
		} catch {
			/* already initialized / unavailable — continue. */
		}

		// Provider persistence for model discovery (parity with main.ts).
		initializeWithSettings(settings);

		// Quiet startup: skip the welcome screen + blocking plugin "Fix now?" prompts.
		settings.override("startup.quiet", true);

		// INSTANT-ON: start the bridge before the heavy session init so the extension
		// can connect immediately. Honors XCSH_BRIDGE_PORT (forced) or auto-selects.
		const bridge = await startBridgeServer();
		console.error(`[xcsh worker] extension bridge listening on ws://127.0.0.1:${bridge.port}`);
		setSharedBridgeServer(bridge);
		bridge.setSessionInfo(sessionInfoForWorker);
		ContextService.onContextChange(() => bridge.broadcastTenantChanged());

		const { session } = await createAgentSession({
			cwd,
			hasUI: false,
			toolNames: BROWSER_TOOL_NAMES,
			// Headless worker: no MCP discovery, no LSP warmup, no extension discovery —
			// keep startup lean and free of network calls / blocking prompts.
			enableMCP: false,
			enableLsp: false,
			disableExtensionDiscovery: true,
		});

		const chatHandler = new ChatHandler(bridge, session);
		chatHandler.attach();

		let shuttingDown = false;
		const shutdown = () => {
			if (shuttingDown) return;
			shuttingDown = true;
			chatHandler.dispose();
			void bridge.close().finally(() => process.exit(0));
		};
		process.on("SIGTERM", shutdown);
		process.on("SIGINT", shutdown);

		// Block until a signal tears us down.
		await new Promise<never>(() => {});
	}
}
