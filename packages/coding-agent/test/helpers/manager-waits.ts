/**
 * The manager integration test's SPAN wait (#2364).
 *
 * Extracted from `manager.int.test.ts` so its semantics can be tested directly
 * (`manager-waits.test.ts`) instead of only through a 60s integration test that
 * reproduces its own defects a few percent of the time.
 *
 * The rule it exists to enforce: **wait on the post-condition, never on a proxy
 * for it** — the same rule behind #2326 and #2331. `collectSpans` waits for the
 * span STAGES the caller asserts on. It used to wait for a COUNT of spans of any
 * stage, so a run in which unrelated spans arrived first returned "successfully"
 * with the wrong set. No budget can fix that, because the wait was never watching
 * for the thing it was supposed to produce.
 *
 * The port wait's counterpart lives in `../manager-wait-diagnostics.ts`; this
 * module reuses its manager census rather than growing a second one.
 */
import { describeManagerCensus } from "../manager-wait-diagnostics";
import { PROBE_ORIGIN } from "./bridge-probe";

/** A `span` frame flushed by a worker to its first client. */
export type SpanFrame = Record<string, unknown>;

/** Which of `required` never arrived in `collected`. */
export function missingStages(collected: readonly SpanFrame[], required: readonly string[]): string[] {
	return required.filter(stage => !collected.some(s => s.stage === stage));
}

/**
 * Connect ONE persistent client (extension Origin) as the worker's first client and
 * collect `span` frames flushed on connect, returning once every stage in
 * `required` has arrived. Retries the CONNECT until the (freshly cold-spawned)
 * worker has bound its port — a refused attempt never opens, so it does not
 * consume the on-connect flush; only a successful open becomes the first client.
 * onmessage is attached synchronously so an immediate flush is not missed.
 *
 * On a spent budget it returns whatever arrived, so the caller can report which
 * stages were missing; `requireSpans` does that for you.
 */
export async function collectSpans(port: number, required: readonly string[], timeoutMs: number): Promise<SpanFrame[]> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await new Promise<SpanFrame[] | null>(resolve => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
				headers: { Origin: PROBE_ORIGIN },
			} as unknown as string[]);
			const collected: SpanFrame[] = [];
			let opened = false;
			const timer = setTimeout(
				() => {
					try {
						ws.close();
					} catch {}
					resolve(opened ? collected : null);
				},
				Math.max(0, deadline - Date.now()),
			);
			ws.onopen = () => {
				opened = true;
				ws.send(JSON.stringify({ type: "hello" }));
			};
			ws.onmessage = ev => {
				const m = JSON.parse(String(ev.data)) as SpanFrame;
				if (m.type !== "span") return;
				collected.push(m);
				// Wait on the post-condition — every stage the caller asserts on —
				// never on a count of spans of any stage (#2364).
				if (missingStages(collected, required).length > 0) return;
				clearTimeout(timer);
				try {
					ws.close();
				} catch {}
				resolve(collected);
			};
			ws.onerror = () => {
				clearTimeout(timer);
				try {
					ws.close();
				} catch {}
				// If we had already opened (and thus consumed the worker's first-client
				// flush), return whatever we collected rather than retrying a second
				// client that would receive nothing; only a never-opened attempt retries.
				resolve(opened ? collected : null);
			};
			ws.onclose = () => {
				if (!opened) {
					clearTimeout(timer);
					resolve(null);
				}
			};
		});
		if (result !== null) return result; // opened (first client); return whatever was collected
		await Bun.sleep(150); // worker not listening yet — retry the connect (no client was established)
	}
	return [];
}

/**
 * `collectSpans`, but missing stages throw naming exactly what never arrived
 * instead of an opaque `expect(undefined).toBeDefined()` downstream (#2364).
 * Same principle as `waitForPort` throwing a census instead of returning null.
 */
export async function requireSpans(
	port: number,
	required: readonly string[],
	timeoutMs: number,
	getErr: () => string,
): Promise<SpanFrame[]> {
	const started = Date.now();
	const spans = await collectSpans(port, required, timeoutMs);
	const missing = missingStages(spans, required);
	if (missing.length === 0) return spans;
	const arrived = spans.map(s => String(s.stage));
	throw new Error(
		[
			`span stage(s) [${required.join(", ")}] never arrived on port ${port} within ${Date.now() - started}ms`,
			`  missing: ${missing.join(", ")}`,
			`  arrived: ${arrived.length > 0 ? arrived.join(", ") : "(no spans at all)"} (${spans.length} span${spans.length === 1 ? "" : "s"})`,
			...describeManagerCensus(getErr()),
		].join("\n"),
	);
}
