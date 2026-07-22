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
import { homedir } from "node:os";
import { join } from "node:path";
import { getProjectDir, getXCSHConfigDir, logger } from "@f5-sales-demo/pi-utils";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { LOCALIP_HOST, resolveBridgeTls } from "../browser/bridge-cert";
import { ChatHandler } from "../browser/chat-handler";
import { startBridgeServer } from "../browser/extension-bridge";
import {
	BROWSER_TOOL_NAMES,
	createExtensionBridgeTools,
	EXTENSION_AGENT_TOOL_NAMES,
} from "../browser/extension-bridge-tools";
import { setSharedBridgeServer } from "../browser/provider";
import { coldStartSpans, type SpanFrame, sessionBuildSpan } from "../browser/ttft-spans";
import { initializeWithSettings } from "../discovery";
import { createAgentSession } from "../sdk";
import { activateTenantContext } from "../services/session-context-binding";
import { ContextService } from "../services/xcsh-context";
import { deriveTenantEnv } from "../services/xcsh-env";
import { type KeepaliveTransport, ManagerKeepalive } from "./manager-keepalive";

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

/** Hard ceiling for draining an in-flight chat turn on SIGTERM before teardown (#1874). */
const WORKER_DRAIN_TIMEOUT_MS = 10_000;

/** How often the worker pings the manager while a turn is in flight, refreshing its
 * lastSeen so an actively-chatting session is never idle-reaped. Comfortably under
 * the manager's IDLE_MS (20 min); a turn also pings once at its start. */
const KEEPALIVE_MS = 60_000;

/** The manager control socket (same derivation as native-host / chrome-cli). */
function managerSockPath(): string {
	return process.env.XCSH_MANAGER_SOCK ?? join(homedir(), ".xcsh", "manager.sock");
}

/** Browser-automation tool set — identical scoping to `main.ts`'s extension path.
 * With scoped tools the ONLY way to create a resource is the form-driven workflow
 * runner, which is exactly what the human watching the browser wants. */
export default class Worker extends Command {
	static description = "Run a headless extension-bridge worker (no TUI); blocks until SIGTERM";

	async run(): Promise<void> {
		// Record the per-tab session-boot timeline (parity with main.ts:runRootCommand).
		// Spans only accumulate while recording; nothing prints unless PI_TIMING is set,
		// and each logger.time() returns its wrapped value unchanged — so a normal
		// `xcsh worker` run is behaviorally identical to before.
		// TTFT Phase 2: the manager stamps XCSH_TTFT_SPAWN_AT at Bun.spawn for a cold
		// spawn; worker_boot(cold) = bridge-listening instant - spawn instant (captures
		// fork + runtime init, which logger.startTiming below misses).
		const spawnAtEnv = Number(process.env.XCSH_TTFT_SPAWN_AT);
		const coldSpawn = process.env.XCSH_TTFT_COLD === "1";
		const managerProvisionMsEnv = Number(process.env.XCSH_TTFT_PROVISION_MS);
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

		// Provision the wss cert BEFORE the session:bridgeListen span — its only
		// network path (a cold/stale-cache fetch) must NOT inflate the measured
		// bridge-ready time; a warm boot is a fast on-disk cache hit. `undefined`
		// (offline / local-ip.sh unreachable) → the bridge starts ws-only (no crash).
		const tls = await resolveBridgeTls();

		// INSTANT-ON: start the bridge before the heavy session init so the extension
		// can connect immediately. Honors XCSH_BRIDGE_PORT (forced) or auto-selects.
		// session:bridgeListen — time-to-"bridge-ready": the extension can connect and
		// complete the hello/hello_ack handshake once this resolves (INSTANT-ON path).
		const bridge = await logger.time("session:bridgeListen", () =>
			startBridgeServer(undefined, tls ? { tls } : undefined),
		);
		console.error(
			`[xcsh worker] extension bridge listening on ws://127.0.0.1:${bridge.port}` +
				(bridge.wssPort ? ` + wss://${LOCALIP_HOST}:${bridge.wssPort}` : ""),
		);
		setSharedBridgeServer(bridge);
		bridge.setSessionInfo(sessionInfoForWorker);
		ContextService.onContextChange(() => bridge.broadcastTenantChanged());

		// TTFT Phase 2: buffer the per-session cold-start spans and flush them once a
		// client is actually connected. bridge.send() silently no-ops with no client, so
		// the flush is gated on `clientConnected` — a cold-boot flush before the extension
		// connects would otherwise burn the once-latch and lose the spans. Cold path is
		// populated now (env); warm path by the {bind} handler below.
		let coldStartBuffer: SpanFrame[] = [];
		let coldStartSent = false;
		let clientConnected = false;
		const flushColdStart = (): void => {
			if (coldStartSent || !clientConnected || coldStartBuffer.length === 0) return;
			for (const s of coldStartBuffer) bridge.send(s);
			coldStartSent = true;
		};
		// TTFT: the session_build span (createAgentSession seam) is computed after the
		// bridge is listening but possibly before the extension connects — buffer it and
		// flush on connect, same as the cold-start spans.
		let sessionBuildFrame: SpanFrame | null = null;
		let sessionBuildSent = false;
		const flushSessionBuild = (): void => {
			if (sessionBuildSent || !clientConnected || !sessionBuildFrame) return;
			bridge.send(sessionBuildFrame);
			sessionBuildSent = true;
		};
		// onConnected (raw WS open) is the deliberate flush trigger: no hello hook is exposed
		// today, and the bridge's origin check already gates opens to the extension.
		bridge.onConnected(() => {
			clientConnected = true;
			flushColdStart();
			flushSessionBuild();
		});

		if (coldSpawn && process.env.XCSH_SESSION_ID && Number.isFinite(spawnAtEnv)) {
			const workerBootMs = Date.now() - spawnAtEnv; // spawn -> bridge listening
			const mgrMs = Number.isFinite(managerProvisionMsEnv) ? managerProvisionMsEnv : 0;
			coldStartBuffer = coldStartSpans(process.env.XCSH_SESSION_ID, true, mgrMs, workerBootMs);
			// No flush here: at cold boot the extension has not connected yet; onConnected flushes.
		}

		// Pre-warm pool late-bind: the manager (our parent) sends {bind} over Bun IPC to adopt
		// this spare for a tab. Apply the identity, activate the tenant's context LIVE, then
		// re-announce via broadcastTenantChanged (now carrying the real sessionId).
		process.on("message", (raw: unknown) => {
			const m = raw as {
				type?: unknown;
				sessionId?: unknown;
				tenant?: unknown;
				provisionMs?: unknown;
				cold?: unknown;
			};
			if (m?.type !== "bind" || typeof m.sessionId !== "string" || typeof m.tenant !== "string") return;
			// Capture the narrowed values — TS widens `m.*` back to `unknown` inside the async closure.
			const sessionId = m.sessionId;
			const tenant = m.tenant;
			const bindAt = Date.now(); // TTFT Phase 2: start of warm worker_boot (bind -> bound)
			const relayedProvisionMs = typeof m.provisionMs === "number" ? m.provisionMs : 0;
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
				// TTFT Phase 2: warm adopt cold-start spans (worker_boot = bind -> bound).
				coldStartBuffer = coldStartSpans(sessionId, false, relayedProvisionMs, Date.now() - bindAt);
				flushColdStart();
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
		const sessionBuildStart = Date.now();
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
			// TTFT Phase 3: load the hermetic bench stand-in provider when the benchmark
			// sets XCSH_BENCH_EXTENSION (absolute path). Inert for normal workers.
			...(process.env.XCSH_BENCH_EXTENSION ? { additionalExtensionPaths: [process.env.XCSH_BENCH_EXTENSION] } : {}),
		});
		// TTFT: emit the session_build stage (createAgentSession seam) as a WS span so the
		// bench and diagnostics panel stop hiding plugin/discovery/registry-load cost inside
		// total ttft_ms. Buffered + flushed on connect (parity with cold-start spans).
		sessionBuildFrame = sessionBuildSpan(
			process.env.XCSH_SESSION_ID ?? "",
			coldSpawn,
			Date.now() - sessionBuildStart,
		);
		flushSessionBuild();

		// TTFT Phase 3 hermeticity: the bench-instant stand-in provider is registered while
		// createAgentSession loads the bench extension (additionalExtensionPaths), which is
		// AFTER the default-model role is resolved — so the worker would otherwise fall back
		// to a real provider and the benchmark would measure live network TTFT, not xcsh
		// overhead. In bench mode, explicitly select bench-instant now that it is registered.
		// Gated on XCSH_BENCH_EXTENSION → completely inert for a normal `xcsh worker`.
		if (process.env.XCSH_BENCH_EXTENSION) {
			const benchModel = session.modelRegistry.find("bench-instant", "bench-instant");
			if (benchModel) {
				await session.setModel(benchModel);
			} else {
				console.error(
					"[xcsh worker] BENCH ERROR: bench-instant model not registered — benchmark would measure a real provider",
				);
			}
		}

		const chatHandler = new ChatHandler(bridge, session);
		chatHandler.attach();

		// Manager keepalive: while a turn is in flight (and at each turn start), ping
		// the manager control socket so it refreshes this worker's lastSeen and its
		// idle sweep does not reap an actively-used session mid-conversation. Chat
		// traffic never reaches the manager, so this is the only liveness signal.
		// Best-effort + self-reconnecting: a dropped socket (e.g. manager supersede)
		// is re-opened on the next emit, re-targeting the successor manager.
		const keepalive = new ManagerKeepalive({
			sessionId: () => sessionInfoForWorker().sessionId ?? "spare",
			busy: () => chatHandler.busy,
			connect: async onClose => {
				try {
					const sock = await Bun.connect({
						unix: managerSockPath(),
						socket: { data() {}, close: () => onClose(), error: () => onClose() },
					});
					const transport: KeepaliveTransport = {
						write: data => {
							sock.write(data);
						},
						close: () => {
							sock.end();
						},
					};
					return transport;
				} catch {
					return null; // manager not reachable — a later emit retries
				}
			},
		});
		chatHandler.onTurnStart(() => keepalive.turnStart());
		const keepaliveTimer = setInterval(() => keepalive.tick(), KEEPALIVE_MS);

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
		const teardown = () => {
			clearInterval(keepaliveTimer);
			keepalive.stop();
			chatHandler.dispose();
			void bridge.close().finally(() => process.exit(0));
		};
		const shutdown = () => {
			if (shuttingDown) return;
			shuttingDown = true;
			// Bounded drain (#1874): if a chat turn is in flight (e.g. the manager is
			// recycling for an upgrade), let it finish before teardown instead of
			// aborting the running agent turn — with a hard ceiling so a hung turn can
			// never wedge shutdown. An idle worker tears down immediately.
			if (!chatHandler.busy) return teardown();
			const deadline = Date.now() + WORKER_DRAIN_TIMEOUT_MS;
			const tick = () => {
				if (!chatHandler.busy || Date.now() >= deadline) teardown();
				else setTimeout(tick, 100);
			};
			tick();
		};
		process.on("SIGTERM", shutdown);
		process.on("SIGINT", shutdown);

		// Block until a signal tears us down.
		await new Promise<never>(() => {});
	}
}
