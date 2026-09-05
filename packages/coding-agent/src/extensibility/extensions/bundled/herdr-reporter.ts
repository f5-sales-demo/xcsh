import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, UserPromptKind } from "@f5-sales-demo/xcsh";
import { HerdrClient } from "../../../herdr/client";

/**
 * herdr integration (bundled, default-on).
 *
 * Reports xcsh's live agent state to the herdr terminal multiplexer so an xcsh
 * pane shows up as a first-class "xcsh" assistant with an idle / working /
 * blocked indicator.
 *
 * Transport: herdr injects `HERDR_SOCKET_PATH` into every pane, so state is
 * reported over herdr's protocol-18 JSONL socket via the shared `HerdrClient`
 * (see `../../../herdr/client`) — the same client `herdr-terminal` uses. Each
 * request reconnects independently, validates the `ping` protocol version
 * before the first real request, and awaits herdr's typed response before
 * resolving. This is PATH-independent — unlike shelling out to the `herdr`
 * CLI, which silently no-ops when herdr runs as a launchd/`brew services`
 * server and spawns panes without `/opt/homebrew/bin` on PATH. If
 * `HERDR_SOCKET_PATH` is somehow unset, we fall back to the `herdr` CLI.
 *
 * xcsh is a fork of pi; a user may have both installed, so this reporter always
 * identifies the agent as "xcsh" (never "pi"). It claims pane authority via the
 * `source: "herdr:xcsh"` convention that herdr uses for first-class lifecycle
 * authorities, which also lets herdr resume the pane after a server restart.
 *
 * Session identity: on session start (and each agent turn) the reporter sends a
 * `pane.report_agent_session` frame carrying the absolute session file path (or
 * the session id when the session is not persisted). herdr stores that reference
 * and, on restore, resumes the pane with `xcsh --resume=<session>`.
 *
 * The extension is completely inert unless it is running inside a herdr pane
 * (detected via `HERDR_PANE_ID`), so it has zero effect for users who do not run
 * xcsh under herdr.
 *
 * Sequencing contract with herdr — do not regress. herdr keeps one monotonic
 * `seq` per *source*, shared across every method, and silently discards any frame
 * whose `seq` is not greater than the last it accepted for `herdr:xcsh`. Two
 * consequences drive the design below, and both previously cost panes their
 * resume reference:
 *
 *   1. `seq` is seeded from the wall clock, not 0, so a restarted xcsh always
 *      outranks its predecessor in the same pane. With a per-process counter from
 *      0, every frame from the second xcsh in a pane looks stale and is dropped.
 *   2. Frames go out one at a time through `enqueue`, awaiting herdr's response
 *      before the next frame is sent, so ordering is never left to chance.
 *   3. The state frame is always sent *before* the session frame. herdr discards a
 *      `pane.report_agent_session` for a pane whose agent it does not yet own, so
 *      the state frame has to establish `herdr:xcsh` as the pane's agent first.
 *      Verified against a live herdr: session-then-state (even with a correctly
 *      ascending `seq`) leaves `agent_session` null, while state-then-session
 *      records it.
 */

const HERDR_AGENT_LABEL = "xcsh";
// herdr keys its official lifecycle-authority and session-resume plumbing on the
// `herdr:<agent>` source convention, so report as "herdr:xcsh" (not bare "xcsh").
const HERDR_SOURCE = "herdr:xcsh";
const PHASE_SOURCE = "xcsh:phase";
const REPORT_METHOD = "pane.report_agent";
const METADATA_METHOD = "pane.report_metadata";
const SESSION_METHOD = "pane.report_agent_session";
const RELEASE_METHOD = "pane.release_agent";
const SOCKET_TIMEOUT_MS = 2000;
const PHASE_LABEL_TTL_MS = 60_000;
const SETTLED_TURN_RECONCILE_DELAY_MS = 25;
const PROMPT_BLOCKED_REASONS = {
	select: "selection required",
	confirm: "confirmation required",
	input: "text input required",
} satisfies Record<UserPromptKind, string>;

function getPromptBlockedReason(kind: unknown): string {
	if (typeof kind === "string" && Object.hasOwn(PROMPT_BLOCKED_REASONS, kind)) {
		return PROMPT_BLOCKED_REASONS[kind as UserPromptKind];
	}
	return "user input required";
}

// Reused across calls for the life of the extension so `ensureProtocol()`'s
// `ping` validation happens at most once per socket path, not once per frame.
let cachedClient: HerdrClient | undefined;

function getHerdrClient(socketPath: string): HerdrClient {
	if (!cachedClient || cachedClient.socketPath !== socketPath) {
		cachedClient = new HerdrClient(socketPath, SOCKET_TIMEOUT_MS);
	}
	return cachedClient;
}

/**
 * Send one JSON-RPC request to herdr over its protocol-18 socket and await the
 * typed response. Every failure path (transport error, timeout, protocol
 * mismatch) is reported via `onError` without throwing, so a dead or
 * incompatible herdr never disturbs the agent.
 *
 * Resolves once herdr has responded (or the attempt failed or timed out),
 * which is what lets callers order frames relative to one another.
 */
async function sendToHerdrSocket(
	socketPath: string,
	method: string,
	params: Record<string, unknown>,
	onError: (err: unknown) => void,
): Promise<void> {
	try {
		await getHerdrClient(socketPath).request<Record<string, unknown>>(method, params);
	} catch (err) {
		onError(err);
	}
}

/** Translate a JSON-RPC report/release into `herdr` CLI arguments (fallback). */
function toCliArgs(method: string, params: Record<string, unknown>): string[] {
	const subcommand = method === REPORT_METHOD ? "report-agent" : "release-agent";
	const args = [
		"pane",
		subcommand,
		String(params.pane_id),
		"--source",
		String(params.source),
		"--agent",
		String(params.agent),
	];
	if (params.state !== undefined) {
		args.push("--state", String(params.state));
	}
	if (params.message !== undefined) {
		args.push("--message", String(params.message));
	}
	args.push("--seq", String(params.seq));
	return args;
}

export default function herdrReporter(pi: ExtensionAPI): void {
	const paneId = process.env.HERDR_PANE_ID;
	if (!paneId) {
		// Not running under herdr — do not register anything.
		return;
	}

	// Seeded from the wall clock at microsecond scale rather than 0 so a new xcsh
	// process in a pane always starts above whatever the previous process reached.
	// Matches the pi/omp reporters and stays well inside Number.MAX_SAFE_INTEGER.
	let seq = Date.now() * 1000;
	// Separate monotonic sequence for metadata frames (keyed by source in Herdr).
	let phaseSeq = Date.now() * 1000;
	// Retains the fixed reason while an interactive prompt awaits the user, so an
	// agent_end duplicate cannot erase herdr's stored blocked message.
	let promptBlockedReason: string | undefined;
	// Last session ref already delivered, so repeated lifecycle events do not
	// re-send an unchanged ref every turn.
	let lastSessionRefKey: string | undefined;
	// Herdr only anchors a new full-lifecycle authority after the first session
	// reference identifies how the session began. XCSH creates that reference
	// lazily, so retain the startup marker until there is a concrete ref to send.
	let pendingSessionStartSource: "startup" | undefined = "startup";
	// `agent_end` is the primary completion signal. Keep one deferred check from
	// `turn_end` as well: some interactive UI paths render the completed response
	// before their agent-end extension callback has drained. The check consults
	// XCSH's own streaming state, so a tool boundary cannot be mistaken for idle.
	let settledTurnReconcileTimer: ReturnType<typeof setTimeout> | undefined;
	// Serializes frames: herdr compares `seq` across all methods for this source,
	// so frames must reach it in the order they were generated.
	let queue: Promise<void> = Promise.resolve();

	pi.setLabel(HERDR_AGENT_LABEL);

	const onError = (err: unknown): void => {
		pi.logger.debug("herdr report failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	};

	/** Chain a frame onto the tail of the send queue. Never rejects. */
	const enqueue = (task: () => Promise<void>): Promise<void> => {
		queue = queue.then(task, task).catch(onError);
		return queue;
	};

	const send = (method: string, params: Record<string, unknown>): Promise<void> => {
		const socketPath = process.env.HERDR_SOCKET_PATH;
		if (socketPath) {
			return enqueue(() => sendToHerdrSocket(socketPath, method, params, onError));
		}
		// Fallback for the rare case herdr did not inject a socket path.
		return enqueue(() =>
			pi
				.exec("herdr", toCliArgs(method, params))
				.then(() => undefined)
				.catch(onError),
		);
	};

	const report = (state: "idle" | "working" | "blocked", message?: string): Promise<void> =>
		send(REPORT_METHOD, {
			pane_id: paneId,
			source: HERDR_SOURCE,
			agent: HERDR_AGENT_LABEL,
			state,
			...(message === undefined ? {} : { message }),
			seq: seq++,
		});

	const reportMetadata = (params: Record<string, unknown>): Promise<void> => {
		const socketPath = process.env.HERDR_SOCKET_PATH;
		if (!socketPath) {
			return Promise.resolve();
		}
		const frame = {
			pane_id: paneId,
			source: PHASE_SOURCE,
			applies_to_source: HERDR_SOURCE,
			seq: phaseSeq++,
			...params,
		};
		return enqueue(() => sendToHerdrSocket(socketPath, METADATA_METHOD, frame, onError));
	};

	const setPhaseLabel = (label: string): Promise<void> =>
		reportMetadata({
			state_labels: { working: label },
			ttl_ms: PHASE_LABEL_TTL_MS,
		});

	const clearPhaseLabel = (): Promise<void> =>
		reportMetadata({
			clear_state_labels: true,
		});

	// Report the current session's identity so herdr can resume this pane
	// (`xcsh --resume=<session>`) after a server restart. This is sent only over
	// the socket; if herdr did not inject a socket path we skip it (state still
	// reports via the CLI fallback). Prefer the absolute session file path, which
	// herdr resumes directly; fall back to the session id for non-persisted
	// sessions (e.g. print/RPC mode, where getSessionFile() is undefined).
	//
	// Called from every lifecycle handler because xcsh creates the session file
	// lazily: getSessionFile() can still be undefined at session_start and even at
	// agent_start, and a ref missed there would otherwise be lost until the next
	// turn — long enough for a restart to lose the pane. Unchanged refs are
	// suppressed, so the extra call sites cost nothing on the wire.
	const reportSession = (ctx: ExtensionContext): Promise<void> => {
		const socketPath = process.env.HERDR_SOCKET_PATH;
		if (!socketPath) {
			return Promise.resolve();
		}
		let sessionRef: Record<string, unknown> | undefined;
		try {
			const file = ctx.sessionManager?.getSessionFile?.();
			if (typeof file === "string" && path.isAbsolute(file)) {
				sessionRef = { agent_session_path: file };
			} else {
				const id = ctx.sessionManager?.getSessionId?.();
				if (typeof id === "string" && id.length > 0) {
					sessionRef = { agent_session_id: id };
				}
			}
		} catch (err) {
			onError(err);
			return Promise.resolve();
		}
		if (!sessionRef) {
			return Promise.resolve();
		}
		const refKey = JSON.stringify(sessionRef);
		if (refKey === lastSessionRefKey) {
			return Promise.resolve();
		}
		lastSessionRefKey = refKey;
		const frame = {
			pane_id: paneId,
			source: HERDR_SOURCE,
			agent: HERDR_AGENT_LABEL,
			seq: seq++,
			...(pendingSessionStartSource === undefined ? {} : { session_start_source: pendingSessionStartSource }),
			...sessionRef,
		};
		pendingSessionStartSource = undefined;
		return enqueue(() => sendToHerdrSocket(socketPath, SESSION_METHOD, frame, onError));
	};

	const clearSettledTurnReconcile = (): void => {
		if (settledTurnReconcileTimer !== undefined) {
			clearTimeout(settledTurnReconcileTimer);
			settledTurnReconcileTimer = undefined;
		}
	};

	const scheduleSettledTurnReconcile = (ctx: ExtensionContext): void => {
		if (settledTurnReconcileTimer !== undefined) return;
		settledTurnReconcileTimer = setTimeout(() => {
			settledTurnReconcileTimer = undefined;
			if (promptBlockedReason || !ctx.isIdle()) return;
			void report("idle").then(() => reportSession(ctx));
		}, SETTLED_TURN_RECONCILE_DELAY_MS);
	};

	// Announce presence and session identity as soon as the session is initialized.
	pi.on("session_start", async (_event, ctx) => {
		await report("idle");
		await reportSession(ctx);
	});

	// Busy while the agent loop is streaming a response. Re-report session identity
	// in case the active session file changed (e.g. after /new, /resume, or /fork).
	pi.on("agent_start", async (_event, ctx) => {
		clearSettledTurnReconcile();
		await report("working");
		await reportSession(ctx);
	});

	// Back to idle when the loop ends — unless we are waiting on a user prompt.
	// This is also the first point where a lazily-created session file is certain
	// to exist, so it is the backstop for capturing the resume ref.
	pi.on("agent_end", async (_event, ctx) => {
		await report(promptBlockedReason ? "blocked" : "idle", promptBlockedReason);
		await reportSession(ctx);
	});

	// Reconcile completion after the UI has had a chance to clear its streaming
	// flag. This is deliberately non-blocking so it cannot delay the next turn.
	pi.on("turn_end", (_event, ctx) => {
		scheduleSettledTurnReconcile(ctx);
	});

	// An interactive prompt (permission gate, ask tool, confirm/input) is
	// awaiting the user: that is herdr's "needs attention" (blocked) state.
	pi.on("user_prompt_start", event => {
		promptBlockedReason = getPromptBlockedReason(event.kind);
		void report("blocked", promptBlockedReason);
	});

	pi.on("user_prompt_end", async (_event, ctx) => {
		promptBlockedReason = undefined;
		await report(ctx.isIdle() ? "idle" : "working");
		await reportSession(ctx);
	});

	// Transient phase-label metadata (thinking / tool / retry / cleanup):
	pi.on("message_update", async event => {
		if (event.assistantMessageEvent.type === "thinking_start") {
			await setPhaseLabel("thinking");
		} else if (event.assistantMessageEvent.type === "thinking_end") {
			await clearPhaseLabel();
		}
	});

	pi.on("tool_execution_start", async () => {
		await setPhaseLabel("tool");
	});

	pi.on("tool_execution_end", async () => {
		await clearPhaseLabel();
	});

	pi.on("auto_retry_start", async () => {
		await setPhaseLabel("retry");
	});

	pi.on("auto_retry_end", async () => {
		await clearPhaseLabel();
	});

	pi.on("auto_compaction_start", async () => {
		await setPhaseLabel("cleanup");
	});

	pi.on("auto_compaction_end", async () => {
		await clearPhaseLabel();
	});

	// Relinquish pane authority so herdr stops showing xcsh once we exit.
	pi.on("session_shutdown", () => {
		void send(RELEASE_METHOD, {
			pane_id: paneId,
			source: HERDR_SOURCE,
			agent: HERDR_AGENT_LABEL,
			seq: seq++,
		});
	});
}
