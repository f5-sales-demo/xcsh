/**
 * Semantics of the manager integration test's waits (#2364, #2423).
 *
 * `manager.int.test.ts` asserts on a SPECIFIC span stage but used to wait on a
 * COUNT of spans of any stage, so a run in which unrelated spans arrived first
 * returned "successfully" with the wrong set and failed on an opaque
 * `expect(undefined).toBeDefined()`. That is a property of the wait helper, not
 * of the manager, so it is pinned here — deterministically, in milliseconds —
 * rather than only through a 60s integration test that reproduces it a few
 * percent of the time.
 */
import { describe, expect, test } from "bun:test";
import { collectSpans, missingStages, requireSpans, SURVIVAL_BUDGET_MS } from "./helpers/manager-waits";

/**
 * A stand-in for a worker's span flush: on first client connect, emit `frames`
 * in order, each after its own delay. Mirrors the real flush shape
 * (`{ type: "span", stage, ... }`) without needing a manager or a worker.
 */
function startSpanServer(frames: Array<{ stage: string; afterMs: number; extra?: object }>): {
	port: number;
	stop: () => void;
} {
	const server = Bun.serve({
		port: 0,
		fetch(req, srv) {
			if (srv.upgrade(req)) return undefined;
			return new Response("expected a websocket upgrade", { status: 426 });
		},
		websocket: {
			open(ws) {
				for (const f of frames) {
					setTimeout(() => {
						try {
							ws.send(JSON.stringify({ type: "span", stage: f.stage, ...f.extra }));
						} catch {
							/* client already closed — the wait it was feeding is over */
						}
					}, f.afterMs);
				}
			},
			message() {
				/* the client's `hello` needs no reply for a span flush */
			},
		},
	});
	return { port: server.port as number, stop: () => server.stop(true) };
}

describe("collectSpans waits on stages, not on a count (#2364)", () => {
	test("returns only once EVERY required stage has arrived, even when unrelated spans arrive first", async () => {
		// Two unrelated spans land immediately; the awaited stage lands later. A
		// count-based wait (want = 2) returns after the first two and never sees it.
		const { port, stop } = startSpanServer([
			{ stage: "manager_provision", afterMs: 0 },
			{ stage: "tenant_activate", afterMs: 0 },
			{ stage: "worker_boot", afterMs: 250, extra: { cold: false, sid: "tab-777" } },
		]);
		try {
			const spans = await collectSpans(port, ["worker_boot"], 10_000);
			const wb = spans.find(s => s.stage === "worker_boot");
			expect(wb).toBeDefined();
			expect(wb?.sid).toBe("tab-777");
		} finally {
			stop();
		}
	});

	test("waits for ALL required stages when more than one is asserted on", async () => {
		const { port, stop } = startSpanServer([
			{ stage: "noise_a", afterMs: 0 },
			{ stage: "noise_b", afterMs: 0 },
			{ stage: "manager_provision", afterMs: 120 },
			{ stage: "worker_boot", afterMs: 260, extra: { cold: true, sid: "tab-501" } },
		]);
		try {
			const spans = await collectSpans(port, ["manager_provision", "worker_boot"], 10_000);
			const stages = spans.map(s => s.stage);
			expect(stages).toContain("manager_provision");
			expect(stages).toContain("worker_boot");
		} finally {
			stop();
		}
	});

	test("returns promptly once the required stages are in, without burning the whole budget", async () => {
		const { port, stop } = startSpanServer([{ stage: "worker_boot", afterMs: 50 }]);
		try {
			const started = Date.now();
			const spans = await collectSpans(port, ["worker_boot"], 10_000);
			const elapsed = Date.now() - started;
			expect(spans.map(s => s.stage)).toContain("worker_boot");
			expect(elapsed).toBeLessThan(5_000); // not "waited out the deadline"
		} finally {
			stop();
		}
	});

	test("missingStages names exactly the stages that never arrived", () => {
		const collected = [{ stage: "manager_provision" }, { stage: "noise" }];
		expect(missingStages(collected, ["manager_provision"])).toEqual([]);
		expect(missingStages(collected, ["manager_provision", "worker_boot"])).toEqual(["worker_boot"]);
		expect(missingStages([], ["worker_boot"])).toEqual(["worker_boot"]);
	});
});

describe("a wait that ends empty explains why (#2423)", () => {
	test("requireSpans names the missing stages, what did arrive, and the manager's progress", async () => {
		// The awaited stage never arrives; two unrelated ones do.
		const { port, stop } = startSpanServer([
			{ stage: "manager_provision", afterMs: 0 },
			{ stage: "tenant_activate", afterMs: 0 },
		]);
		// Real manager format — the census regexes key off the arrow (manager.ts:277).
		const stderr =
			"[xcsh manager] pre-warmed spare → pid 4242 on port 19222\n" +
			"[xcsh manager] pre-warmed spare → pid 4243 on port 19223\n";
		try {
			const err = await requireSpans(port, ["worker_boot"], 1_000, () => stderr).then(
				() => null,
				(e: Error) => e,
			);
			expect(err).toBeInstanceOf(Error);
			const msg = String(err?.message);
			expect(msg).toContain("missing: worker_boot");
			expect(msg).toContain("manager_provision"); // what DID arrive
			expect(msg).toContain("spares pre-warmed: 2"); // a spare WAS spawned...
			expect(msg).toContain("adoptions logged: 0"); // ...but was never adopted
			expect(msg).toContain("pid 4243"); // stderr tail is quoted
		} finally {
			stop();
		}
	});
});

describe("the adopted-worker survival budget is sized against measurement (#2463 mode D)", () => {
	test("allows an order of magnitude over the observed ack latency", () => {
		// Measured on this file, six consecutive adoptions: 1056, 1082, 1199, 1268,
		// 1455, 1458 ms — a just-adopted spare runs activateTenantContext inside its
		// bind closure before it serves the handshake.
		//
		// The budget was 10 x 250ms = 2500ms, i.e. the TYPICAL case already consumed
		// 50-60% of it. That is why the test failed ~1 run in 20 with the worker
		// demonstrably alive and still holding its port.
		//
		// This is not #2418 repeated. There, a budget was raised for a log line that
		// never arrived, so no number could have worked. Here the ack is measured to
		// arrive, and the budget was simply below the load-induced spread. The
		// diagnostic still distinguishes the two: a worker that genuinely died
		// reports `pids still holding the port: NONE`.
		const OBSERVED_WORST_MS = 1458;
		expect(SURVIVAL_BUDGET_MS).toBeGreaterThanOrEqual(OBSERVED_WORST_MS * 10);
	});

	test("stays below the enclosing test timeout, so exhaustion reports instead of timing out", () => {
		// A budget at or above the test timeout means the diagnostic can never print —
		// the same trap #2510 hit when the reap budget equalled the hook timeout.
		expect(SURVIVAL_BUDGET_MS).toBeLessThan(60_000);
	});
});
