/**
 * The XCSH.md discovery walk must be BOUNDED (a huge CWD like $HOME must not
 * stall system-prompt prep), and it must be HOISTABLE so tool-refresh rebuilds
 * don't re-walk the tree. See issue #2245.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSystemPrompt, discoverAgentsMdFiles } from "@f5-sales-demo/xcsh/system-prompt";
import { registerCodingAgentPromptHelpers } from "../../src/config/prompt-templates";

/** Build a wide/deep tree of `breadth^depth` dirs with NO XCSH.md anywhere. */
function makeWideTree(root: string, breadth: number, depth: number): number {
	let dirs = 0;
	const recurse = (dir: string, d: number): void => {
		if (d === 0) return;
		for (let i = 0; i < breadth; i++) {
			const child = path.join(dir, `d${i}`);
			fs.mkdirSync(child, { recursive: true });
			dirs++;
			recurse(child, d - 1);
		}
	};
	recurse(root, depth);
	return dirs;
}

describe("discoverAgentsMdFiles (bounded walk)", () => {
	let tempDir = "";
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-walk-"));
	});
	afterEach(() => {
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("stops at the directory budget in a large tree with no XCSH.md", async () => {
		const total = makeWideTree(tempDir, 4, 4); // 4+16+64+256 = 340 dirs
		expect(total).toBeGreaterThan(300);
		const { files, dirsVisited } = await discoverAgentsMdFiles(tempDir, { maxDirs: 20 });
		expect(files).toHaveLength(0);
		// The visit budget caps traversal well below the full tree.
		expect(dirsVisited).toBeLessThanOrEqual(21); // budget + the root
		expect(dirsVisited).toBeLessThan(total);
	});

	it("a zero time budget stops almost immediately", async () => {
		makeWideTree(tempDir, 4, 3);
		const { dirsVisited } = await discoverAgentsMdFiles(tempDir, { budgetMs: 0 });
		expect(dirsVisited).toBeLessThanOrEqual(1);
	});

	it("still discovers a nested XCSH.md that is within budget", async () => {
		const sub = path.join(tempDir, "service");
		fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(path.join(sub, "XCSH.md"), "# rules");
		const { files } = await discoverAgentsMdFiles(tempDir);
		expect(files).toContain("service/XCSH.md");
	});
});

describe("buildSystemPrompt hoists agentsMdSearch (no re-walk)", () => {
	let tempDir = "";
	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-hoist-"));
	});
	afterEach(() => {
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("uses a provided agentsMdSearch instead of walking the cwd", async () => {
		// cwd has NO XCSH.md, but a provided search names one — it must appear in the
		// prompt, proving the walk was bypassed (a fresh walk of cwd would find nothing).
		const prompt = await buildSystemPrompt({
			cwd: tempDir,
			skills: [],
			rules: [],
			toolNames: [],
			disabledExtensions: [],
			agentsMdSearch: {
				scopePath: ".",
				limit: 200,
				pattern: "XCSH.md depth 1-4",
				files: ["provided-only/XCSH.md"],
			},
		});
		expect(prompt).toContain("provided-only/XCSH.md");
	});
});
