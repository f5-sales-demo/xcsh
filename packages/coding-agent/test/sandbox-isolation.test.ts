import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell } from "@f5-sales-demo/pi-natives";
import { getAgentDir, getPluginsDir, TempDir } from "@f5-sales-demo/pi-utils";
import { discoverAndLoadExtensions } from "@f5-sales-demo/xcsh/extensibility/extensions/loader";
import { getMemoryRoot } from "@f5-sales-demo/xcsh/memories";
import { buildContainmentFence, containmentStatus } from "@f5-sales-demo/xcsh/sandbox/containment";
import { evaluateToolCall } from "@f5-sales-demo/xcsh/sandbox/enforce";
import { resolveSessionFence } from "@f5-sales-demo/xcsh/sandbox/session-fence";

let tmp: TempDir;
let home: string;
let parent: string;
let custA: string;
let custB: string;

beforeAll(() => {
	tmp = TempDir.createSync("xcsh-sbx-iso-");
	// The customers live in a container *inside* home, which is the layout the fleet uses
	// (`~/MEDDPICC/<customer>`). They used to sit directly in `home`, and #2637 deliberately leaves that
	// case open — the siblings are in home, so nothing can read all of home and refuse them. Keeping the
	// old shape here would have asserted a protection that no longer exists.
	home = path.join(tmp.absolute(), "home");
	parent = path.join(home, "customers");
	custA = path.join(parent, "custA");
	custB = path.join(parent, "custB");
	fs.mkdirSync(custA, { recursive: true });
	fs.mkdirSync(custB, { recursive: true });
	fs.writeFileSync(path.join(custA, "notes.md"), "a");
	fs.writeFileSync(path.join(custB, "secret.env"), "TOKEN=b");
});

afterAll(() => tmp.removeSync());

/** Whether the `read` tool would be refused — the same fence the shell is confined by (#2624). */
function reads(cwd: string, filePath: string): boolean {
	const fence = resolveSessionFence(cwd, { get: () => undefined })!;
	return evaluateToolCall({ toolName: "read", input: { file_path: filePath }, cwd, fence }).block;
}

describe("two-customer isolation", () => {
	it("a session in custA cannot read custB, but can read its own files", () => {
		expect(reads(custA, path.join(custB, "secret.env"))).toBe(true);
		expect(reads(custA, path.join(custA, "notes.md"))).toBe(false);
	});

	it("a parent-folder session sees both customer subfolders (automatic)", () => {
		expect(reads(parent, path.join(custA, "notes.md"))).toBe(false);
		expect(reads(parent, path.join(custB, "secret.env"))).toBe(false);
	});

	// The pre-check and the kernel now consult one fence (#2624), so this asserts they agree rather than
	// that one is stricter. The `shellOsConfined` flag it used to pass is gone with the second policy —
	// there is no longer a version of this question whose answer depends on which backend is running.
	it("blocks Bash reads of custB from custA", () => {
		const fence = resolveSessionFence(custA, { get: () => undefined })!;
		const scan = (command: string) => evaluateToolCall({ toolName: "bash", input: { command }, cwd: custA, fence });

		for (const command of ["cat ../custB/secret.env", `cat ${path.join(custB, "secret.env")}`]) {
			expect(scan(command).block).toBe(true);
		}
		// …and the same fence permits the session's own tree, or the assertion above would hold for a
		// fence that refused everything.
		expect(scan("cat notes.md").block).toBe(false);
	});
});

describe("functionality preservation under the sandbox", () => {
	it("keeps the plugin cache readable (e.g. the meddpicc engine)", () => {
		expect(reads(custA, path.join(getPluginsDir(), "cache", "plugins", "meddpicc", "engine", "cli.ts"))).toBe(false);
	});

	it("keeps user-level skills readable", () => {
		expect(reads(custA, path.join(getAgentDir(), "skills", "account-planning", "SKILL.md"))).toBe(false);
	});

	// #2637: the operator's own dotfiles are theirs. What stays blocked is another customer's folder and
	// another session's state, asserted above and below.
	it("no longer blocks the operator's own home dotfiles", () => {
		expect(reads(custA, path.join(os.homedir(), ".ssh", "id_rsa"))).toBe(false);
	});
});

describe("memory isolation (belt-and-suspenders)", () => {
	it("partitions the memory store per working directory", () => {
		expect(getMemoryRoot(getAgentDir(), custA)).not.toBe(getMemoryRoot(getAgentDir(), custB));
	});

	it("does not expose any session's raw memory store to the file tools", () => {
		// The memory pipeline is an internal subsystem that bypasses the file-tool
		// boundary; the model-invoked tools cannot read the raw store for any cwd.
		expect(reads(custA, path.join(getMemoryRoot(getAgentDir(), custB), "MEMORY.md"))).toBe(true);
		expect(reads(custA, path.join(getMemoryRoot(getAgentDir(), custA), "MEMORY.md"))).toBe(true);
	});
});

describe("bundled registration", () => {
	it("loads the sandbox-guard extension by default", async () => {
		const result = await discoverAndLoadExtensions([], custA);
		expect(result.extensions.some(ext => ext.path === "bundled:sandbox-guard")).toBe(true);
	});
});

/**
 * The same two-customer scenario, proved at the enforcement layer rather than at the text scan.
 *
 * The cases above ask `evaluateToolCall` whether it would refuse a command. These run the command.
 * That distinction is the whole of #2554: the scanner reads what was written, while containment is
 * consulted where the shell acts, after expansion and symlink resolution. A scenario that only ever
 * asked the scanner would have passed throughout every escape in #2542 and #2553.
 */
describe("two-customer isolation, enforced in the shell", () => {
	// Taken from the product, not from a platform check written here, so this and `xcsh://about` cannot
	// disagree about which platforms actually confine a spawned child.
	const OS_ENFORCED = containmentStatus(true).osEnforced;

	function fenceFor(cwd: string) {
		const fence = buildContainmentFence({ workspace: cwd, home });
		return {
			allow: [...fence.allow],
			allowReadOnly: [...fence.allowReadOnly],
			allowWriteOnly: [...fence.allowWriteOnly],
			deny: [...fence.deny],
		};
	}

	async function shell(cwd: string, command: string, fenced = true) {
		let out = "";
		const result = (await executeShell({ command, cwd, fence: fenced ? fenceFor(cwd) : undefined }, (_e, c) => {
			out += c ?? "";
		})) as { exitCode?: number; output?: string };
		return { code: result?.exitCode ?? -1, text: out + (result?.output ?? "") };
	}

	/**
	 * Routes the shell itself closes, so they hold on every platform.
	 *
	 * `cd` is refused in-process, which takes the whole command down with it, and a redirect target is
	 * opened by the shell rather than by the child. Neither needs an OS backend, which is why they are
	 * asserted unconditionally.
	 */
	it("a session in custA cannot reach custB through anything the shell does itself", async () => {
		for (const command of [
			"cd ../custB && cat secret.env",
			"c=cd; $c ../custB && cat secret.env",
			`printf x > ${path.join(custB, "planted.env")}`,
		]) {
			const { text } = await shell(custA, command);
			expect(text).not.toContain("TOKEN=b");
		}
		expect(fs.existsSync(path.join(custB, "planted.env"))).toBe(false);
	});

	/**
	 * Routes where the *child* does the opening, so only the kernel can refuse them.
	 *
	 * Asserted according to the product's own `containmentStatus` rather than skipped off macOS: these
	 * reads really do succeed where no backend exists (#2572), and a skipped test would read as though
	 * they did not. This inverts and starts failing when Landlock lands, which is the point.
	 */
	it(`a session in custA ${OS_ENFORCED ? "cannot" : "can still"} reach custB through a spawned command`, async () => {
		// Both branches assert something. Gating the assertion away instead would leave a test that
		// passes while checking nothing, which reports as coverage of exactly the gap that is open.
		for (const command of ["cat ../custB/secret.env", `cat ${path.join(custB, "secret.env")}`]) {
			const { text } = await shell(custA, command);
			if (OS_ENFORCED) expect(text).not.toContain("TOKEN=b");
			else expect(text).toContain("TOKEN=b");
		}
		await shell(custA, `cp ${path.join(custB, "secret.env")} .`);
		expect(fs.existsSync(path.join(custA, "secret.env"))).toBe(!OS_ENFORCED);
	});

	it("but works normally inside its own folder", async () => {
		const own = await shell(custA, "cat notes.md && printf ' ok' >> notes.md && cat notes.md");
		expect(own.code).toBe(0);
		expect(own.text).toContain("a");
	});

	it("and the same session unfenced reaches custB — the control", async () => {
		const { code, text } = await shell(custA, `cat ${path.join(custB, "secret.env")}`, false);
		expect(code).toBe(0);
		expect(text).toContain("TOKEN=b");
	});
});

/**
 * Other operators' accounts are no longer fenced (#2637).
 *
 * #2624 denied `/Users` and `/home` wholesale and asserted here that listing them failed. That deny took
 * this operator's own home with it, which is what refused `~/git/STYLE_GUIDE.md`, so #2637 removed it. A
 * home directory is 0700 and the filesystem already refuses another account; the fence is not here to
 * re-implement file permissions, and this suite should not claim a protection it no longer provides.
 *
 * What replaced the assertion is the one below it: the customer container inside home, which is the
 * surface that actually matters and is asserted through the kernel above.
 */
