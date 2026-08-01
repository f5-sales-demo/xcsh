/**
 * The XCSH.md discovery walk must be BOUNDED (a huge CWD like $HOME must not
 * stall system-prompt prep), and it must be HOISTABLE so tool-refresh rebuilds
 * don't re-walk the tree. See issue #2245.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCodingAgentPromptHelpers } from "../../src/config/prompt-templates";
import { buildSystemPrompt, discoverAgentsMdFiles } from "../../src/system-prompt";

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

/**
 * The budget must be PREEMPTIVE, not merely cooperative. Checking the deadline
 * between directories is not enough: a `readdir` that never settles — a
 * TCC-protected or cloud-synced directory such as ~/Documents on a managed Mac —
 * parks the walk forever at zero CPU, which hung `createAgentSession` (and so the
 * Office pane's `set_host_tools`) whenever xcsh was served from $HOME. See #2399.
 */
describe("discoverAgentsMdFiles (a blocking readdir cannot stall the walk)", () => {
	let tempDir = "";
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-block-"));
	});
	afterEach(() => {
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	/**
	 * Real readdir, except `blockedDir` returns a promise that never settles.
	 * `calls` proves the injected seam was actually USED — without it, an ignored
	 * option would silently fall back to the (fast, real) readdir and the timing
	 * assertions below would pass while testing nothing.
	 */
	function readdirBlockingOn(blockedDir: string) {
		const calls: string[] = [];
		const readdir = (dir: string): Promise<fs.Dirent[]> => {
			calls.push(dir);
			return path.resolve(dir) === path.resolve(blockedDir)
				? new Promise<fs.Dirent[]>(() => {}) // never settles, like ~/Documents
				: fs.promises.readdir(dir, { withFileTypes: true });
		};
		return { readdir, calls };
	}

	it("returns within budget when a directory's readdir never settles", async () => {
		const blocked = path.join(tempDir, "blocked");
		const ok = path.join(tempDir, "service");
		fs.mkdirSync(blocked, { recursive: true });
		fs.mkdirSync(ok, { recursive: true });
		fs.writeFileSync(path.join(ok, "XCSH.md"), "# rules");
		const { readdir, calls } = readdirBlockingOn(blocked);

		const started = Date.now();
		const { files } = await discoverAgentsMdFiles(tempDir, { budgetMs: 300, readdir });
		const elapsed = Date.now() - started;

		// The walk really went through the injected readdir (and reached the bad dir).
		expect(calls.map(c => path.resolve(c))).toContain(path.resolve(blocked));
		// Bounded: without preemption this never returns at all.
		expect(elapsed).toBeLessThan(5000);
		// …and the healthy sibling is still discovered, so one bad directory does not
		// cost us the rest of the tree.
		expect(files).toContain("service/XCSH.md");
	});

	it("returns within budget even when the ROOT readdir never settles", async () => {
		const { readdir, calls } = readdirBlockingOn(tempDir);
		const started = Date.now();
		const { files } = await discoverAgentsMdFiles(tempDir, { budgetMs: 300, readdir });
		expect(calls).toHaveLength(1);
		expect(Date.now() - started).toBeLessThan(5000);
		expect(files).toEqual([]);
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
