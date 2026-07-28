import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import type { ToolSession } from "@f5-sales-demo/xcsh/tools";
import { BashTool } from "@f5-sales-demo/xcsh/tools/bash";

/**
 * Can the model move the boundary it is inside?
 *
 * The fence was rebuilt from `session.cwd` on every call, and the bash tool writes the command's
 * resulting PWD back into that field. So a `cd` the fence permits — and it does permit `cd /usr`, because
 * `/usr` is not sensitive and the fence is deliberately gentle — silently re-rooted the *next* fence.
 *
 * That mattered because the deny that isolates one customer from another is derived from the workspace's
 * parent. Re-rooted at `/usr`, there is no expressible parent deny: `dirname("/usr")` is `/`, and denying
 * the filesystem root is refused as too broad. Measured before the fix, with customers outside the home
 * tree: `/work/custB/secret.env` was denied, and after `cd /usr` it was readable *and* writable.
 *
 * Two tool calls, no exotic spelling, and cross-tenant isolation was gone. This is the regression test.
 *
 * The workspace deliberately sits outside `$HOME`, because that is the layout the sibling-checkout deny
 * exists for — with customers *under* home the home deny happens to survive the relocation and hides the
 * bug entirely.
 */
describe("the containment boundary cannot be relocated by the model", () => {
	const CANARY = "TOKEN=ANCHOR-CANARY-6120";
	let work: string;
	let custA: string;
	let custB: string;
	let session: ToolSession;
	let bash: BashTool;

	beforeEach(() => {
		work = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "anchor-work-")));
		custA = path.join(work, "custA");
		custB = path.join(work, "custB");
		fs.mkdirSync(custA);
		fs.mkdirSync(custB);
		fs.writeFileSync(path.join(custB, "secret.env"), `${CANARY}\n`);
		fs.writeFileSync(path.join(custA, "notes.md"), "mine\n");

		session = {
			cwd: custA,
			hasUI: false,
			getArtifactsDir: () => path.join(custA, ".artifacts"),
			settings: Settings.isolated({ "sandbox.enabled": true }),
		} as unknown as ToolSession;
		bash = new BashTool(session);
	});

	afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

	async function run(command: string): Promise<string> {
		try {
			const result = (await bash.execute(`call-${Math.random()}`, { command })) as {
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

	it("keeps the sibling checkout unreachable after a cd out of the tree", async () => {
		// Control: the sibling is denied to begin with. Without this, the assertion below could pass on a
		// session that was never fenced at all.
		expect(await run(`cat ${path.join(custB, "secret.env")}`)).not.toContain(CANARY);

		// The relocation attempt. `cd /usr` is *expected* to succeed — the fence does not confine the cwd,
		// it denies specific trees — so this asserts nothing about the cd itself.
		await run("c=cd; $c /usr");

		// The actual property: the boundary did not travel with the shell.
		expect(await run(`cat ${path.join(custB, "secret.env")}`)).not.toContain(CANARY);
		expect(await run(`cat ${path.join(custB, "secret.env")}`)).not.toContain("ANCHOR-CANARY");
	}, 120_000);

	it("still cannot write into the sibling after the same cd", async () => {
		await run("c=cd; $c /usr");
		const planted = path.join(custB, "planted.env");
		await run(`printf pwned > ${planted}`);
		expect(fs.existsSync(planted)).toBe(false);
	}, 120_000);

	it("leaves ordinary work in the session's own tree alone", async () => {
		// The fix must not have pinned the boundary somewhere the session cannot work.
		expect(await run(`cat ${path.join(custA, "notes.md")}`)).toContain("mine");
		expect(
			await run(`printf ok > ${path.join(custA, "fresh.txt")} && cat ${path.join(custA, "fresh.txt")}`),
		).toContain("ok");
	}, 120_000);
});
