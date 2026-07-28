import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { buildContainmentFence, containmentStatus } from "@f5-sales-demo/xcsh/sandbox/containment";

/**
 * The PTY path runs the system `sh`, so *only* the OS can confine it — there is no in-process half here
 * to fall back on. Where no backend exists, this path is not confined at all, and these tests assert
 * that rather than skipping, for the same reason as in the shell integration test: a skip reads as
 * coverage, and this is the gap that must not be implied to be closed.
 */
const OS_ENFORCED = containmentStatus(true).osEnforced;

/**
 * The bash tool has two execution paths, and containment has to cover both.
 *
 * `pty` is a parameter the *model* supplies (`bash.ts` tool schema), so "PTY mode is for sudo and
 * ssh" is a description of intent, not a restriction. Whatever the parameter is for, setting it is
 * the model's choice, and a boundary the caller can opt out of by passing a flag is not a boundary.
 *
 * This path does not run brush-core at all: it spawns the system `sh -lc` through a PTY, so neither
 * the in-process fence nor anything brush-core does applies. Confinement here can only come from the
 * OS, which is why the assertion is about the canary and not about an error message.
 */
describe("containment covers the PTY path, not just the in-process shell", () => {
	let home: string;
	let workspace: string;
	let sibling: string;
	let wire: { allow: string[]; allowReadOnly: string[]; allowWriteOnly: string[]; deny: string[] };

	beforeAll(() => {
		home = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pty-contain-")));
		workspace = path.join(home, "GIT", "custA");
		sibling = path.join(home, "GIT", "custB");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(sibling, { recursive: true });
		fs.writeFileSync(path.join(sibling, "secret.txt"), "PTY-CANARY-7734\n");
		const fence = buildContainmentFence({ workspace, home });
		wire = {
			allow: [...fence.allow],
			allowReadOnly: [...fence.allowReadOnly],
			allowWriteOnly: [...fence.allowWriteOnly],
			deny: [...fence.deny],
		};
	});

	afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

	async function runPty(command: string, fenced: boolean): Promise<string> {
		const session = new PtySession();
		let out = "";
		await session.start(
			{
				command,
				cwd: workspace,
				cols: 80,
				rows: 24,
				timeoutMs: 15_000,
				...(fenced ? { fence: wire } : {}),
			},
			(_err: Error | null, chunk: string) => {
				out += chunk ?? "";
			},
		);
		return out;
	}

	it("leaks the canary with no fence — the control that proves the fence is what stops it", async () => {
		expect(await runPty(`cat ${sibling}/secret.txt`, false)).toContain("PTY-CANARY-7734");
	});

	it(`${OS_ENFORCED ? "does not leak" : "still leaks"} a sibling checkout through the PTY path`, async () => {
		const out = await runPty(`cat ${sibling}/secret.txt`, true);
		if (OS_ENFORCED) expect(out).not.toContain("PTY-CANARY-7734");
		else expect(out).toContain("PTY-CANARY-7734");
	});

	// The env-supplied path is the specific case the text scanner cannot see, and the reason a
	// scanner-only PTY path was a hole rather than a rough edge.
	it(`${OS_ENFORCED ? "does not leak" : "still leaks"} through a path assembled at runtime`, async () => {
		const out = await runPty(`T=${sibling}/secret.txt; cat "$T"`, true);
		if (OS_ENFORCED) expect(out).not.toContain("PTY-CANARY-7734");
		else expect(out).toContain("PTY-CANARY-7734");
	});

	it("still runs ordinary work inside the workspace", async () => {
		fs.writeFileSync(path.join(workspace, "own.txt"), "MINE-4242\n");
		expect(await runPty("cat own.txt", true)).toContain("MINE-4242");
	});

	/**
	 * Containment must be quiet as well as correct.
	 *
	 * A login shell reads its startup files from the home directory, which the fence denies, so every
	 * fenced command used to print `sh: /Users/…/.profile: Operation not permitted` before going on to
	 * succeed. That line reached the user's terminal and the model's captured output, where it reads as
	 * a failure — and a boundary that appears to break things is one an operator turns off.
	 *
	 * The fence here uses the *real* home, because that is what makes the startup files denied. Using a
	 * temp home would leave nothing for the shell to be refused, and the test would pass while the
	 * product still emitted the error.
	 */
	it("says nothing about the home directory it cannot read", async () => {
		const realHome = fs.realpathSync(os.homedir());
		const outside = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pty-quiet-")));
		const realFence = buildContainmentFence({ workspace: outside, home: realHome });
		const session = new PtySession();
		let out = "";
		await session.start(
			{
				command: "echo QUIET-5150",
				cwd: outside,
				cols: 80,
				rows: 24,
				timeoutMs: 20_000,
				fence: {
					allow: [...realFence.allow],
					allowReadOnly: [...realFence.allowReadOnly],
					allowWriteOnly: [...realFence.allowWriteOnly],
					deny: [...realFence.deny],
				},
			},
			(_err: Error | null, chunk: string) => {
				out += chunk ?? "";
			},
		);
		fs.rmSync(outside, { recursive: true, force: true });

		// Assert the command ran, so a shell that produced nothing at all cannot pass by being silent.
		expect(out).toContain("QUIET-5150");
		expect(out).not.toContain("Operation not permitted");
		expect(out).not.toContain(".profile");
	});
});
