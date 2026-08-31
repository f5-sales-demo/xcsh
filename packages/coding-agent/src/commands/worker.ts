/**
 * Headless worker mode — `xcsh worker`.
 *
 * A non-interactive process that starts the Chrome-extension bridge, creates ONE
 * agent session bound to this worker's tenant (`XCSH_SESSION_TENANT`, matched to a
 * context by the session-context bootstrap in `createAgentSession`), attaches the
 * chat handler, and blocks until SIGTERM/SIGINT. It mirrors the extension-bridge
 * startup path in `main.ts` (configured bridge → browser-only tool scoping →
 * createAgentSession → ChatHandler.attach) MINUS the TUI.
 *
 * Unlike the interactive path — whose `hello_ack` tenant is derived purely from the
 * active context's apiUrl (null when contextless) — the worker also falls back to
 * `XCSH_SESSION_TENANT` so it advertises its assigned tenant even before a context
 * is bound. This lets the extension panel lock onto the right tenant immediately.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "@f5-sales-demo/pi-utils";
import { Command } from "@f5-sales-demo/pi-utils/cli";
import { LOCALIP_HOST } from "../browser/bridge-cert";
import { startHeadlessChatBridge } from "../browser/headless-bridge";
import { coldStartSpans, type SpanFrame, sessionBuildSpan } from "../browser/ttft-spans";
import { activateTenantContext } from "../services/session-context-binding";
import { ContextService } from "../services/xcsh-context";
import { deriveTenantEnv } from "../services/xcsh-env";
import { type KeepaliveTransport, ManagerKeepalive } from "./manager-keepalive";

/** Mutable worker identity. Cold workers receive it in their spawn environment; a
 * pre-warmed spare receives it through the manager bind. Until then the "spare"
 * sentinel is registered but never bound to a tab. */
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
		const spawnAtEnv = Number(process.env.XCSH_TTFT_SPAWN_AT);
		const coldSpawn = process.env.XCSH_TTFT_COLD === "1";
		const managerProvisionMsEnv = Number(process.env.XCSH_TTFT_PROVISION_MS);
		logger.startTiming();

		let coldStartBuffer: SpanFrame[] = [];
		let coldStartSent = false;
		let clientConnected = false;
		let sessionBuildFrame: SpanFrame | null = null;
		let sessionBuildSent = false;
		let sessionBuildStart = 0;

		const running = await startHeadlessChatBridge(undefined, {
			kind: "worker",
			sessionInfo: sessionInfoForWorker,
			afterBridgeBind: ({ bridge }) => {
				console.error(
					`[xcsh worker] extension bridge listening on ws://127.0.0.1:${bridge.port}` +
						(bridge.wssPort ? ` + wss://${LOCALIP_HOST}:${bridge.wssPort}` : ""),
				);
				if (process.connected) {
					process.send?.({ type: "ready", sessionId: sessionInfoForWorker().sessionId });
				}

				const flushColdStart = (): void => {
					if (coldStartSent || !clientConnected || coldStartBuffer.length === 0) return;
					for (const span of coldStartBuffer) bridge.send(span);
					coldStartSent = true;
				};
				const flushSessionBuild = (): void => {
					if (sessionBuildSent || !clientConnected || !sessionBuildFrame) return;
					bridge.send(sessionBuildFrame);
					sessionBuildSent = true;
				};

				bridge.onConnected(() => {
					clientConnected = true;
					flushColdStart();
					flushSessionBuild();
				});

				if (coldSpawn && process.env.XCSH_SESSION_ID && Number.isFinite(spawnAtEnv)) {
					const workerBootMs = Date.now() - spawnAtEnv;
					const managerMs = Number.isFinite(managerProvisionMsEnv) ? managerProvisionMsEnv : 0;
					coldStartBuffer = coldStartSpans(process.env.XCSH_SESSION_ID, true, managerMs, workerBootMs);
				}

				process.on("message", (raw: unknown) => {
					const message = raw as {
						type?: unknown;
						sessionId?: unknown;
						tenant?: unknown;
						provisionMs?: unknown;
						cold?: unknown;
					};
					if (
						message?.type !== "bind" ||
						typeof message.sessionId !== "string" ||
						typeof message.tenant !== "string"
					)
						return;
					const sessionId = message.sessionId;
					const tenant = message.tenant;
					const bindAt = Date.now();
					const relayedProvisionMs = typeof message.provisionMs === "number" ? message.provisionMs : 0;
					setWorkerIdentity(sessionId, tenant);
					void (async () => {
						try {
							await activateTenantContext(tenant);
						} catch {
							console.error("[xcsh worker] late tenant-bind failed");
						}
						bridge.broadcastTenantChanged();
						if (process.connected) process.send?.({ type: "bound", sessionId });
						coldStartBuffer = coldStartSpans(sessionId, false, relayedProvisionMs, Date.now() - bindAt);
						flushColdStart();
					})();
				});

				// The shared bootstrap creates the session immediately after this hook.
				sessionBuildStart = Date.now();
			},
			afterSessionCreate: async ({ bridge, session }) => {
				sessionBuildFrame = sessionBuildSpan(
					process.env.XCSH_SESSION_ID ?? "",
					coldSpawn,
					Date.now() - sessionBuildStart,
				);
				if (clientConnected && !sessionBuildSent) {
					bridge.send(sessionBuildFrame);
					sessionBuildSent = true;
				}

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
			},
		});
		const { handler: chatHandler } = running;

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
					return null;
				}
			},
		});
		chatHandler.onTurnStart(() => keepalive.turnStart());
		const keepaliveTimer = setInterval(() => keepalive.tick(), KEEPALIVE_MS);

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
			void running.dispose().finally(() => process.exit(0));
		};
		const shutdown = () => {
			if (shuttingDown) return;
			shuttingDown = true;
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

		await Promise.withResolvers<never>().promise;
	}
}
