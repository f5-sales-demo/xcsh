import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell } from "@f5-sales-demo/pi-natives";
import { buildContainmentFence } from "../src/sandbox/containment";

/**
 * The fence has to hold against a path that changes while it is being checked.
 *
 * brush-core runs *inside* the agent process, so its own opens — redirections, `source`, the `read`
 * builtin — are not covered by the OS confinement that protects spawned children. That makes them the
 * one place where checking a path and then acting on it can be raced, and both of the races below were
 * observed leaking a sibling checkout's secret before the code was changed:
 *
 * - swapping the final component (a symlink): 1 leak in 250 attempts
 * - swapping a directory component: 23 leaks in 600 attempts
 *
 * The counts matter more than the mechanism. A refusal rate of 99% reads exactly like a working
 * boundary from the outside, which is why these are measured over many attempts rather than asserted
 * once. Each case also asserts the fence refused *something*, so a run where the attack never got near
 * the window cannot pass as a defence.
 *
 * The equivalent attack against a spawned command (`cat sub/secret.txt`) never leaked at any point:
 * seatbelt decides in the kernel, where there is no window. Only the in-process opens needed fixing.
 */
describe("containment holds while the path is being swapped underneath it", () => {
	const ATTEMPTS = 200;
	let home: string;
	let workspace: string;
	let wire: {
		allow: string[];
		allowReadOnly: string[];
		allowWriteOnly: string[];
		deny: string[];
		denyEnumerate: string[];
	};

	beforeAll(() => {
		home = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "race-")));
		workspace = path.join(home, "GIT", "custA");
		const sibling = path.join(home, "GIT", "custB");
		fs.mkdirSync(path.join(workspace, "sub"), { recursive: true });
		fs.mkdirSync(sibling, { recursive: true });
		fs.writeFileSync(path.join(sibling, "secret.txt"), "RACE-CANARY-3141\n");
		fs.writeFileSync(path.join(workspace, "sub", "secret.txt"), "harmless-sub\n");
		fs.writeFileSync(path.join(workspace, "ok.txt"), "harmless\n");

		// One long-lived flipper, not one spawn per flip. A flip every few microseconds against a
		// check-to-open window of the same order is what makes the race winnable; `ln` in a loop costs
		// ~200ms per flip under the sandbox and never lands inside the window.
		fs.writeFileSync(
			path.join(workspace, "flip-link.py"),
			[
				"import os, sys",
				"ok, bad, link = sys.argv[1], sys.argv[2], sys.argv[3]",
				"tmp = link + '.tmp'",
				"while True:",
				"    for target in (ok, bad):",
				"        try:",
				"            os.symlink(target, tmp); os.replace(tmp, link)",
				"        except OSError:",
				"            try: os.unlink(tmp)",
				"            except OSError: pass",
				"",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(workspace, "flip-dir.py"),
			[
				"import os, sys",
				"real, target = sys.argv[1], sys.argv[2]",
				"stash = real + '.real'",
				"while True:",
				"    try:",
				"        os.rename(real, stash); os.symlink(target, real)",
				"    except OSError: pass",
				"    try:",
				"        os.unlink(real); os.rename(stash, real)",
				"    except OSError: pass",
				"",
			].join("\n"),
		);

		// The race contract still needs a recursively denied target. Production sibling paths are named
		// access now, so classify this synthetic target as a cross-session leak root for the test.
		const fence = buildContainmentFence({ workspace, home, leakRoots: [sibling] });
		wire = {
			allow: [...fence.allow],
			allowReadOnly: [...fence.allowReadOnly],
			allowWriteOnly: [...fence.allowWriteOnly],
			deny: [...fence.deny],
			denyEnumerate: [...fence.denyEnumerate],
		};
	});

	afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

	/**
	 * Put the bait back exactly as each attack expects to find it.
	 *
	 * The flippers are killed mid-cycle, so they leave `sub` renamed aside or replaced by a symlink.
	 * Without this reset the next attack's every iteration failed instantly on a broken path — 200
	 * iterations in 252ms, no refusals and no leaks, which is indistinguishable from a fence that
	 * worked. That is what `refusals > 0` in each case is guarding against.
	 */
	function resetBait(): void {
		for (const leftover of ["sub", "sub.real", "sub.tmp", "pivot", "pivot.tmp"]) {
			fs.rmSync(path.join(workspace, leftover), { recursive: true, force: true });
		}
		fs.mkdirSync(path.join(workspace, "sub"), { recursive: true });
		fs.writeFileSync(path.join(workspace, "sub", "secret.txt"), "harmless-sub\n");
	}

	async function attack(command: string): Promise<{ leaks: number; refusals: number }> {
		resetBait();
		let out = "";
		const result = (await executeShell({ command, cwd: workspace, fence: wire }, (_e, c) => {
			out += c ?? "";
		})) as { output?: string };
		const text = out + (result?.output ?? "");
		return {
			leaks: (text.match(/RACE-CANARY-3141/g) ?? []).length,
			refusals: (text.match(/outside this session's boundary|changed underneath/g) ?? []).length,
		};
	}

	it("does not leak when the final component is swapped mid-check", async () => {
		const { leaks, refusals } = await attack(`
			ln -sfn ok.txt pivot
			python3 flip-link.py ok.txt ../custB/secret.txt pivot & flip=$!
			i=0; while [ $i -lt ${ATTEMPTS} ]; do cat < pivot 2>/dev/null; i=$((i+1)); done
			kill $flip 2>/dev/null
		`);
		expect(leaks).toBe(0);
		expect(refusals).toBeGreaterThan(0);
	}, 180_000);

	it("does not leak when a directory component is swapped mid-check", async () => {
		const { leaks, refusals } = await attack(`
			python3 flip-dir.py sub ../custB & flip=$!
			i=0; while [ $i -lt ${ATTEMPTS} ]; do cat < sub/secret.txt 2>/dev/null; i=$((i+1)); done
			kill $flip 2>/dev/null
		`);
		expect(leaks).toBe(0);
		expect(refusals).toBeGreaterThan(0);
	}, 180_000);

	// The `read` builtin consumes the descriptor without any child process, so nothing but the
	// in-process check stands between it and the file. It leaked the most before the fix (23 in 600).
	it("does not leak to a builtin, which no OS confinement covers", async () => {
		const { leaks, refusals } = await attack(`
			python3 flip-dir.py sub ../custB & flip=$!
			i=0; while [ $i -lt ${ATTEMPTS} ]; do read line < sub/secret.txt 2>/dev/null && echo "$line"; i=$((i+1)); done
			kill $flip 2>/dev/null
		`);
		expect(leaks).toBe(0);
		expect(refusals).toBeGreaterThan(0);
	}, 180_000);
});
