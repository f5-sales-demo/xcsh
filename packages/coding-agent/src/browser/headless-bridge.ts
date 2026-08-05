/**
 * Headless chat bridge — the no-TUI extension-bridge host used by `xcsh office
 * serve` so one command yields a working task pane (pane files + a live chat/
 * host-tool bridge). It mirrors the proven `xcsh worker` bootstrap
 * (`commands/worker.ts`) MINUS the fleet concerns (manager keepalive, pre-warm
 * IPC bind, TTFT spans): set the browser-provider env, init Settings + Context,
 * quiet startup, provision the wss cert, start the bridge, publish session info,
 * create ONE agent session scoped to the browser tools, and attach the
 * `ChatHandler`. Office document tools (Excel/Word/PPT) are advertised by the
 * pane at runtime over the bridge (`set_host_tools`), so they need no scoping here.
 *
 * The heavy / socket / network calls are injected (defaulting to the real ones)
 * so the wiring is unit-testable without opening real listeners or a session.
 *
 * NOT browser-safe (node/bun): runs inside the full xcsh binary, never the pane.
 */
import { getProjectDir, getXCSHConfigDir } from "@f5-sales-demo/pi-utils";
import { createAgentSession } from "../sdk";
import { ContextService } from "../services/xcsh-context";
import { deriveTenantEnv } from "../services/xcsh-env";
import { SessionManager } from "../session/session-manager";
import { resolveBridgeTls } from "./bridge-cert";
import { ChatHandler } from "./chat-handler";
import { isPickPath, type PathPicked } from "./chat-protocol";
import { type BridgeServer, OFFICE_PORT_RANGE, startBridgeServer } from "./extension-bridge";
import { OFFICE_TOOL_NAMES } from "./extension-bridge-tools";
import { pickPathNative } from "./native-picker";
import { setSharedBridgeServer } from "./provider";

/** A running headless bridge + a teardown that disposes the chat handler and
 *  closes the bridge (both ws + wss listeners). */
export interface HeadlessChatBridge {
	bridge: BridgeServer;
	dispose: () => Promise<void>;
}

/**
 * Tenant identity for the `hello` handshake, contextless-friendly: the active
 * `/context` wins (its apiUrl + name), otherwise fall back to the `XCSH_API_URL`/
 * `XCSH_SESSION_TENANT` env so the pane still learns which tenant this process
 * serves. Sync — the bridge calls it while answering `hello`. Mirrors the
 * interactive path in `main.ts` (there is no per-tab session id here).
 */
export function sessionInfoForOfficeServe(): {
	tenant: string | null;
	env: string | null;
	apiUrl: string | null;
	contextBound: boolean;
	sessionId: string | null;
} {
	let apiUrl: string | null = null;
	let contextBound = false;
	try {
		apiUrl = ContextService.instance.activeApiUrl;
		contextBound = ContextService.instance.getStatus().activeContextName != null;
	} catch {
		/* ContextService not initialized — env-only mode. */
	}
	apiUrl = apiUrl ?? process.env.XCSH_API_URL ?? null;
	const tenantKey = process.env.XCSH_SESSION_TENANT ?? null;
	const { tenant, env } = deriveTenantEnv(apiUrl, tenantKey);
	return { tenant, env, apiUrl, contextBound, sessionId: null };
}

/** Injectable seams (defaulted to the real ones) so the bootstrap is testable. */
export interface HeadlessBridgeDeps {
	/** Set the browser-provider env, init Settings + ContextService + provider
	 *  persistence, and quiet startup; returns the project cwd for the session. */
	initEnv: () => Promise<{ cwd: string }>;
	resolveBridgeTls: typeof resolveBridgeTls;
	startBridgeServer: typeof startBridgeServer;
	setSharedBridgeServer: typeof setSharedBridgeServer;
	createAgentSession: typeof createAgentSession;
	ChatHandlerCtor: typeof ChatHandler;
	/** Native OS file/folder picker (macOS osascript by default). Injectable so tests
	 *  don't open a real dialog. */
	pickPath: typeof pickPathNative;
}

const defaultDeps: HeadlessBridgeDeps = {
	initEnv: async () => {
		process.env.XCSH_BROWSER_PROVIDER = "extension";
		const cwd = getProjectDir();
		const { Settings, settings } = await import("../config/settings");
		await Settings.init({ cwd });
		// Init the ContextService singleton so sessionInfoForOfficeServe can read the
		// active apiUrl once a /context is bound.
		try {
			ContextService.init(getXCSHConfigDir());
		} catch {
			/* already initialized / unavailable — continue. */
		}
		// Provider persistence for model discovery (parity with main.ts / worker.ts).
		const { initializeWithSettings } = await import("../discovery");
		initializeWithSettings(settings);
		// Quiet startup: skip the welcome screen + blocking plugin "Fix now?" prompts.
		settings.override("startup.quiet", true);
		return { cwd };
	},
	resolveBridgeTls,
	startBridgeServer,
	setSharedBridgeServer,
	createAgentSession,
	ChatHandlerCtor: ChatHandler,
	pickPath: pickPathNative,
};

/**
 * Start the headless chat bridge and return it with a teardown. Fully awaits the
 * session + ChatHandler.attach() before resolving, so once this resolves the pane
 * can connect and chat immediately (no warm-up race). A `configure`-less pane
 * chats over xcsh's already-configured provider.
 */
export async function startHeadlessChatBridge(deps: HeadlessBridgeDeps = defaultDeps): Promise<HeadlessChatBridge> {
	const { cwd } = await deps.initEnv();

	// Provision the wss cert before binding (warm boot = on-disk cache hit);
	// `undefined` (offline) → the bridge starts ws-only.
	const tls = await deps.resolveBridgeTls();
	// Office-serve binds the DEDICATED office range (disjoint from the Chrome worker
	// range) so the two can never collide on a port.
	const bridge = await deps.startBridgeServer(undefined, {
		serveKind: "office",
		sessionInfo: sessionInfoForOfficeServe,
		...(tls ? { tls } : {}),
		range: OFFICE_PORT_RANGE,
	});
	// Reuse this bridge for any in-process selectProvider() (no conflicting second bridge).
	deps.setSharedBridgeServer(bridge);
	// Re-announce the tenant when the active context changes (best-effort).
	try {
		ContextService.onContextChange(() => bridge.broadcastTenantChanged());
	} catch {
		/* ContextService not initialized (tests) — the tenant is static. */
	}

	// Everything past the bind can throw (createAgentSession on a misconfigured
	// provider, etc.). If it does, close the already-bound bridge and clear the
	// shared-bridge global before rethrowing — otherwise the ws/wss listeners leak
	// (keeping the event loop alive so Ctrl+C can't exit) and a later in-process
	// selectProvider() reuses a dead bridge. The caller (startOfficeServe) treats
	// the rethrow as a non-fatal "pane only" fallback.
	try {
		// Create ONE headless Office session with the full CLI-parity builtin set
		// (OFFICE_TOOL_NAMES: bash/read/write/edit/grep/inspect_image/… — NO browser tools, which
		// would be hallucinated in a document task pane). The document's own tools
		// (Excel/Word/PowerPoint) arrive at runtime via set_host_tools.
		const { session } = await deps.createAgentSession({
			cwd,
			hasUI: false,
			// Office conversations can contain private workbook and working-directory
			// data. Keep the entire headless session ephemeral instead of inheriting
			// createAgentSession's file-backed default.
			sessionManager: SessionManager.inMemory(cwd),
			toolNames: [...OFFICE_TOOL_NAMES],
			customTools: [],
			// Headless: no MCP/LSP/extension discovery — lean, no network/blocking prompts.
			enableMCP: false,
			enableLsp: false,
			disableExtensionDiscovery: true,
			// …but DO load the bundled filesystem sandbox: the pane runs full CLI-parity
			// tools (bash/read/write), so it needs the CLI's safety net confining file
			// tools + the shell's cwd to the launch directory subtree (sandbox.enabled
			// defaults true). Without this, a discovery-disabled session ran ungated.
			bundledExtensions: ["sandbox-guard"],
		});

		const chatHandler = new deps.ChatHandlerCtor(bridge, session);
		chatHandler.attach();

		// Second bridge subscriber (the bridge fans out to all): serve `pick_path` by
		// opening a native OS picker and replying `path_picked`. Pure — it only returns
		// the chosen path; the sandbox grant + prompt note happen in ChatHandler when the
		// path rides the next `chat_request.contextPaths` (kept atomic there). `disposed`
		// guards against a superseded serve firing the picker on a closed bridge.
		let disposed = false;
		bridge.onMessage(async msg => {
			if (disposed || !isPickPath(msg)) return;
			const { path, canceled, unsupported } = await deps.pickPath((msg as { mode: "file" | "folder" }).mode);
			if (disposed) return;
			bridge.send({ type: "path_picked", path, canceled, unsupported } satisfies PathPicked);
		});

		return {
			bridge,
			dispose: async () => {
				disposed = true;
				chatHandler.dispose();
				deps.setSharedBridgeServer(null);
				await bridge.close();
			},
		};
	} catch (err) {
		deps.setSharedBridgeServer(null);
		await bridge.close();
		throw err;
	}
}
