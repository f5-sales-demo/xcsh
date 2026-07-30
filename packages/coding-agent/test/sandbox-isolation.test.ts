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
import { buildDefaultSandboxPolicy } from "@f5-sales-demo/xcsh/sandbox/policy";

let tmp: TempDir;
let parent: string;
let custA: string;
let custB: string;

beforeAll(() => {
	tmp = TempDir.createSync("xcsh-sbx-iso-");
	parent = tmp.absolute();
	custA = path.join(parent, "custA");
	custB = path.join(parent, "custB");
	fs.mkdirSync(custA, { recursive: true });
	fs.mkdirSync(custB, { recursive: true });
	fs.writeFileSync(path.join(custA, "notes.md"), "a");
	fs.writeFileSync(path.join(custB, "secret.env"), "TOKEN=b");
});

afterAll(() => tmp.removeSync());

function reads(cwd: string, filePath: string): boolean {
	const policy = buildDefaultSandboxPolicy({ cwd });
	return evaluateToolCall({ toolName: "read", input: { file_path: filePath }, cwd, policy }).block;
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

	// The scan keeps deciding for bash even where the OS fence is enforcing, because the fence is
	// allow-by-default: it denies home and the workspace's ancestors, so a customer tree under an
	// unrelated root matches nothing and the fence permits it. That is exactly what this layer covers,
	// and #2582 narrowed only its false refusals rather than standing it down.
	it("blocks Bash reads of custB from custA, fence or no fence", () => {
		const policy = buildDefaultSandboxPolicy({ cwd: custA });
		const scan = (command: string, shellOsConfined: boolean) =>
			evaluateToolCall({ toolName: "bash", input: { command }, cwd: custA, policy, shellOsConfined });

		for (const command of ["cat ../custB/secret.env", `cat ${path.join(custB, "secret.env")}`]) {
			expect(scan(command, false).block).toBe(true);
			expect(scan(command, true).block).toBe(true);
		}
	});
});

describe("functionality preservation under the sandbox", () => {
	it("keeps the plugin cache readable (e.g. the meddpicc engine)", () => {
		expect(reads(custA, path.join(getPluginsDir(), "cache", "plugins", "meddpicc", "engine", "cli.ts"))).toBe(false);
	});

	it("keeps user-level skills readable", () => {
		expect(reads(custA, path.join(getAgentDir(), "skills", "account-planning", "SKILL.md"))).toBe(false);
	});

	it("still blocks unrelated home dotfiles (e.g. ~/.ssh)", () => {
		expect(reads(custA, path.join(os.homedir(), ".ssh", "id_rsa"))).toBe(true);
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
		const fence = buildContainmentFence({ workspace: cwd, home: parent });
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
 * The container other operators' accounts live in, enforced by the kernel (#2624).
 *
 * The scenario above puts both tenants under one container, which the ancestor walk already covered.
 * This asserts the rule that was genuinely missing: a top-level root holding somebody else's files is
 * denied. Measured reachable before — `/Users/<otheruser>`, `/Volumes/<other>`, `/data/globex` all
 * matched no rule and defaulted to allow, read and write.
 *
 * Deliberately run against the REAL filesystem root with the real home, because a synthetic root
 * cannot show this. Under a temp-directory root the ancestor walk denies that whole container anyway,
 * so the test passes with or without the rule and proves nothing — measured, before rewriting it this
 * way. `ls` of the home container needs no write access and no planted file, which is what makes a
 * real-filesystem assertion possible here.
 */
describe("the container other operators' accounts live in", () => {
	const OS_ENFORCED = containmentStatus(true).osEnforced;
	// Both exist on their platform, both list successfully when unfenced, and neither holds anything a
	// toolchain needs — so a refusal here is the rule working rather than an accident of permissions.
	const HOME_CONTAINER = process.platform === "darwin" ? "/Users" : "/home";

	async function shell(command: string, fenced = true) {
		// The session's own checkout: a real directory under the real home, so the fence is shaped
		// exactly as it is in production rather than by an injected root.
		const workspace = fs.realpathSync(process.cwd());
		const fence = buildContainmentFence({ workspace });
		let out = "";
		const result = (await executeShell(
			{
				command,
				cwd: workspace,
				fence: fenced
					? {
							allow: [...fence.allow],
							allowReadOnly: [...fence.allowReadOnly],
							allowWriteOnly: [...fence.allowWriteOnly],
							deny: [...fence.deny],
						}
					: undefined,
			},
			(_e, c) => {
				out += c ?? "";
			},
		)) as { exitCode?: number; output?: string };
		return { code: result?.exitCode ?? -1, text: out + (result?.output ?? "") };
	}

	it(`${OS_ENFORCED ? "cannot" : "can still"} be listed from a fenced shell`, async () => {
		const { code } = await shell(`/bin/ls ${HOME_CONTAINER}`);
		if (OS_ENFORCED) expect(code).not.toBe(0);
		else expect(code).toBe(0);
	});

	it("while the operational roots and the session's own tree still work", async () => {
		// If the profile denied something a process needs to start, every assertion above would pass for
		// the wrong reason. This is the positive control that says commands still run at all.
		const sys = await shell("/bin/cat /etc/hosts > /dev/null && /bin/ls /usr/bin > /dev/null && echo sysok");
		expect(sys.text).toContain("sysok");
		const own = await shell("/bin/ls package.json");
		expect(own.code).toBe(0);
	});

	it("but the same listing unfenced succeeds — the control", async () => {
		const { code } = await shell(`/bin/ls ${HOME_CONTAINER}`, false);
		expect(code).toBe(0);
	});
});
