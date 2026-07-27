import { describe, expect, it } from "bun:test";
import {
	type PortReaperDeps,
	parseLsofPids,
	pidsOnPorts,
	portSpec,
	REAP_BUDGET_MS,
	reapPorts,
	SWEEP_TIMEOUT_MS,
	TEARDOWN_HOOK_TIMEOUT_MS,
} from "./port-reaper";

const RANGE = [19222, 19223, 19224, 19225];

interface Recorder extends PortReaperDeps {
	specs: string[];
	kills: Array<{ pid: number; signal?: string }>;
	clock: number;
}

/**
 * A reaper whose port state is scripted per poll: `holders[i]` is what the i-th sweep sees, and the
 * last entry repeats. Time advances only when the code sleeps, so a runaway loop shows up as a
 * spec count rather than as a hanging test.
 */
function recorder(holders: number[][], indeterminate = false): Recorder {
	const state: Recorder = {
		specs: [],
		kills: [],
		clock: 0,
		listPids: async spec => {
			state.specs.push(spec);
			if (indeterminate) return null;
			// Per-port queries only happen in the failure diagnostic; answer them from the last sweep.
			if (!spec.includes("-") && !spec.includes(",")) {
				const last = holders[Math.min(state.specs.length - 1, holders.length - 1)] ?? [];
				return last.length > 0 ? [999] : [];
			}
			const sweepIndex = state.specs.filter(s => s.includes("-") || s.includes(",")).length - 1;
			return holders[Math.min(sweepIndex, holders.length - 1)] ?? [];
		},
		kill: (pid, signal) => {
			state.kills.push({ pid, signal });
		},
		now: () => state.clock,
		sleep: async ms => {
			state.clock += ms;
		},
	};
	return state;
}

describe("portSpec", () => {
	// The whole point: one argument, therefore one subprocess, for the whole set.
	it("collapses a contiguous range", () => {
		expect(portSpec(RANGE)).toBe("19222-19225");
		expect(portSpec([19225, 19222, 19224, 19223])).toBe("19222-19225");
	});

	it("falls back to a comma list when the ports are not contiguous", () => {
		expect(portSpec([19222, 19225])).toBe("19222,19225");
	});

	it("handles the trivial cases", () => {
		expect(portSpec([19222])).toBe("19222");
		expect(portSpec([])).toBe("");
	});
});

describe("pidsOnPorts", () => {
	// The regression this guards: one lsof per port cost 556ms idle and 952ms under load, which is
	// what turned a nominal 5s teardown budget into 28-48s (#2495).
	it("asks about the whole range in a single call", async () => {
		const deps = recorder([[4242]]);
		await pidsOnPorts(RANGE, deps);
		expect(deps.specs).toEqual(["19222-19225"]);
	});

	it("never reports this process, which holds probe connections on the range", async () => {
		const deps = recorder([[process.pid, 4242]]);
		expect(await pidsOnPorts(RANGE, deps)).toEqual([4242]);
	});

	it("returns nothing for an empty port set without spawning", async () => {
		const deps = recorder([[]]);
		expect(await pidsOnPorts([], deps)).toEqual([]);
		expect(deps.specs).toEqual([]);
	});
});

describe("reapPorts", () => {
	it("returns immediately when the ports are already free", async () => {
		const deps = recorder([[]]);
		const result = await reapPorts(RANGE, { budgetMs: 3000 }, deps);
		expect(result.heldPids).toEqual([]);
		expect(deps.kills).toEqual([]);
		expect(deps.specs).toHaveLength(1);
	});

	it("signals a holder, then escalates to SIGKILL on the next poll", async () => {
		const deps = recorder([[4242], [4242], []]);
		const result = await reapPorts(RANGE, { budgetMs: 3000 }, deps);
		expect(result.heldPids).toEqual([]);
		expect(deps.kills.map(k => k.signal)).toEqual(["SIGTERM", "SIGKILL"]);
	});

	// The failure mode being fixed: the old loop's cost was unbounded in wall-clock terms, so it
	// overran the hook timeout instead of reporting anything.
	it("gives up at its wall-clock budget rather than running for a fixed iteration count", async () => {
		const deps = recorder([[4242]]);
		const result = await reapPorts(RANGE, { budgetMs: 500, pollMs: 100 }, deps);
		expect(result.elapsedMs).toBeLessThanOrEqual(600);
		// ~5 polls at 100ms, not 50.
		expect(deps.specs.filter(s => s.includes("-")).length).toBeLessThanOrEqual(7);
	});

	it("names the holding PIDs when the budget runs out", async () => {
		const deps = recorder([[4242]]);
		const result = await reapPorts(RANGE, { budgetMs: 200, pollMs: 100 }, deps);
		expect(result.heldPids).toEqual([4242]);
	});

	// The diagnostic must not pay for more subprocesses after the budget is already blown: that tail
	// was unbounded, so a slow lsof could still overrun the hook timeout this change exists to stop.
	it("spawns nothing extra to build its failure diagnostic", async () => {
		const deps = recorder([[4242]]);
		await reapPorts(RANGE, { budgetMs: 200, pollMs: 100 }, deps);
		// Every call is a whole-range sweep; no per-port queries.
		expect(deps.specs.every(s => s === "19222-19225")).toBe(true);
	});
});

// lsof prints nothing when a port is free, and Number("") is 0 — so a naive parse reports PID 0 as
// a holder and every released port looks occupied.
describe("parseLsofPids", () => {
	it("treats empty output as no holders", () => {
		expect(parseLsofPids("")).toEqual([]);
		expect(parseLsofPids("\n")).toEqual([]);
		expect(parseLsofPids("   \n  \n")).toEqual([]);
	});

	it("parses one PID per line and drops anything that is not one", () => {
		expect(parseLsofPids("4242\n4243\n")).toEqual([4242, 4243]);
		expect(parseLsofPids("4242\n\nnot-a-pid\n0\n-1\n")).toEqual([4242]);
	});
});

// A sweep that cannot answer is not evidence the ports are free. Under exactly the load this change
// targets, treating it as success would leave a live worker bound for the next test (#2463).
describe("reapPorts with an indeterminate sweep", () => {
	it("never reports success when no sweep could answer", async () => {
		const deps = recorder([[]], true);
		const result = await reapPorts(RANGE, { budgetMs: 300, pollMs: 100 }, deps);
		expect(result.indeterminate).toBe(true);
		expect(result.heldPids).toEqual([]);
	});

	it("keeps polling rather than exiting early on one bad sweep", async () => {
		const deps = recorder([[]], true);
		await reapPorts(RANGE, { budgetMs: 300, pollMs: 100 }, deps);
		expect(deps.specs.length).toBeGreaterThan(1);
	});

	it("reports success only when a sweep actually answered", async () => {
		const deps = recorder([[]]);
		const result = await reapPorts(RANGE, { budgetMs: 300 }, deps);
		expect(result.indeterminate).toBe(false);
		expect(result.heldPids).toEqual([]);
	});
});

// The budget only means anything if it expires before the hook that contains it. Setting them equal
// (both 5s, bun's default) made the diagnostic unreachable in exactly the case it is for.
describe("teardown budget vs hook timeout", () => {
	it("leaves room for the budget to fire and be reported", () => {
		expect(REAP_BUDGET_MS).toBeLessThan(TEARDOWN_HOOK_TIMEOUT_MS);
		// Enough headroom for the sweep in flight when the deadline lands, plus the rest of teardown.
		expect(TEARDOWN_HOOK_TIMEOUT_MS - REAP_BUDGET_MS).toBeGreaterThanOrEqual(SWEEP_TIMEOUT_MS + 5_000);
	});

	// Several sweeps have to fit inside the budget, or one slow lsof consumes it and teardown
	// reports indeterminate when the ports were simply taking their time.
	it("fits multiple sweeps inside the budget", () => {
		expect(REAP_BUDGET_MS / SWEEP_TIMEOUT_MS).toBeGreaterThanOrEqual(3);
	});

	// The loop this replaced effectively waited ~28s (50 polls x 556ms). Keeping the real grace
	// period is what stops a normal worker drain from failing teardown.
	it("keeps a grace period comparable to what it replaced", () => {
		expect(REAP_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
	});
});
