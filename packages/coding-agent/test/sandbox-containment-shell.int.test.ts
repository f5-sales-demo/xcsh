import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell } from "@f5-sales-demo/pi-natives";
import { buildContainmentFence, containmentStatus } from "@f5-sales-demo/xcsh/sandbox/containment";

/**
 * Whether an OS-level backend exists here, taken from the product rather than from a platform check
 * written in the test. Confining a spawned child needs the kernel, and today only macOS seatbelt
 * provides that — Linux Landlock is #2572. Asking `containmentStatus` means the tests and
 * `xcsh://about` cannot disagree about which platforms are actually enforced.
 */
const OS_ENFORCED = containmentStatus(true).osEnforced;

/**
 * Enforcement through the real shell, not through the text scanner.
 *
 * This is the test that justifies Phase 2 (#2554). The host's text layer had to recognise every
 * spelling of a path, and it could not: `c=cd; $c …`, an alias, and a symlink created moments earlier
 * all survived two adversarial review rounds and six patches (#2542, #2553). None of them is
 * special-cased here. They fail because brush-core has already expanded the variable, resolved the
 * alias and followed the symlink by the time the fence is consulted, so there is nothing left to spell
 * differently.
 *
 * If a case below starts passing where it should be refused, that is a sandbox escape.
 */
describe("containment enforced inside the shell", () => {
	let home: string;
	let workspace: string;
	let sibling: string;
	let wire: { allow: string[]; allowReadOnly: string[]; allowWriteOnly: string[]; deny: string[] };

	beforeAll(() => {
		home = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "contain-")));
		workspace = path.join(home, "GIT", "custA");
		sibling = path.join(home, "GIT", "custB");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(sibling, { recursive: true });
		fs.writeFileSync(path.join(sibling, "secret.txt"), "CUSTB-CANARY-9001\n");
		const fence = buildContainmentFence({ workspace, home });
		wire = {
			allow: [...fence.allow],
			allowReadOnly: [...fence.allowReadOnly],
			allowWriteOnly: [...fence.allowWriteOnly],
			deny: [...fence.deny],
		};
	});

	afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

	async function run(command: string, fenced = true): Promise<{ code: number; text: string }> {
		let out = "";
		const result = (await executeShell({ command, cwd: workspace, fence: fenced ? wire : undefined }, (_e, c) => {
			out += c ?? "";
		})) as { exitCode?: number; output?: string };
		return { code: result?.exitCode ?? -1, text: out + (result?.output ?? "") };
	}

	it("leaks the canary with no fence — the control that proves the fence is what stops it", async () => {
		const { code, text } = await run("cd ../custB && cat secret.txt", false);
		expect(code).toBe(0);
		expect(text).toContain("CUSTB-CANARY-9001");
	});

	it("refuses a cd out of the tree, however it is spelled", async () => {
		// Plain, then the three forms the text gate could not reach (#2553).
		for (const command of [
			"cd ../custB && cat secret.txt",
			"c=cd; $c ../custB && cat secret.txt",
			"eval 'cd ../custB' && cat secret.txt",
			"ln -sfn ../custB piv && cd -P piv && cat secret.txt",
			"builtin cd ../custB && cat secret.txt",
			"pushd ../custB && cat secret.txt",
		]) {
			const { code, text } = await run(command);
			expect(code).not.toBe(0);
			expect(text).not.toContain("CUSTB-CANARY-9001");
		}
	});

	it("refuses a redirect out of the tree, with the filesystem as proof", async () => {
		const target = path.join(sibling, "written.txt");
		const { code } = await run("printf pwned > ../custB/written.txt");
		expect(code).not.toBe(0);
		expect(fs.existsSync(target)).toBe(false);
	});

	/**
	 * The external-command case, which the in-process fence alone cannot reach.
	 *
	 * `cat` opens the file in its own address space, so no check the shell performs can stop it. This
	 * is the OS layer: on macOS the argv is wrapped with `sandbox-exec` carrying a profile compiled
	 * from the same fence. The refusal therefore comes from the kernel, not from reading the command.
	 *
	 * Which way this asserts is decided by the product's own `containmentStatus`, not by a platform
	 * check written here. Where no backend exists the child genuinely is not confined, and the test says
	 * so rather than skipping: a skipped test reads as "covered", and this gap is the one thing about
	 * this feature that must not be quietly implied to be closed. When a Linux backend lands, this
	 * assertion starts failing and has to be flipped — which is how it should be found.
	 */
	it(`${OS_ENFORCED ? "refuses" : "cannot yet refuse"} an external command reading outside the tree`, async () => {
		const { code, text } = await run(`cat ${path.join(sibling, "secret.txt")}`);
		if (OS_ENFORCED) {
			expect(code).not.toBe(0);
			expect(text).not.toContain("CUSTB-CANARY-9001");
		} else {
			expect(text).toContain("CUSTB-CANARY-9001");
		}
	});

	// The canary must be unreachable however the command is built, now that the child itself is
	// confined. None of these is special-cased anywhere.
	it(`${OS_ENFORCED ? "refuses" : "cannot yet refuse"} every external read route to the sibling`, async () => {
		// Every route asserts in both directions. A gate that removes the assertion instead leaves a
		// test that passes while checking nothing — which is a worse report than a skip, because it
		// looks like coverage of the one gap that is open.
		for (const command of [
			`head -1 ${path.join(sibling, "secret.txt")}`,
			`sh -c 'cat ${path.join(sibling, "secret.txt")}'`,
			// `\;` escaped, not a bare `;`. Unescaped, the shell takes the semicolon as a separator and
			// `find` dies on "missing argument to -exec" — so this route printed nothing and satisfied a
			// `not.toContain` assertion without ever exercising the boundary.
			`find ${sibling} -name secret.txt -exec cat {} \\;`,
		]) {
			const { text } = await run(command);
			if (OS_ENFORCED) expect(text).not.toContain("CUSTB-CANARY-9001");
			else expect(text).toContain("CUSTB-CANARY-9001");
		}
		// `cp` is the one route whose result is on disk either way, so it needs no branch in the check.
		await run(`cp ${path.join(sibling, "secret.txt")} .`);
		expect(fs.existsSync(path.join(workspace, "secret.txt"))).toBe(!OS_ENFORCED);
	});

	// A redirect is opened by the shell itself, in-process, so this one is refused on every platform —
	// it does not depend on there being an OS backend at all.
	it("refuses a redirect that writes outside the tree, with or without an OS backend", async () => {
		const planted = path.join(sibling, "via-redirect.txt");
		const { text } = await run(`printf leak > ${planted}`);
		expect(text).not.toContain("CUSTB-CANARY-9001");
		expect(fs.existsSync(planted)).toBe(false);
	});

	// The fence must cost nothing operationally. A failure here is as serious as a missed escape:
	// it means the assistant cannot do its job.
	it("leaves ordinary in-tree work alone", async () => {
		const inTree = await run("printf ok > in-tree.txt && cat in-tree.txt");
		expect(inTree.code).toBe(0);
		expect(inTree.text).toContain("ok");

		const nested = await run("mkdir -p sub && cd sub && printf deep > f.txt && cat f.txt");
		expect(nested.code).toBe(0);
		expect(nested.text).toContain("deep");

		const devnull = await run("printf x > /dev/null && echo devnull-ok");
		expect(devnull.code).toBe(0);
		expect(devnull.text).toContain("devnull-ok");

		// System paths are never mentioned by the fence, so reading one is untouched.
		const system = await run("ls /usr/bin/env && echo system-ok");
		expect(system.code).toBe(0);
		expect(system.text).toContain("system-ok");

		// A glued metacharacter after a redirect target — the #2540 shape — is the shell's problem
		// now, not a regex's.
		const glued = await run("printf hello >/dev/null; echo glued-ok");
		expect(glued.code).toBe(0);
		expect(glued.text).toContain("glued-ok");
	});

	/**
	 * A directory name may contain any byte except `/` and NUL, so a shell can create one holding a
	 * quote or a newline. Both end up inside the generated seatbelt profile.
	 *
	 * Escaping the quote is what makes injection impossible — verified against `sandbox-exec` that an
	 * unescaped `x"))\n(allow default)…` name grants itself `(allow default)` and reads a denied file.
	 * Escaping the newline is what stops the fail-closed case being an outage: a raw newline breaks
	 * the profile, so one oddly-named directory would make every fenced command fail.
	 */
	it("survives a workspace path containing shell-hostile characters", async () => {
		const odd = path.join(workspace, 'we"ird\nname');
		fs.mkdirSync(odd, { recursive: true });
		const oddFence = buildContainmentFence({ workspace: odd, home });
		const oddWire = {
			allow: [...oddFence.allow],
			allowReadOnly: [...oddFence.allowReadOnly],
			allowWriteOnly: [...oddFence.allowWriteOnly],
			deny: [...oddFence.deny],
		};
		let out = "";
		const result = (await executeShell(
			{ command: "printf ok > f.txt && cat f.txt", cwd: odd, fence: oddWire },
			(_e, c) => {
				out += c ?? "";
			},
		)) as { exitCode?: number; output?: string };

		// The profile parsed and the command ran — not refused with "Operation not permitted".
		expect(result?.exitCode).toBe(0);
		expect(out + (result?.output ?? "")).toContain("ok");
		// And the fence still holds from there. Probed with a `cd`, which the shell refuses itself, so
		// this stays a real assertion on platforms with no OS backend — an external read would only be
		// refused where seatbelt exists, and would have made this case vacuous off macOS.
		let denied = "";
		const stillFenced = (await executeShell(
			{ command: `cd ${path.join(sibling)} && cat secret.txt`, cwd: odd, fence: oddWire },
			(_e, c) => {
				denied += c ?? "";
			},
		)) as { exitCode?: number; output?: string };
		expect(stillFenced?.exitCode).not.toBe(0);
		expect(denied + (stillFenced?.output ?? "")).not.toContain("CUSTB-CANARY-9001");
	});

	it("restricts nothing at all when no fence is supplied", async () => {
		// Host-driven shell use — credential helpers, `xcsh shell`, user `!cmd`, RPC bash — passes no
		// fence and must behave exactly as before.
		const { code, text } = await run(`cat ${path.join(sibling, "secret.txt")}`, false);
		expect(code).toBe(0);
		expect(text).toContain("CUSTB-CANARY-9001");
	});
});

/**
 * Glob expansion runs in the agent's own process, not in a confined child, so the OS layer does not
 * cover it. Verified before the fix: `echo ../*` disclosed a sibling checkout's name. Contents were
 * always protected — a name is a smaller leak than a file, and still one the session should not have.
 */
describe("glob expansion does not disclose names outside the fence", () => {
	let base: string;
	let workspace: string;
	let wire: { allow: string[]; allowReadOnly: string[]; allowWriteOnly: string[]; deny: string[] };

	beforeAll(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "glob-")));
		workspace = path.join(base, "customer-a");
		fs.mkdirSync(workspace);
		fs.mkdirSync(path.join(base, "SIBLING-MARKER"));
		fs.writeFileSync(path.join(workspace, "mine.txt"), "x");
		const fence = buildContainmentFence({ workspace });
		wire = {
			allow: [...fence.allow],
			allowReadOnly: [...fence.allowReadOnly],
			allowWriteOnly: [...fence.allowWriteOnly],
			deny: [...fence.deny],
		};
	});

	afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

	async function glob(command: string): Promise<string> {
		let out = "";
		await executeShell({ command, cwd: workspace, fence: wire }, (_e, c) => {
			out += c ?? "";
		});
		return out;
	}

	it("hides a sibling's name from a glob that reaches outside", async () => {
		expect(await glob("echo ../*")).not.toContain("SIBLING-MARKER");
		expect(await glob("echo ../SIB*")).not.toContain("SIBLING-MARKER");
	});

	it("still expands globs inside the workspace", async () => {
		expect(await glob("echo *")).toContain("mine.txt");
		expect(await glob("for f in *.txt; do echo $f; done")).toContain("mine.txt");
	});
});
