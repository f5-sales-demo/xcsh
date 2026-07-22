import { describe, expect, it } from "bun:test";
import { evaluateToolCall } from "@f5-sales-demo/xcsh/sandbox/enforce";
import { SandboxPolicy } from "@f5-sales-demo/xcsh/sandbox/policy";

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

	it("gates the other filesystem tools (inspect_image, vim, puppeteer, catalog, debug)", () => {
		expect(check("inspect_image", { path: "/work/custB/pic.png" }).block).toBe(true);
		expect(check("inspect_image", { path: "shot.png" }).block).toBe(false);
		expect(check("display_image", { path: "../custB/pic.png" }).block).toBe(true);
		expect(check("vim", { file: "/work/custB/notes.txt" }).block).toBe(true);
		expect(check("vim", { file: "notes.txt" }).block).toBe(false);
		expect(check("puppeteer", { action: "screenshot", path: "/work/custB/out.png" }).block).toBe(true);
		expect(check("catalog_workflow_runner", { screenshot_dir: "/work/custB/shots" }).block).toBe(true);
		expect(check("catalog_workflow_runner", { catalog_path: "../custB/catalog" }).block).toBe(true);
		// debug executes arbitrary programs: a system binary is fine, a sibling is not.
		expect(check("debug", { program: "/usr/bin/lldb" }).block).toBe(false);
		expect(check("debug", { program: "/work/custB/bin" }).block).toBe(true);
		expect(check("debug", { cwd: "/work/custB" }).block).toBe(true);
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
