import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evaluateToolCall } from "@f5-sales-demo/xcsh/sandbox/enforce";
import { buildDefaultSandboxPolicy, SandboxPolicy } from "@f5-sales-demo/xcsh/sandbox/policy";

const CWD = "/work/custA";

function makePolicy(enabled = true): SandboxPolicy {
	return new SandboxPolicy({
		enabled,
		cwd: CWD,
		read: [
			{ root: CWD, allow: true },
			{ root: "/opt/xcsh/plugins", allow: true }, // stand-in for plugin cache
		],
		write: [{ root: CWD, allow: true }],
	});
}

function check(toolName: string, input: Record<string, unknown>, enabled = true) {
	return evaluateToolCall({ toolName, input, cwd: CWD, policy: makePolicy(enabled) });
}

describe("evaluateToolCall", () => {
	it("allows read of in-tree file, blocks out-of-tree", () => {
		expect(check("read", { file_path: "notes.md" }).block).toBe(false);
		expect(check("read", { file_path: "/work/custB/secret.json" }).block).toBe(true);
		expect(check("read", { file_path: "../custB/secret.json" }).block).toBe(true);
	});

	it("gates write-family tools (write, notebook, ast_edit) for writes", () => {
		expect(check("write", { file_path: "out.ts" }).block).toBe(false);
		expect(check("write", { file_path: "/etc/hosts" }).block).toBe(true);
		expect(check("notebook", { notebook_path: "nb.ipynb" }).block).toBe(false);
		expect(check("notebook", { notebook_path: "/work/custB/nb.ipynb" }).block).toBe(true);
		expect(check("ast_edit", { path: "/work/custB" }).block).toBe(true);
	});

	it("gates the edit tool's per-entry paths and move destinations (default edits[] shape)", () => {
		// Default hashline/chunk/replace modes send an edits[] array, not top-level file_path.
		expect(check("edit", { edits: [{ path: "notes.md", old_text: "a", new_text: "b" }] }).block).toBe(false);
		expect(check("edit", { edits: [{ path: "/work/custB/x.ts", old_text: "a", new_text: "b" }] }).block).toBe(true);
		expect(check("edit", { edits: [{ path: "../custB/x.ts" }] }).block).toBe(true);
		// A move/rename destination outside the tree is a write escape.
		expect(check("edit", { edits: [{ path: "notes.md", move: "../custB/evil.ts" }] }).block).toBe(true);
		// Legacy top-level path is still covered.
		expect(check("edit", { file_path: "/etc/hosts" }).block).toBe(true);
	});

	it("treats plugin cache as readable (meddpicc engine) but not writable", () => {
		expect(check("read", { file_path: "/opt/xcsh/plugins/meddpicc/cli.ts" }).block).toBe(false);
		expect(check("write", { file_path: "/opt/xcsh/plugins/x" }).block).toBe(true);
	});

	it("search tools: absent path defaults to cwd (allowed); explicit out-of-tree blocked", () => {
		expect(check("grep", { pattern: "TODO" }).block).toBe(false);
		expect(check("grep", { pattern: "TODO", path: "/work/custB" }).block).toBe(true);
		expect(check("ast_grep", { path: "/etc" }).block).toBe(true);
	});

	it("find: pattern base escaping the tree is blocked; in-tree glob allowed", () => {
		expect(check("find", { pattern: "**/*.ts" }).block).toBe(false);
		expect(check("find", { pattern: "src/**/*.ts" }).block).toBe(false);
		expect(check("find", { pattern: "../custB/**/*.json" }).block).toBe(true);
		expect(check("find", { pattern: "/work/custB/**" }).block).toBe(true);
	});

	it("bash: rejects a cwd outside the boundary", () => {
		expect(check("bash", { command: "ls", cwd: "/work/custB" }).block).toBe(true);
		expect(check("bash", { command: "ls", cwd: "sub/dir" }).block).toBe(false);
		expect(check("bash", { command: "ls" }).block).toBe(false);
	});

	it("bash: best-effort blocks ../ traversal escaping the tree (Phase 1)", () => {
		expect(check("bash", { command: "cat ../custB/secrets.env" }).block).toBe(true);
		expect(check("bash", { command: "cat ./sub/../notes.md" }).block).toBe(false); // stays in-tree
		expect(check("bash", { command: "grep -r TODO ." }).block).toBe(false);
	});

	it("bash: blocks absolute-path escapes, exempts OS system paths", () => {
		expect(check("bash", { command: "cat /work/custB/secrets.env" }).block).toBe(true);
		expect(check("bash", { command: "cat ~/.ssh/id_rsa" }).block).toBe(true);
		expect(check("bash", { command: "cat /etc/os-release" }).block).toBe(false);
		expect(check("bash", { command: "/usr/bin/env node app.js" }).block).toBe(false);
	});

	// The false positives reported in #2470: a regex address or a program body is not a path, so
	// standard text processing must run. Each of these is refused today.
	it("bash: exempts script and pattern operands of sed/awk/grep and echo (#2470)", () => {
		expect(check("bash", { command: "sed -n '/a/p'" }).block).toBe(false);
		expect(check("bash", { command: "sed -n '/^COMMANDS/,$p' notes.md" }).block).toBe(false);
		expect(check("bash", { command: "awk '/^a/ {print \"hit:\" $0}'" }).block).toBe(false);
		expect(check("bash", { command: "echo '/a/p'" }).block).toBe(false);
		// The exemption is scoped to the script operand; a file operand beside it still counts.
		expect(check("bash", { command: "sed -n '/a/p' /work/custB/x" }).block).toBe(true);
	});

	// #2470 also asks for this: a reported "path" containing a quote or a statement separator is
	// proof the extraction was wrong, so no diagnostic may ever contain one.
	it("bash: a boundary diagnostic never contains shell punctuation", () => {
		const blocked = [
			"cat /work/custB/secrets.env",
			"sed -n 'r /work/custB/x' notes.md",
			"sh -c 'cat /work/custB/x'",
			"cat $(echo /work/custB/x)",
		];
		for (const command of blocked) {
			const decision = check("bash", { command });
			expect(decision.block).toBe(true);
			// Pull out just the path the message names, not the surrounding prose.
			const reported = /\): (.*)\. Use --allow-path/.exec(decision.reason ?? "")?.[1];
			expect(reported).toBeDefined();
			for (const punctuation of ["'", '"', ";", "|"]) {
				expect(reported).not.toContain(punctuation);
			}
		}
	});

	// The read-boundary scan's coverage FLOOR. Every command below reads a path out of argument
	// *content* rather than from a plain operand, so a scanner that only inspects real argv words
	// would miss it. The scan is documented as best-effort, but "best-effort" must not mean
	// "regresses": exemptions may only ever SUBTRACT from what this floor already catches
	// (see sandbox/command-operands.ts). Treat a failure here as a sandbox escape, not a test nit.
	it("bash: coverage floor — paths embedded in argument content stay blocked", () => {
		// A quoted script is one argv word; the path lives inside it.
		expect(check("bash", { command: "sh -c 'cat /work/custB/x'" }).block).toBe(true);
		expect(check("bash", { command: 'bash -c "cat /work/custB/x"' }).block).toBe(true);
		// A heredoc body is data to the shell, but bash executes it as a script.
		expect(check("bash", { command: "bash <<'EOF'\ncat /work/custB/x\nEOF" }).block).toBe(true);
		// -exec consumes a whole command run, so the nested shell never appears as the command name.
		expect(check("bash", { command: "find . -exec sh -c 'cat /work/custB/x' \\;" }).block).toBe(true);
		// sed/awk read files through their own dialects, not through operands.
		expect(check("bash", { command: "sed -n 'r /work/custB/x' notes.md" }).block).toBe(true);
		expect(check("bash", { command: "awk 'BEGIN { getline x < \"/work/custB/x\" }'" }).block).toBe(true);
		// Command substitution.
		expect(check("bash", { command: "cat $(echo /work/custB/x)" }).block).toBe(true);
		// A redirect target is a write, and must never be exempted by an emitter's operand rule.
		expect(check("bash", { command: "printf x > /work/custB/y" }).block).toBe(true);
		// Python is not shell: it must keep its own substring scan.
		expect(check("python", { code: "open('/work/custB/secret')" }).block).toBe(true);
	});

	// An exemption applies to the word it was proven for, and to nothing else. These are the two
	// ways that scoping can leak, both found by adversarial review of the exemption design.
	it("bash: an exemption never widens beyond the word it was proven for", () => {
		// sed's `e` substitution flag executes the replacement as a shell command, so a script
		// carrying it is not inert text and cannot be exempt.
		expect(check("bash", { command: "printf x | sed 's|x|cat /work/custB/secret|e'" }).block).toBe(true);
		// The same path text appearing in an exempt word must not clear an identical token that
		// belongs to a different command in the same line.
		expect(check("bash", { command: "echo '/work/custB/secret' && cat /work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "echo '/work/custB/x' | cat /work/custB/x" }).block).toBe(true);
		// The exemption itself must still work when nothing else references the path.
		expect(check("bash", { command: "echo '/work/custB/secret'" }).block).toBe(false);
		// rg runs the program given to --pre for every input, so its operands are not inert text.
		expect(check("bash", { command: "rg --pre '/work/custB/preprocessor' needle ." }).block).toBe(true);
	});

	// Which operand is the script depends on how the options parsed. If an option's arity is
	// misjudged, the real file operand slides into the script slot and gets exempted — so anything
	// the option model does not recognise exactly must disable exemption for that command.
	it("bash: an option the model cannot parse disables exemption entirely", () => {
		// -i attaches its suffix on GNU sed and takes a separate word on BSD, so the script slot
		// cannot be located; the quoted operand after it is a real file being rewritten.
		expect(check("bash", { command: "sed -i 's/a/b/' '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "sed --in-place 's/a/b/' '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "sed -l 's/a/b/' '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "sed -i.bak 's/a/b/' '/work/custB/secret'" }).block).toBe(true);
		// An attached argument means the script came from the option, so the operand is a file.
		expect(check("bash", { command: "sed -e's/a/b/' '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "sed -f/tmp/prog.sed '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "awk -f/tmp/p.awk '/work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "grep -e'x' '/work/custB/secret'" }).block).toBe(true);
		// An option the model has never heard of is equally unparseable.
		expect(check("bash", { command: "sed --some-future-flag x '/work/custB/secret'" }).block).toBe(true);
	});

	it("gates the other filesystem tools (image/lsp/puppeteer/catalog/debug)", () => {
		expect(check("inspect_image", { path: "/work/custB/pic.png" }).block).toBe(true);
		expect(check("inspect_image", { path: "shot.png" }).block).toBe(false);
		expect(check("display_image", { path: "../custB/pic.png" }).block).toBe(true);
		expect(check("lsp", { file: "/work/custB/app.ts" }).block).toBe(true);
		expect(check("lsp", { file: "app.ts" }).block).toBe(false);
		expect(check("puppeteer", { action: "screenshot", path: "/work/custB/out.png" }).block).toBe(true);
		// goto navigation to a local-file target in a sibling is a read escape; remote URLs are fine.
		expect(check("puppeteer", { action: "goto", url: "file:///work/custB/secret.html" }).block).toBe(true);
		expect(check("puppeteer", { action: "goto", url: "../custB/secret.html" }).block).toBe(true);
		expect(check("puppeteer", { action: "goto", url: "https://example.com" }).block).toBe(false);
		expect(check("puppeteer", { action: "goto", url: "file:///work/custA/page.html" }).block).toBe(false);
		expect(check("catalog_workflow_runner", { screenshot_dir: "/work/custB/shots" }).block).toBe(true);
		expect(check("catalog_workflow_runner", { catalog_path: "../custB/catalog" }).block).toBe(true);
		// debug executes arbitrary programs: a system binary is fine, a sibling is not.
		expect(check("debug", { program: "/usr/bin/lldb" }).block).toBe(false);
		expect(check("debug", { program: "/work/custB/bin" }).block).toBe(true);
		expect(check("debug", { cwd: "/work/custB" }).block).toBe(true);
	});

	it("gates generate_image input paths (read + external exfiltration vector)", () => {
		expect(check("generate_image", { subject: "x", input: [{ path: "/work/custB/logo.png" }] }).block).toBe(true);
		expect(check("generate_image", { subject: "x", input: [{ path: "logo.png" }] }).block).toBe(false);
		expect(check("generate_image", { subject: "x", input: [{ data: "base64..." }] }).block).toBe(false);
	});

	it("gates the edit tool across modes (vim-mode top-level file, patch rename)", () => {
		expect(check("edit", { file: "/work/custB/notes.txt" }).block).toBe(true); // vim mode
		expect(check("edit", { file: "notes.txt" }).block).toBe(false);
		expect(check("edit", { edits: [{ path: "a.ts", rename: "../custB/b.ts" }] }).block).toBe(true); // patch rename
	});

	it("ignores tools with no path argument (incl. remote xcsh_api/ssh paths)", () => {
		expect(check("calc", { expression: "1+1" }).block).toBe(false);
		expect(check("todo_write", { todos: [] }).block).toBe(false);
		expect(check("xcsh_api", { path: "/api/web/namespaces/x" }).block).toBe(false);
		expect(check("ssh", { host: "h", command: "ls", cwd: "/remote/dir" }).block).toBe(false);
	});

	it("is a no-op when the policy is disabled", () => {
		expect(check("read", { file_path: "/etc/passwd" }, false).block).toBe(false);
		expect(check("bash", { command: "cat ../custB/x" }, false).block).toBe(false);
	});

	it("blocks multi-path search inputs that smuggle a sibling via the common base", () => {
		// The tools split on top-level comma/whitespace and search the common base.
		expect(check("grep", { pattern: "TOKEN", path: ".,../custB" }).block).toBe(true);
		expect(check("find", { pattern: "*.md,../custB" }).block).toBe(true);
		expect(check("ast_grep", { path: ".,/work/custB" }).block).toBe(true);
		expect(check("ast_edit", { path: ".,../custB" }).block).toBe(true); // cross-session write
	});

	it("allows legitimate multi-path search inputs that stay in-tree", () => {
		expect(check("grep", { pattern: "TOKEN", path: "src,lib" }).block).toBe(false);
		expect(check("find", { pattern: "src/**/*.ts,lib/**/*.ts" }).block).toBe(false);
	});

	it("gates the python tool like bash (cwd + code scan)", () => {
		expect(check("python", { code: "open('/work/custB/secret')" }).block).toBe(true);
		expect(check("python", { code: "x=1", cwd: "/work/custB" }).block).toBe(true);
		expect(check("python", { code: "open('notes.md')" }).block).toBe(false);
		expect(check("python", { cells: [{ code: "open('../custB/x')" }] }).block).toBe(true);
	});
});

describe("evaluateToolCall with a symlinked working directory (#2312)", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		while (cleanups.length) cleanups.pop()?.();
	});

	// A symlinked cwd (e.g. macOS /tmp -> /private/tmp) must not make the sandbox
	// falsely block in-tree targets that don't yet exist on disk. Self-made symlink
	// so the test reproduces on Linux CI too.
	function symlinkedCwd(): string {
		const base = fs.realpathSync(os.tmpdir());
		const real = fs.mkdtempSync(path.join(base, "sbx-real-"));
		const link = path.join(base, `sbx-link-${path.basename(real)}`);
		fs.symlinkSync(real, link);
		cleanups.push(() => {
			try {
				fs.unlinkSync(link);
			} catch {}
			try {
				fs.rmSync(real, { recursive: true, force: true });
			} catch {}
		});
		return link;
	}

	function checkAt(cwd: string, input: Record<string, unknown>) {
		const policy = buildDefaultSandboxPolicy({ cwd, enabled: true, allowRead: [], allowWrite: [] });
		return evaluateToolCall({ toolName: "read", input, cwd, policy });
	}

	it("allows in-tree reads/writes (including not-yet-existing targets) under a symlinked cwd", () => {
		const cwd = symlinkedCwd();
		expect(checkAt(cwd, { path: "notes.md" }).block).toBe(false);
		expect(checkAt(cwd, { path: "new/dir/output.json" }).block).toBe(false);
		// the original reported symptom: an internal-URL pseudo-path resolves under cwd and
		// must not be treated as an out-of-tree filesystem escape.
		expect(checkAt(cwd, { path: "xcsh://changes" }).block).toBe(false);
		expect(
			evaluateToolCall({
				toolName: "write",
				input: { path: "brand-new.ts" },
				cwd,
				policy: buildDefaultSandboxPolicy({ cwd, enabled: true, allowRead: [], allowWrite: [] }),
			}).block,
		).toBe(false);
	});

	it("still blocks genuinely out-of-tree paths from a symlinked cwd", () => {
		const cwd = symlinkedCwd();
		expect(checkAt(cwd, { path: "/etc/passwd" }).block).toBe(true);
		expect(checkAt(cwd, { path: "../elsewhere/secret.json" }).block).toBe(true);
	});
});
