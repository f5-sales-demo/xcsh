import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeShell } from "@f5-sales-demo/pi-natives";
import { getAgentDir, getPluginsDir, TempDir } from "@f5-sales-demo/pi-utils";
import { discoverAndLoadExtensions } from "@f5-sales-demo/xcsh/extensibility/extensions/loader";
import { getMemoryRoot } from "@f5-sales-demo/xcsh/memories";
import { buildContainmentFence } from "@f5-sales-demo/xcsh/sandbox/containment";
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

	it("blocks Bash reads of custB from custA (relative and absolute)", () => {
		const policy = buildDefaultSandboxPolicy({ cwd: custA });
		const relative = evaluateToolCall({
			toolName: "bash",
			input: { command: "cat ../custB/secret.env" },
			cwd: custA,
			policy,
		});
		const absolute = evaluateToolCall({
			toolName: "bash",
			input: { command: `cat ${path.join(custB, "secret.env")}` },
			cwd: custA,
			policy,
		});
		expect(relative.block).toBe(true);
		expect(absolute.block).toBe(true);
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

	it("a session in custA cannot reach custB, by any route", async () => {
		for (const command of [
			"cat ../custB/secret.env",
			`cat ${path.join(custB, "secret.env")}`,
			"cd ../custB && cat secret.env",
			"c=cd; $c ../custB && cat secret.env",
			`cp ${path.join(custB, "secret.env")} .`,
			`printf x > ${path.join(custB, "planted.env")}`,
		]) {
			const { text } = await shell(custA, command);
			expect(text).not.toContain("TOKEN=b");
		}
		expect(fs.existsSync(path.join(custB, "planted.env"))).toBe(false);
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
