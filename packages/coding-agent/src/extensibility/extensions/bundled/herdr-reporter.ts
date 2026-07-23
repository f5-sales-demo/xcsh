import { connect } from "node:net";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@f5-sales-demo/xcsh";

/**
 * herdr integration (bundled, default-on).
 *
 * Reports xcsh's live agent state to the herdr terminal multiplexer so an xcsh
 * pane shows up as a first-class "xcsh" assistant with an idle / working /
 * blocked indicator.
 *
 * Transport: herdr injects `HERDR_SOCKET_PATH` into every pane, so state is
 * reported by writing a newline-delimited JSON-RPC request straight to that unix
 * socket. This is PATH-independent — unlike shelling out to the `herdr` CLI,
 * which silently no-ops when herdr runs as a launchd/`brew services` server and
 * spawns panes without `/opt/homebrew/bin` on PATH. If `HERDR_SOCKET_PATH` is
 * somehow unset, we fall back to the `herdr` CLI.
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
 */

const HERDR_AGENT_LABEL = "xcsh";
// herdr keys its official lifecycle-authority and session-resume plumbing on the
// `herdr:<agent>` source convention, so report as "herdr:xcsh" (not bare "xcsh").
const HERDR_SOURCE = "herdr:xcsh";
const REPORT_METHOD = "pane.report_agent";
const SESSION_METHOD = "pane.report_agent_session";
const RELEASE_METHOD = "pane.release_agent";
const SOCKET_TIMEOUT_MS = 2000;

/**
 * Write one newline-delimited JSON-RPC request to herdr's unix socket and close.
 * Fire-and-forget: the response is ignored and every failure path is reported
 * via `onError` without throwing, so a dead socket never disturbs the agent.
 */
function sendToHerdrSocket(
	socketPath: string,
	method: string,
	params: Record<string, unknown>,
	onError: (err: unknown) => void,
): void {
	const conn = connect({ path: socketPath });
	// Never let a report keep xcsh's event loop alive.
	conn.unref();
	conn.once("error", err => {
		onError(err);
		conn.destroy();
	});
	conn.once("connect", () => {
		conn.end(`${JSON.stringify({ id: "xcsh:herdr-reporter", method, params })}\n`);
	});
	conn.setTimeout(SOCKET_TIMEOUT_MS, () => conn.destroy());
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
	args.push("--seq", String(params.seq));
	return args;
}

export default function herdrReporter(pi: ExtensionAPI): void {
	const paneId = process.env.HERDR_PANE_ID;
	if (!paneId) {
		// Not running under herdr — do not register anything.
		return;
	}

	let seq = 0;
	// Tracks whether an interactive prompt is currently awaiting the user, so an
	// agent_end that fires while a prompt is open is reported as blocked, not idle.
	let promptOpen = false;

	pi.setLabel(HERDR_AGENT_LABEL);

	const onError = (err: unknown): void => {
		pi.logger.debug("herdr report failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	};

	const send = (method: string, params: Record<string, unknown>): void => {
		const socketPath = process.env.HERDR_SOCKET_PATH;
		if (socketPath) {
			sendToHerdrSocket(socketPath, method, params, onError);
			return;
		}
		// Fallback for the rare case herdr did not inject a socket path.
		pi.exec("herdr", toCliArgs(method, params)).catch(onError);
	};

	const report = (state: "idle" | "working" | "blocked"): void => {
		send(REPORT_METHOD, {
			pane_id: paneId,
			source: HERDR_SOURCE,
			agent: HERDR_AGENT_LABEL,
			state,
			seq: seq++,
		});
	};

	// Report the current session's identity so herdr can resume this pane
	// (`xcsh --resume=<session>`) after a server restart. This is sent only over
	// the socket; if herdr did not inject a socket path we skip it (state still
	// reports via the CLI fallback). Prefer the absolute session file path, which
	// herdr resumes directly; fall back to the session id for non-persisted
	// sessions (e.g. print/RPC mode, where getSessionFile() is undefined).
	const reportSession = (ctx: ExtensionContext): void => {
		const socketPath = process.env.HERDR_SOCKET_PATH;
		if (!socketPath) {
			return;
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
			return;
		}
		if (!sessionRef) {
			return;
		}
		sendToHerdrSocket(
			socketPath,
			SESSION_METHOD,
			{
				pane_id: paneId,
				source: HERDR_SOURCE,
				agent: HERDR_AGENT_LABEL,
				seq: seq++,
				...sessionRef,
			},
			onError,
		);
	};

	// Announce presence and session identity as soon as the session is initialized.
	pi.on("session_start", (_event, ctx) => {
		reportSession(ctx);
		report("idle");
	});

	// Busy while the agent loop is streaming a response. Re-report session identity
	// in case the active session file changed (e.g. after /new, /resume, or /fork).
	pi.on("agent_start", (_event, ctx) => {
		reportSession(ctx);
		report("working");
	});

	// Back to idle when the loop ends — unless we are waiting on a user prompt.
	pi.on("agent_end", () => {
		report(promptOpen ? "blocked" : "idle");
	});

	// An interactive prompt (permission gate, ask tool, confirm/input) is
	// awaiting the user: that is herdr's "needs attention" (blocked) state.
	pi.on("user_prompt_start", () => {
		promptOpen = true;
		report("blocked");
	});

	pi.on("user_prompt_end", (_event, ctx) => {
		promptOpen = false;
		report(ctx.isIdle() ? "idle" : "working");
	});

	// Relinquish pane authority so herdr stops showing xcsh once we exit.
	pi.on("session_shutdown", () => {
		send(RELEASE_METHOD, {
			pane_id: paneId,
			source: HERDR_SOURCE,
			agent: HERDR_AGENT_LABEL,
			seq: seq++,
		});
	});
}
