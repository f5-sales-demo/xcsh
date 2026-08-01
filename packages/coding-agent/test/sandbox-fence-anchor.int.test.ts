import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import type { ToolSession } from "../src/tools";
import { BashTool } from "../src/tools/bash";

/**
 * Can the model move the boundary it is inside?
 *
 * The fence was rebuilt from `session.cwd` on every call, and the bash tool writes the command's
 * resulting PWD back into that field. So a `cd` the fence permits — and it does permit `cd /usr`, because
 * `/usr` is not sensitive and the fence is deliberately gentle — silently re-rooted the *next* fence.
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

	it("keeps the original parent non-enumerable after a cd out of the tree", async () => {
		// Control: the parent cannot be scanned before relocation. Both children exist, so an ordinary
		// listing would necessarily disclose these synthetic workspace names.
		const before = await run(`ls ${work}`);
		expect(before).not.toContain("custA");
		expect(before).not.toContain("custB");

		// The relocation attempt. `cd /usr` is *expected* to succeed — the fence does not confine the cwd,
		// it denies specific trees — so this asserts nothing about the cd itself.
		await run("c=cd; $c /usr");

		// The actual property: the boundary did not travel with the shell.
		const after = await run(`ls ${work}`);
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
