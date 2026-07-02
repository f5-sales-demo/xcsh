import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

/**
 * herdr integration (bundled, default-on).
 *
 * Reports xcsh's live agent state to the herdr terminal multiplexer over its
 * socket API so an xcsh pane shows up as a first-class "xcsh" assistant with an
 * idle / working / blocked indicator.
 *
 * xcsh is a fork of pi; a user may have both installed, so this reporter always
 * identifies itself as "xcsh" (never "pi") and claims pane authority via
 * `--source xcsh` so herdr's passive pi-detection heuristics cannot mislabel the
 * pane.
 *
 * The extension is completely inert unless it is running inside a herdr pane
 * (detected via the `HERDR_PANE_ID` environment variable herdr injects), so it
 * has zero effect for users who do not run xcsh under herdr.
 */

const HERDR_AGENT_LABEL = "xcsh";

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

	// Fire-and-forget: a missing or failing herdr CLI must never disturb the agent.
	const runHerdr = (args: string[]): void => {
		pi.exec("herdr", args).catch((err: unknown) => {
			pi.logger.debug("herdr report failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	};

	const report = (state: "idle" | "working" | "blocked"): void => {
		runHerdr([
			"pane",
			"report-agent",
			paneId,
			"--source",
			HERDR_AGENT_LABEL,
			"--agent",
			HERDR_AGENT_LABEL,
			"--state",
			state,
			"--seq",
			String(seq++),
		]);
	};

	// Announce presence as soon as the session is initialized.
	pi.on("session_start", () => {
		report("idle");
	});

	// Busy while the agent loop is streaming a response.
	pi.on("agent_start", () => {
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
		runHerdr([
			"pane",
			"release-agent",
			paneId,
			"--source",
			HERDR_AGENT_LABEL,
			"--agent",
			HERDR_AGENT_LABEL,
			"--seq",
			String(seq++),
		]);
	});
}
