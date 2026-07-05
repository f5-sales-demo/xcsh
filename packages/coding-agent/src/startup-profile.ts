/**
 * Opt-in startup profiler — `PI_STARTUP_PROFILE=1`.
 *
 * PI_TIMING exits before the TUI paints, so it cannot measure `runInteractiveMode`
 * or the pre-`main` module-graph load. This records labeled timestamps (ms since
 * process start, via `performance.now()`, which is measured from runtime start) and
 * dumps the full boot timeline to a FILE at the input-ready point — so nothing
 * corrupts the live TUI screen. Zero cost when the env var is unset.
 *
 * The FIRST mark's timestamp is the time from process start to that mark, i.e. it
 * captures the runtime init + evaluation of the embedded module graph that happens
 * before any of our code runs. Later marks show the per-step deltas through paint.
 *
 * Usage:  PI_STARTUP_PROFILE=1 xcsh   (then quit; read /tmp/xcsh-startup-profile.txt,
 *         or set PI_STARTUP_PROFILE_FILE to choose the path).
 */
import { writeFileSync } from "node:fs";

const ENABLED = !!process.env.PI_STARTUP_PROFILE;
const marks: Array<[label: string, atMs: number]> = [];

/** Record a labeled timestamp (no-op unless PI_STARTUP_PROFILE is set). */
export function profileMark(label: string): void {
	if (ENABLED) marks.push([label, performance.now()]);
}

/** Write the collected timeline to a file (no-op unless enabled / no marks). */
export function profileDump(): void {
	if (!ENABLED || marks.length === 0) return;
	const lines = ["=== xcsh startup profile (ms since process start) ===", ""];
	let prev = 0;
	for (const [label, at] of marks) {
		const delta = at - prev;
		lines.push(`  ${at.toFixed(1).padStart(9)} ms   (+${delta.toFixed(1).padStart(8)} ms)   ${label}`);
		prev = at;
	}
	lines.push(
		"",
		`  first mark = runtime + module-graph load; total to ready = ${marks[marks.length - 1][1].toFixed(1)} ms`,
	);
	const file = process.env.PI_STARTUP_PROFILE_FILE || "/tmp/xcsh-startup-profile.txt";
	try {
		writeFileSync(file, `${lines.join("\n")}\n`);
		process.stderr.write(`[xcsh] startup profile written to ${file}\n`);
	} catch {
		/* best-effort diagnostic */
	}
}
