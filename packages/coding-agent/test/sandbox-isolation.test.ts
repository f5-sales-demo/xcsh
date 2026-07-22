import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, getPluginsDir, TempDir } from "@f5-sales-demo/pi-utils";
import { discoverAndLoadExtensions } from "@f5-sales-demo/xcsh/extensibility/extensions/loader";
import { getMemoryRoot } from "@f5-sales-demo/xcsh/memories";
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

	it("blocks a Bash `../` traversal from custA into custB", () => {
		const policy = buildDefaultSandboxPolicy({ cwd: custA });
		const decision = evaluateToolCall({
			toolName: "bash",
			input: { command: "cat ../custB/secret.env" },
			cwd: custA,
			policy,
		});
		expect(decision.block).toBe(true);
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
