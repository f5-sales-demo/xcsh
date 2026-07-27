import { describe, expect, it } from "bun:test";
import { type PortReaperDeps, pidsOnPorts, portSpec, reapPorts } from "./port-reaper";

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
function recorder(holders: number[][]): Recorder {
	const state: Recorder = {
		specs: [],
		kills: [],
		clock: 0,
		listPids: async spec => {
			state.specs.push(spec);
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
		expect(result.heldPorts).toEqual([]);
		expect(deps.kills).toEqual([]);
		expect(deps.specs).toHaveLength(1);
	});

	it("signals a holder, then escalates to SIGKILL on the next poll", async () => {
		const deps = recorder([[4242], [4242], []]);
		const result = await reapPorts(RANGE, { budgetMs: 3000 }, deps);
		expect(result.heldPorts).toEqual([]);
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

	it("names the ports still held when the budget runs out", async () => {
		const deps = recorder([[4242]]);
		const result = await reapPorts(RANGE, { budgetMs: 200, pollMs: 100 }, deps);
		expect(result.heldPorts).toEqual(RANGE);
	});
});
