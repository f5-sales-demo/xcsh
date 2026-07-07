#!/usr/bin/env bun
/**
 * Guarded `bun test` runner.
 *
 * Runs `bun test <args…>` and enforces one extra invariant: if the run exits 0
 * it MUST have printed a "Ran N tests" summary. A test module that calls
 * `process.exit(0)` terminates the whole runner with a success code BEFORE the
 * summary prints, silently masking every failure that already ran (this made the
 * required CI `test` job a no-op gate — issue #1903). Exit code alone can't catch
 * that regression; the missing summary can.
 *
 * Behaviour:
 *  - child exits non-zero  → propagate it (real failures already fail the job).
 *  - child exits 0 WITH a summary ("Ran N tests" / "No tests found") → pass.
 *  - child exits 0 WITHOUT a summary → fail (exit 1): a test aborted the runner.
 *
 * stderr (where bun writes results) is streamed through unchanged so CI logs are
 * identical; we only tee it to scan for the summary line.
 */
const args = process.argv.slice(2);

// Use the running bun (process.execPath), not a PATH lookup of "bun", so the
// guard works in any environment the parent runs in.
const proc = Bun.spawn([process.execPath, "test", ...args], {
	stdout: "inherit",
	stderr: "pipe",
	env: process.env,
});

const SUMMARY = /Ran \d+ tests?\b|No tests found/;
const decoder = new TextDecoder();
// Keep a small rolling tail so a summary line split across two chunks is still
// matched, without buffering the entire (potentially large) stderr stream.
let tail = "";

for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
	process.stderr.write(chunk); // stream through unchanged
	tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
}

const sawSummary = SUMMARY.test(tail);
const code = await proc.exited;

if (code !== 0) process.exit(code);

if (!sawSummary) {
	process.stderr.write(
		'\n\x1b[31mtest-guard: `bun test` exited 0 but printed no "Ran N tests" summary.\x1b[0m\n' +
			"A test module likely called process.exit() and aborted the runner, masking failures (see #1903).\n",
	);
	process.exit(1);
}

process.exit(0);
