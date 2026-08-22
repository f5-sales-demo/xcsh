import { describe, expect, it } from "bun:test";
import {
	isOwned,
	type PortReaperDeps,
	parseLsofPids,
	parseSsPids,
	pidsOnPorts,
	portSpec,
	REAP_BUDGET_MS,
	reapPorts,
	SWEEP_TIMEOUT_MS,
	TEARDOWN_HOOK_TIMEOUT_MS,
} from "./port-reaper";

const RANGE = [19222, 19223, 19224, 19225];

const OWNER = 1000;

interface Recorder extends PortReaperDeps {
	specs: string[];
	kills: Array<{ pid: number; signal?: string }>;
	clock: number;
	tree: Map<number, number>;
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
		tree: new Map(holders.flat().map(pid => [pid, OWNER])),
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
		// Every scripted holder is a direct child of the owner PID unless a test says otherwise.
		processTree: async () => state.tree,
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
		const result = await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "descendants", of: [OWNER] } }, deps);
		expect(result.heldPids).toEqual([]);
		expect(deps.kills).toEqual([]);
		expect(deps.specs).toHaveLength(1);
	});

	it("signals a holder, then escalates to SIGKILL on the next poll", async () => {
		const deps = recorder([[4242], [4242], []]);
		const result = await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "descendants", of: [OWNER] } }, deps);
		expect(result.heldPids).toEqual([]);
		expect(deps.kills.map(k => k.signal)).toEqual(["SIGTERM", "SIGKILL"]);
	});

	// The failure mode being fixed: the old loop's cost was unbounded in wall-clock terms, so it
	// overran the hook timeout instead of reporting anything.
	it("gives up at its wall-clock budget rather than running for a fixed iteration count", async () => {
		const deps = recorder([[4242]]);
		const result = await reapPorts(
			RANGE,
			{ budgetMs: 500, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } },
			deps,
		);
		expect(result.elapsedMs).toBeLessThanOrEqual(600);
		// ~5 polls at 100ms, not 50.
		expect(deps.specs.filter(s => s.includes("-")).length).toBeLessThanOrEqual(7);
	});

	it("names the holding PIDs when the budget runs out", async () => {
		const deps = recorder([[4242]]);
		const result = await reapPorts(
			RANGE,
			{ budgetMs: 200, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } },
			deps,
		);
		expect(result.heldPids).toEqual([4242]);
	});

	// The diagnostic must not pay for more subprocesses after the budget is already blown: that tail
	// was unbounded, so a slow lsof could still overrun the hook timeout this change exists to stop.
	it("spawns nothing extra to build its failure diagnostic", async () => {
		const deps = recorder([[4242]]);
		await reapPorts(RANGE, { budgetMs: 200, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } }, deps);
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

describe("parseSsPids", () => {
	it("extracts and de-duplicates listener PIDs", () => {
		expect(
			parseSsPids('LISTEN 0 511 127.0.0.1:24567 0.0.0.0:* users:(("bun",pid=4242,fd=11),("bun",pid=4242,fd=12))\n'),
		).toEqual([4242]);
	});

	it("ignores output without process metadata", () => {
		expect(parseSsPids("LISTEN 0 4096 127.0.0.1:24567 0.0.0.0:*\n")).toEqual([]);
	});
});

// A sweep that cannot answer is not evidence the ports are free. Under exactly the load this change
// targets, treating it as success would leave a live worker bound for the next test (#2463).
describe("reapPorts with an indeterminate sweep", () => {
	it("never reports success when no sweep could answer", async () => {
		const deps = recorder([[]], true);
		const result = await reapPorts(
			RANGE,
			{ budgetMs: 300, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } },
			deps,
		);
		expect(result.indeterminate).toBe(true);
		expect(result.heldPids).toEqual([]);
	});

	it("keeps polling rather than exiting early on one bad sweep", async () => {
		const deps = recorder([[]], true);
		await reapPorts(RANGE, { budgetMs: 300, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } }, deps);
		expect(deps.specs.length).toBeGreaterThan(1);
	});

	it("reports success only when a sweep actually answered", async () => {
		const deps = recorder([[]]);
		const result = await reapPorts(RANGE, { budgetMs: 300, ownership: { kind: "descendants", of: [OWNER] } }, deps);
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

// A private port window makes a collision unlikely; refusing to signal anything we did not start is
// what makes acting on one impossible. Killing a stranger's process was the original hazard.
describe("reapPorts ownership", () => {
	it("signals a holder that descends from an owned PID", async () => {
		const deps = recorder([[4242], []]);
		deps.tree = new Map([
			[4242, 777],
			[777, OWNER],
		]);
		const result = await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "descendants", of: [OWNER] } }, deps);
		expect(deps.kills.map(k => k.pid)).toEqual([4242]);
		expect(result.foreignPids).toEqual([]);
	});

	it("never signals a holder it does not own, and says so", async () => {
		const deps = recorder([[4242]]);
		deps.tree = new Map([[4242, 5]]); // someone else's process
		const result = await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "descendants", of: [OWNER] } }, deps);
		expect(deps.kills).toEqual([]);
		expect(result.foreignPids).toEqual([4242]);
		expect(result.heldPids).toEqual([]);
	});

	it("gives up immediately on a foreign holder rather than burning the budget", async () => {
		const deps = recorder([[4242]]);
		deps.tree = new Map([[4242, 5]]);
		const result = await reapPorts(
			RANGE,
			{ budgetMs: 10_000, pollMs: 100, ownership: { kind: "descendants", of: [OWNER] } },
			deps,
		);
		expect(result.elapsedMs).toBe(0);
	});
});

describe("isOwned", () => {
	it("matches the PID itself and any descendant", () => {
		const tree = new Map([
			[30, 20],
			[20, 10],
		]);
		expect(isOwned(10, [10], tree)).toBe(true);
		expect(isOwned(30, [10], tree)).toBe(true);
		expect(isOwned(30, [99], tree)).toBe(false);
	});

	it("terminates on a cycle instead of hanging teardown", () => {
		const tree = new Map([
			[7, 8],
			[8, 7],
		]);
		expect(isOwned(7, [99], tree)).toBe(false);
	});
});

// Workers here are deliberately orphaned, so by teardown no parent survives for them to descend
// from — ancestry would call our own worker a stranger and refuse to reap it. Verifying the window
// was free before use is the ownership signal that actually holds.
describe("reapPorts with a verified window", () => {
	it("reaps a holder with no surviving ancestor", async () => {
		const deps = recorder([[4242], []]);
		deps.tree = new Map([[4242, 1]]); // reparented to init
		const result = await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "window-verified" } }, deps);
		expect(deps.kills.map(k => k.pid)).toEqual([4242]);
		expect(result.foreignPids).toEqual([]);
		expect(result.heldPids).toEqual([]);
	});

	it("asks for no process tree at all", async () => {
		let asked = false;
		const deps = recorder([[4242], []]);
		deps.processTree = async () => {
			asked = true;
			return new Map();
		};
		await reapPorts(RANGE, { budgetMs: 3000, ownership: { kind: "window-verified" } }, deps);
		expect(asked).toBe(false);
	});
});
