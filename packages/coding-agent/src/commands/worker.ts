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
import { getProjectDir, getXCSHConfigDir, logger } from "@f5-sales-demo/pi-utils";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { ChatHandler } from "../browser/chat-handler";
import { startBridgeServer } from "../browser/extension-bridge";
import { createExtensionBridgeTools, EXTENSION_AGENT_TOOL_NAMES } from "../browser/extension-bridge-tools";
import { setSharedBridgeServer } from "../browser/provider";
import { initializeWithSettings } from "../discovery";
import { createAgentSession } from "../sdk";
import { activateTenantContext } from "../services/session-context-binding";
import { ContextService } from "../services/xcsh-context";
import { deriveTenantEnv } from "../services/xcsh-env";

/** Mutable worker identity. Seeded from env at spawn (backward compat); replaced by a
 * late IPC bind on a pre-warmed spare. `null` fields fall back to env, then the "spare"
 * sentinel (a non-`tab-<id>` string the extension registers but never binds to a tab). */
let boundIdentity: { sessionId: string; tenantKey: string } | null = null;

export function setWorkerIdentity(sessionId: string, tenantKey: string): void {
	boundIdentity = { sessionId, tenantKey };
}
/** Test-only: clear late-bind state so env-seeded cases are deterministic. */
export function resetWorkerIdentity(): void {
	boundIdentity = null;
}

/** Tenant identity for the `hello` handshake. The active context wins; when the
 * worker is contextless we parse the bound tenant (or `XCSH_SESSION_TENANT`,
 * `tenant|env`) so the panel still learns which tenant this process serves (apiUrl
 * stays null). Must be sync — the bridge invokes it synchronously while answering
 * `hello`. */
export function sessionInfoForWorker(): {
	tenant: string | null;
	env: string | null;
	apiUrl: string | null;
	contextBound: boolean;
	sessionId: string | null;
} {
	// The tab session key this worker serves; echoed in hello_ack so the extension can
	// correlate a discovered worker back to a provisioned tab. A late IPC bind wins over
	// the spawn env; an unbound spare advertises the "spare" sentinel.
	const sessionId = boundIdentity?.sessionId ?? process.env.XCSH_SESSION_ID ?? "spare";
	let apiUrl: string | null = null;
	let contextBound = false;
	try {
		apiUrl = ContextService.instance.activeApiUrl;
		// A worker is "context-bound" when it has an active stored context (not just an env-derived apiUrl).
		contextBound = ContextService.instance.getStatus().activeContextName != null;
	} catch {
		/* ContextService not initialized — fall through to the tenant key; contextBound stays false. */
	}
	apiUrl = apiUrl ?? process.env.XCSH_API_URL ?? null;
	// Prefer the apiUrl-derived key (active context wins), but fall back to the
	// tenant this worker was assigned (IPC bind or spawn env) so an apiUrl whose
	// host we can't parse never blanks a KNOWN tenant — which would make the
	// extension drop the bridge and show "No xcsh running for this tenant" (#1872).
	const tenantKey = boundIdentity?.tenantKey ?? process.env.XCSH_SESSION_TENANT ?? null;
	const { tenant, env } = deriveTenantEnv(apiUrl, tenantKey);
	return { tenant, env, apiUrl, contextBound, sessionId };
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
		// Record the per-tab session-boot timeline (parity with main.ts:runRootCommand).
		// Spans only accumulate while recording; nothing prints unless PI_TIMING is set,
		// and each logger.time() returns its wrapped value unchanged — so a normal
		// `xcsh worker` run is behaviorally identical to before.
		logger.startTiming();

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
		// session:bridgeListen — time-to-"bridge-ready": the extension can connect and
		// complete the hello/hello_ack handshake once this resolves (INSTANT-ON path).
		const bridge = await logger.time("session:bridgeListen", startBridgeServer);
		console.error(`[xcsh worker] extension bridge listening on ws://127.0.0.1:${bridge.port}`);
		setSharedBridgeServer(bridge);
		bridge.setSessionInfo(sessionInfoForWorker);
		ContextService.onContextChange(() => bridge.broadcastTenantChanged());

		// Pre-warm pool late-bind: the manager (our parent) sends {bind} over Bun IPC to adopt
		// this spare for a tab. Apply the identity, activate the tenant's context LIVE, then
		// re-announce via broadcastTenantChanged (now carrying the real sessionId).
		process.on("message", (raw: unknown) => {
			const m = raw as { type?: unknown; sessionId?: unknown; tenant?: unknown };
			if (m?.type !== "bind" || typeof m.sessionId !== "string" || typeof m.tenant !== "string") return;
			// Capture the narrowed values — TS widens `m.*` back to `unknown` inside the async closure.
			const sessionId = m.sessionId;
			const tenant = m.tenant;
			setWorkerIdentity(sessionId, tenant);
			void (async () => {
				try {
					await activateTenantContext(tenant);
				} catch (err) {
					console.error(`[xcsh worker] late tenant-bind failed: ${String(err)}`);
				}
				bridge.broadcastTenantChanged();
				// Ack adoption complete (identity applied + context activated + re-announced).
				// The manager ignores it today; the bench uses it to time adoption latency.
				process.send?.({ type: "bound", sessionId });
			})();
		});

		// The extension's browser actions (navigate/click/read_ax/…) are not builtin
		// tools — turn each into a bridge-proxying CustomTool so the agent can drive
		// the browser (without this the agent only has catalog_workflow_runner and
		// merely narrates "Navigating…"). Include their names in the tool scope.
		const extensionTools = createExtensionBridgeTools(bridge);
		// session:createAgentSession — the heavy step between bridge-ready and
		// session-ready (model registry, tools, context bootstrap). Wrapped as a span
		// (parity with main.ts:892) so PI_TIMING reveals the per-tab session-load split.
		const { session } = await logger.time("session:createAgentSession", createAgentSession, {
			cwd,
			hasUI: false,
			toolNames: [...new Set([...BROWSER_TOOL_NAMES, ...EXTENSION_AGENT_TOOL_NAMES])],
			customTools: extensionTools,
			// Headless worker: no MCP discovery, no LSP warmup, no extension discovery —
			// keep startup lean and free of network calls / blocking prompts.
			enableMCP: false,
			enableLsp: false,
			disableExtensionDiscovery: true,
		});

		const chatHandler = new ChatHandler(bridge, session);
		chatHandler.attach();

		// session-ready. Emit the per-tab boot breakdown when requested (parity with
		// main.ts:1002-1009). PI_TIMING=x prints then exits — used by bench/extension-session.ts
		// to measure total worker cold-start; otherwise this is a no-op.
		if (process.env.PI_TIMING) {
			logger.printTimings();
			if (process.env.PI_TIMING === "x") {
				process.exit(0);
			}
		}
		logger.endTiming();

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
