import { describe, expect, test } from "bun:test";
import {
	recycleOfficeServe,
	type ServeLifecycleDeps,
	supersedeStaleServe,
} from "../../src/browser/office-serve-lifecycle";

/**
 * Build deps where `pidListeningOn` returns each element of `pids` on successive
 * calls (last value repeats). `signal` records calls; `isOfficeServe` is fixed.
 */
function fakeDeps(pids: number[], isOffice: boolean) {
	const signalled: Array<{ pid: number; sig: string }> = [];
	let i = 0;
	const deps: ServeLifecycleDeps = {
		pidListeningOn: () => pids[Math.min(i++, pids.length - 1)] ?? 0,
		isOfficeServe: () => isOffice,
		signal: (pid, sig) => signalled.push({ pid, sig: String(sig) }),
		sleep: async () => {},
	};
	return { deps, signalled };
}

describe("supersedeStaleServe", () => {
	test("no holder → no-op, nothing signalled", async () => {
		const { deps, signalled } = fakeDeps([0], true);
		const r = await supersedeStaleServe(8444, deps);
		expect(r).toEqual({ superseded: false });
		expect(signalled).toHaveLength(0);
	});

	test("a stale office serve → SIGTERM, waits for the port to free, reports superseded", async () => {
		// First probe finds PID 9739 (holder); after the signal the port frees (0).
		const { deps, signalled } = fakeDeps([9739, 9739, 0], true);
		const r = await supersedeStaleServe(8444, deps);
		expect(r).toEqual({ superseded: true, pid: 9739 });
		expect(signalled).toEqual([{ pid: 9739, sig: "SIGTERM" }]);
	});

	test("a NON-office holder is reported and NEVER signalled", async () => {
		const { deps, signalled } = fakeDeps([4321], false);
		await expect(supersedeStaleServe(8444, deps)).rejects.toThrow(/isn't an xcsh office serve/);
		expect(signalled).toHaveLength(0);
	});

	test("a holder that never releases the port → timeout error (after signalling)", async () => {
		const { deps, signalled } = fakeDeps([9739], true); // always the same pid
		await expect(supersedeStaleServe(8444, deps)).rejects.toThrow(/release port 8444/);
		expect(signalled).toEqual([{ pid: 9739, sig: "SIGTERM" }]);
	});
});

describe("recycleOfficeServe", () => {
	test("no serve running → clear no-op message, nothing signalled", async () => {
		const { deps, signalled } = fakeDeps([0], true);
		const msg = await recycleOfficeServe(8444, deps);
		expect(msg).toMatch(/No xcsh office serve is running/i);
		expect(signalled).toHaveLength(0);
	});

	test("a running office serve → SIGTERM + confirmation once the port frees", async () => {
		const { deps, signalled } = fakeDeps([9739, 0], true);
		const msg = await recycleOfficeServe(8444, deps);
		expect(msg).toMatch(/Stopped the running office serve/i);
		expect(signalled).toEqual([{ pid: 9739, sig: "SIGTERM" }]);
	});

	test("a foreign holder is left alone (not signalled)", async () => {
		const { deps, signalled } = fakeDeps([4321], false);
		const msg = await recycleOfficeServe(8444, deps);
		expect(msg).toMatch(/isn't an xcsh office serve/i);
		expect(signalled).toHaveLength(0);
	});
});
