import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getShellPwd, setShellPwd } from "@f5-sales-demo/pi-utils";
import { Settings } from "../src/config/settings";
import { _resetShellSessionsForTest } from "../src/exec/bash-executor";
import { evaluateToolCall } from "../src/sandbox/enforce";
import { resolveSessionFence } from "../src/sandbox/session-fence";
import type { ToolSession } from "../src/tools";
import { BashTool } from "../src/tools/bash";
import { EventBus } from "../src/utils/event-bus";

/**
 * Every model bash call starts from the session root.
 *
 * The shared executor intentionally keeps shell state for operator `!cmd` commands. The model tool used
 * to copy that shell's final PWD into `session.cwd`, so a `cd` silently relocated every later tool call
 * and made the interface's only working-directory signal false (#2724).
 *
 * That matters because the enumeration deny that prevents sibling discovery is derived from the
 * workspace's parent. Re-rooted at `/usr`, there is no parent to protect: `dirname("/usr")` is `/`, and
 * refusing root enumeration is too broad. The boundary is a courtesy rather than a privilege boundary,
 * so named sibling reads and writes deliberately remain available; what must not move is the one parent
 * directory the session cannot scan.
 *
 * A directory change must not erase that discovery boundary. This is the regression test.
 *
 * The workspace deliberately sits outside `$HOME`, matching the sibling-checkout layout this rule covers.
 */
describe("the containment boundary cannot be relocated by the model", () => {
	const CANARY = "TOKEN=ANCHOR-CANARY-6120";
	let work: string;
	let custA: string;
	let custB: string;
	let session: ToolSession;
	let bash: BashTool;
	let originalShellPwd: string;
	let cwdEvents: string[];

	beforeEach(() => {
		work = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "anchor-work-")));
		custA = path.join(work, "custA");
		custB = path.join(work, "custB");
		fs.mkdirSync(custA);
		fs.mkdirSync(custB);
		fs.writeFileSync(path.join(custB, "secret.env"), `${CANARY}\n`);
		fs.writeFileSync(path.join(custA, "notes.md"), "mine\n");
		originalShellPwd = getShellPwd();
		setShellPwd(custA);
		cwdEvents = [];
		const eventBus = new EventBus();
		eventBus.on("cwd:changed", next => {
			if (typeof next === "string") cwdEvents.push(next);
		});

		session = {
			cwd: custA,
			hasUI: false,
			eventBus,
			getArtifactsDir: () => path.join(custA, ".artifacts"),
			getSessionId: () => "cwd-reset-test",
			settings: Settings.isolated({ "sandbox.enabled": true }),
		} as unknown as ToolSession;
		bash = new BashTool(session);
	});

	afterEach(() => {
		setShellPwd(originalShellPwd);
		_resetShellSessionsForTest();
		fs.rmSync(work, { recursive: true, force: true });
	});

	async function run(command: string, cwd?: string): Promise<string> {
		try {
			const result = (await bash.execute(`call-${Math.random()}`, { command, cwd })) as {
				content?: { type: string; text?: string }[];
			};
			return (result.content ?? [])
				.filter(block => block.type === "text")
				.map(block => block.text ?? "")
				.join("\n");
		} catch (error) {
			// A refusal arrives as a thrown ToolError; its message is a result, not a crash.
			return error instanceof Error ? error.message : String(error);
		}
	}

	it("discards a final cd before the next tool call", async () => {
		expect(await run("cd /usr && pwd")).toContain("/usr");
		expect(await run("pwd")).toContain(custA);
		expect(session.cwd).toBe(custA);
		expect(fs.realpathSync(getShellPwd())).toBe(custA);
		expect(cwdEvents).toEqual([]);

		const fence = resolveSessionFence(session.cwd, session.settings)!;
		const diagnostic = evaluateToolCall({
			toolName: "read",
			input: { file_path: work },
			cwd: session.cwd,
			fence,
		});
		expect(diagnostic.block).toBe(true);
		expect(diagnostic.reason).toContain(`working directory: ${custA}`);
	});

	it("keeps a cd within its call and resolves the next relative write at the session root", async () => {
		const subdir = path.join(custA, "subdir");
		fs.mkdirSync(subdir);

		expect(await run("cd subdir && printf inside > local.txt && pwd")).toContain(subdir);
		expect(fs.readFileSync(path.join(subdir, "local.txt"), "utf8")).toBe("inside");

		expect(await run("printf root > next.txt && pwd")).toContain(custA);
		expect(fs.readFileSync(path.join(custA, "next.txt"), "utf8")).toBe("root");
		expect(fs.existsSync(path.join(subdir, "next.txt"))).toBe(false);
	});

	it("scopes the cwd parameter to one call", async () => {
		const subdir = path.join(custA, "parameter-cwd");
		fs.mkdirSync(subdir);

		expect(await run("pwd", subdir)).toContain(subdir);
		expect(await run("pwd")).toContain(custA);
	});

	it("keeps the original parent non-enumerable after a cd out of the tree", async () => {
		// Brush expands the glob in-process, where the exact enumeration fence applies on every platform.
		// External Linux commands deliberately keep the operator's ordinary listing rights (#2952).
		const before = await run(`printf '%s\\n' ${work}/*`);
		expect(before).not.toContain("custA");
		expect(before).not.toContain("custB");

		// The relocation attempt. `cd /usr` is *expected* to succeed — the fence does not confine the cwd,
		// it denies specific trees — so this asserts nothing about the cd itself.
		await run("c=cd; $c /usr");

		// The actual property: the boundary did not travel with the shell.
		const after = await run(`printf '%s\\n' ${work}/*`);
		expect(after).not.toContain("custA");
		expect(after).not.toContain("custB");
	}, 120_000);

	it("preserves named sibling reads and writes after the same cd", async () => {
		await run("c=cd; $c /usr");
		expect(await run(`cat ${path.join(custB, "secret.env")}`)).toContain(CANARY);
		const planted = path.join(custB, "planted.env");
		await run(`printf pwned > ${planted}`);
		expect(fs.readFileSync(planted, "utf8")).toBe("pwned");
	}, 120_000);

	it("leaves ordinary work in the session's own tree alone", async () => {
		// The fix must not have pinned the boundary somewhere the session cannot work.
		expect(await run(`cat ${path.join(custA, "notes.md")}`)).toContain("mine");
		expect(
			await run(`printf ok > ${path.join(custA, "fresh.txt")} && cat ${path.join(custA, "fresh.txt")}`),
		).toContain("ok");
	}, 120_000);
});
