import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContainmentFence, type ContainmentFence } from "../src/sandbox/containment";
import { evaluateToolCall } from "../src/sandbox/enforce";
import { resolveSessionFence } from "../src/sandbox/session-fence";

const CWD = "/work/custA";

/**
 * The session's boundary, written as the literal data the fence is (#2624).
 *
 * `ContainmentFence` is a plain record of canonical roots, so these tests need no filesystem — which is
 * what keeps them a unit test of `evaluateToolCall` rather than of `buildContainmentFence`. The shape
 * exercises the workspace, one-directional grants, and a protected data root. Parent enumeration and
 * named sibling access are covered with a real built fence below.
 *
 * Note what is deliberately absent: any rule about `/etc`, `/usr`, `/tmp` or an unrelated `/elsewhere`.
 * The fence is allow-by-default, so those are reachable, and that is the loosening #2624 is — a
 * deny-by-default policy refused all of them and none is customer material.
 */
function makeFence(): ContainmentFence {
	return {
		allow: [CWD],
		allowReadOnly: ["/shared/ctx"], // shared context: readable, deliberately not writable
		allowWriteOnly: ["/drop"], // write-only drop box, deliberately not readable
		deny: ["/work"], // stands in for a data root or cross-session store
		denyEnumerate: [],
	};
}

function check(toolName: string, input: Record<string, unknown>, fence: ContainmentFence = makeFence()) {
	return evaluateToolCall({ toolName, input, cwd: CWD, fence });
}

describe("evaluateToolCall", () => {
	it("allows read of in-tree file, blocks out-of-tree", () => {
		expect(check("read", { file_path: "notes.md" }).block).toBe(false);
		expect(check("read", { file_path: "/work/custB/secret.json" }).block).toBe(true);
		expect(check("read", { file_path: "../custB/secret.json" }).block).toBe(true);
	});

	it("gates write-family tools (write, notebook, ast_edit) for writes", () => {
		expect(check("write", { file_path: "out.ts" }).block).toBe(false);
		// `/etc` is not customer material and the fence never mentions it, so this layer no longer
		// refuses it (#2624). The filesystem's own permissions are what stop it, which is the right
		// place: a sandbox that refuses what the OS already refuses only teaches the model to distrust
		// its own errors.
		expect(check("write", { file_path: "/etc/hosts" }).block).toBe(false);
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
		// Legacy top-level path is still covered — asserted with a path the fence actually denies, since
		// `/etc` is no longer refused here (#2624).
		expect(check("edit", { file_path: "/work/custB/hosts" }).block).toBe(true);
	});

	it("keeps operator-owned plugin state readable and writable", () => {
		expect(check("read", { file_path: "/opt/xcsh/plugins/meddpicc/cli.ts" }).block).toBe(false);
		expect(check("write", { file_path: "/opt/xcsh/plugins/x" }).block).toBe(false);
	});

	it("search tools: absent path defaults to cwd (allowed); explicit out-of-tree blocked", () => {
		expect(check("grep", { pattern: "TODO" }).block).toBe(false);
		expect(check("grep", { pattern: "TODO", path: "/work/custB" }).block).toBe(true);
		// Searching a system tree is allowed now: it holds no customer material, and refusing it was one
		// of the asymmetries #2624 removes — a fenced `bash` could already `grep /etc`.
		expect(check("ast_grep", { path: "/etc" }).block).toBe(false);
		expect(check("ast_grep", { path: "/work/custB" }).block).toBe(true);
	});

	it("blocks parent enumeration without blocking a named sibling file", () => {
		const parent = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "xcsh-enumerate-")));
		const workspace = path.join(parent, "example-a");
		const sibling = path.join(parent, "example-b");
		fs.mkdirSync(workspace);
		fs.mkdirSync(sibling);
		fs.symlinkSync("..", path.join(workspace, "parent-link"));
		const namedFile = path.join(sibling, "context.md");
		fs.writeFileSync(namedFile, "context");
		try {
			const fence = buildContainmentFence({ workspace, home: parent });
			const evaluate = (toolName: string, input: Record<string, unknown>) =>
				evaluateToolCall({ toolName, input, cwd: workspace, fence });

			expect(evaluate("read", { file_path: parent }).block).toBe(true);
			expect(evaluate("read", { file_path: path.join(workspace, "parent-link") }).block).toBe(true);
			expect(evaluate("read", { file_path: namedFile }).block).toBe(false);
			expect(evaluate("grep", { pattern: "context", path: parent }).block).toBe(true);
			expect(evaluate("ast_edit", { path: parent }).block).toBe(true);
		} finally {
			fs.rmSync(parent, { recursive: true, force: true });
		}
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

	it("does not interpret Bash argument text as a path (#2931)", () => {
		const usersDenied = { ...makeFence(), deny: ["/Users"] };
		const commands = [
			'grep -nE "/Users/|alpha" notes.txt',
			"custom-tool /Users/customer/file",
			"cat /Users/customer/file",
			"python <<'PY'\nvalue = \"/Users/\"\nPY",
		];
		for (const command of commands) {
			expect(check("bash", { command }, usersDenied).block).toBe(false);
		}
	});

	it("treats a grep pattern consistently across Bash and the structured tool (#2931)", () => {
		const usersDenied = { ...makeFence(), deny: ["/Users"] };
		expect(check("bash", { command: 'grep -nE "/Users/|alpha" notes.txt' }, usersDenied).block).toBe(false);
		expect(check("grep", { pattern: "/Users/|alpha", path: "." }, usersDenied).block).toBe(false);
		expect(check("grep", { pattern: "alpha", path: "/Users/customer" }, usersDenied).block).toBe(true);
	});

	// A redirect target is the one word in a command the *shell* opens, and it opens it for writing.
	// Checking it against the read boundary let a read-only grant be written through (#2516).
	it("bash: a redirect target is checked against the write boundary", () => {
		// /shared/ctx is readable but not writable.
		expect(check("bash", { command: "cat /shared/ctx/notes.md" }).block).toBe(false);
		expect(check("bash", { command: "grep -n TODO /shared/ctx/notes.md" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /shared/ctx/notes.md" }).block).toBe(true);
		expect(check("bash", { command: "printf x >> /shared/ctx/notes.md" }).block).toBe(true);
		expect(check("bash", { command: "printf x 2> /shared/ctx/err.log" }).block).toBe(true);
		expect(check("bash", { command: 'printf x > "/shared/ctx/notes.md"' }).block).toBe(true);
		// The diagnostic must name the boundary that was actually crossed.
		expect(check("bash", { command: "printf x > /shared/ctx/notes.md" }).reason).toContain("write boundary");
		expect(check("bash", { command: "cat < /work/custB/secret" }).reason).toContain("read boundary");
		// An input redirect is a read, so a readable root stays usable as one.
		expect(check("bash", { command: "sort < /shared/ctx/notes.md" }).block).toBe(false);
		// The mirror case: a write-only grant accepts the write and still refuses the read.
		expect(check("bash", { command: "printf x > /drop/out.log" }).block).toBe(false);
		expect(check("bash", { command: "cat < /drop/out.log" }).block).toBe(true);
		// In-boundary redirects are unaffected.
		expect(check("bash", { command: "printf x > out.txt" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /work/custA/out.txt" }).block).toBe(false);
		// `<>` opens for both, so it has to clear both boundaries — neither grant alone is enough.
		expect(check("bash", { command: "cat <>/drop/f" }).block).toBe(true); // writable, not readable
		expect(check("bash", { command: "cat <>/shared/ctx/notes.md" }).block).toBe(true); // the reverse
		expect(check("bash", { command: "cat <>/work/custA/f" }).block).toBe(false); // both granted
	});

	// Directory changes and redirects are explicit shell effects, so the lexer checks them without
	// inferring anything from ordinary argument text.
	it("bash: cd into a denied directory is refused", () => {
		// In-tree: allowed.
		expect(check("bash", { command: "cd sub" }).block).toBe(false);
		expect(check("bash", { command: "cd ./sub/deeper" }).block).toBe(false);
		expect(check("bash", { command: "cd /work/custA/sub" }).block).toBe(false);
		expect(check("bash", { command: "cd ." }).block).toBe(false);
		// Into something the fence denies: refused, which is the case that matters.
		expect(check("bash", { command: "cd /work/custB" }).block).toBe(true);
		expect(check("bash", { command: "cd .." }).block).toBe(true);
		expect(check("bash", { command: "cd ~" }).block).toBe(false);
		// `cd /` is allowed now (#2624). Standing at `/` widens nothing: the boundary is fixed for the
		// session and no longer follows the shell (#2589), so a later relative path is still decided
		// against the same rules — `cd / && cat Users/other/x` is refused by the fence at the open.
		expect(check("bash", { command: "cd /" }).block).toBe(false);
		// Nor is a target this layer cannot read from the text refused any more (#2624). Each of these was
		// ordinary shell that came back as an error, and the shell itself checks `cd` where it performs it.
		expect(check("bash", { command: "cd" }).block).toBe(false);
		expect(check("bash", { command: "cd -" }).block).toBe(false);
		expect(check("bash", { command: "pushd /" }).block).toBe(false);
		// Home is operator-owned and remains available through every spelling.
		expect(check("bash", { command: "cd $HOME" }).block).toBe(false);
		expect(check("bash", { command: 'cd "$HOME"' }).block).toBe(false);
		expect(check("bash", { command: "pushd $HOME" }).block).toBe(false);
	});

	// Clamping the session cwd between calls would not have been enough: one call can both move the
	// shell and use the new location.
	it("bash: a cd and a relative read in the same call cannot combine into an escape", () => {
		expect(check("bash", { command: "cd .. && cat custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "cd ..; cat custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "(cd /work/custB && cat secret)" }).block).toBe(true);
		expect(check("bash", { command: "cd $HOME && cat .ssh/id_rsa" }).block).toBe(false);
		expect(check("bash", { command: "cd /work/custB && cat secret" }).block).toBe(true);
		// `cd /` is the case that changed: it is permitted, and the relative read after it lands in a
		// temp path the fence allows anyway. What must still fail is reaching a *denied* tree from there,
		// and that is decided at the open rather than in this text — see the isolation suite, which runs
		// the command instead of asking about it.
		expect(check("bash", { command: "cd / && cat tmp/esc/canary.txt" }).block).toBe(false);
		// The same shape entirely in-tree is ordinary work.
		expect(check("bash", { command: "cd sub && cat notes.md" }).block).toBe(false);
		expect(check("bash", { command: "cd ./sub; cat notes.md" }).block).toBe(false);
	});

	// The gate is on the directory change, so every spelling of one has to reach it: options before
	// the target, a `builtin` prefix, and a change buried in a script operand that the lexer hands
	// over as a single word. All found by adversarial review, all verified allowed beforehand.
	// Asserted against a target the fence actually denies. `/` used to serve here and no longer can,
	// since it is permitted now — using it would have turned every line below into a tautology.
	it("bash: alternative spellings of a directory change are gated too", () => {
		const denied = "/work/custB";
		expect(check("bash", { command: `cd -P ${denied}` }).block).toBe(true);
		expect(check("bash", { command: `cd -L ${denied}` }).block).toBe(true);
		expect(check("bash", { command: `cd -P ${denied} && cat secret` }).block).toBe(true);
		expect(check("bash", { command: `builtin cd ${denied}` }).block).toBe(true);
		expect(check("bash", { command: `command cd ${denied}` }).block).toBe(true);
		expect(check("bash", { command: `eval 'cd ${denied}'` }).block).toBe(true);
		expect(check("bash", { command: `sh -c 'cd ${denied} && cat x'` }).block).toBe(true);
		expect(check("bash", { command: `bash -c 'cd ${denied}; cat x'` }).block).toBe(true);
		// The same options staying in-tree remain ordinary work.
		expect(check("bash", { command: "cd -P sub" }).block).toBe(false);
		expect(check("bash", { command: "builtin cd sub" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cd sub && cat notes.md'" }).block).toBe(false);
		// A script this cannot read, and an option it does not recognise, are no longer refused (#2624):
		// there is nothing to check, and refusing on that basis rejected `eval "$cmd"` outright. The
		// shell performs the change and is checked where it does.
		expect(check("bash", { command: 'eval "$cmd"' }).block).toBe(false);
		expect(check("bash", { command: 'sh -c "$script"' }).block).toBe(false);
		expect(check("bash", { command: "cd --future-flag sub" }).block).toBe(false);
	});

	// A cd destination must be somewhere any relative path would be acceptable — which means write
	// as well as read. An explicit read-only grant cannot become writable through relative paths.
	it("bash: a directory change needs write access, not just read", () => {
		// /shared/ctx is readable and deliberately not writable.
		expect(check("bash", { command: "cd /shared/ctx" }).block).toBe(true);
		expect(check("bash", { command: "cd /shared/ctx && printf x > notes.md" }).block).toBe(true);
		// /drop is writable but not readable — also not a safe place to stand.
		expect(check("bash", { command: "cd /drop" }).block).toBe(true);
		// The session tree is granted both, so it stays usable.
		expect(check("bash", { command: "cd sub" }).block).toBe(false);
		expect(check("bash", { command: "cd /work/custA/sub" }).block).toBe(false);
	});

	// The `cwd` tool argument is the same lever as `cd`, supplied as structured input instead of
	// text. It was checked for read only, so a read-only root could be used as a working directory
	// and written to through an unscanned relative path.
	it("bash: the cwd argument needs write access too", () => {
		expect(check("bash", { cwd: "/shared/ctx", command: "touch notes.md" }).block).toBe(true);
		expect(check("bash", { cwd: "/shared/ctx", command: "cat notes.md" }).block).toBe(true);
		expect(check("bash", { cwd: "/drop", command: "cat x" }).block).toBe(true);
		expect(check("bash", { cwd: "/work/custB", command: "cat x" }).block).toBe(true);
		// In-tree stays usable.
		expect(check("bash", { cwd: "/work/custA/sub", command: "cat notes.md" }).block).toBe(false);
		expect(check("bash", { command: "cat notes.md" }).block).toBe(false);
	});

	it("bash: a redirect attached to its path is still checked", () => {
		expect(check("bash", { command: "cat </work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "cat\t</work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "printf x >/work/custB/y" }).block).toBe(true);
		expect(check("bash", { command: "printf x >>/work/custB/y" }).block).toBe(true);
		expect(check("bash", { command: "printf x 2>/work/custB/y" }).block).toBe(true);
		expect(check("bash", { command: "printf x &>/work/custB/y" }).block).toBe(true);
		expect(check("bash", { command: "printf x >|/work/custB/y" }).block).toBe(true);
		// Read a sibling's file and land it inside the session tree, where an ordinary read reaches it.
		expect(check("bash", { command: "sort </work/custB/secret >/work/custA/out" }).block).toBe(true);
		// Attached and read-only: the write boundary still applies.
		expect(check("bash", { command: "printf x >/shared/ctx/notes.md" }).block).toBe(true);
		// Attached relative redirects are still explicit redirect targets.
		expect(check("bash", { command: "printf x >../custB/y" }).block).toBe(true);
		expect(check("bash", { command: "cat <../custB/secret" }).block).toBe(true);
		// Incomplete input and nested script text are not reinterpreted as top-level shell effects.
		expect(check("bash", { command: "cat '/work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cat </work/custB/secret'" }).block).toBe(false);
		expect(check("bash", { command: "/bin/bash -c 'printf x >/work/custB/y'" }).block).toBe(false);
		expect(check("bash", { command: "find . -exec sh -c 'cat </work/custB/x' \\;" }).block).toBe(false);
		expect(check("bash", { command: "bash <<'EOF'\ncat </work/custB/x\nEOF" }).block).toBe(false);
		// `>&word` with no descriptor in front is a file redirect in bash, not a descriptor dup.
		expect(check("bash", { command: "printf x >&/work/custB/y" }).block).toBe(true);
		expect(check("bash", { command: "printf x >& /work/custB/y" }).block).toBe(true);
		// Real descriptor duplication has no filename and must stay allowed.
		expect(check("bash", { command: "printf x 2>&1" }).block).toBe(false);
		expect(check("bash", { command: "make >build.log 2>&1" }).block).toBe(false);
		expect(check("bash", { command: "printf x >&2" }).block).toBe(false);
		// The spaced and quoted forms were already blocked and stay blocked.
		expect(check("bash", { command: "cat < /work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "cat <'/work/custB/secret'" }).block).toBe(true);
		// An attached in-boundary redirect is ordinary work and must keep running.
		expect(check("bash", { command: "printf x >out.txt" }).block).toBe(false);
		expect(check("bash", { command: "printf x >/work/custA/out.txt" }).block).toBe(false);
		expect(check("bash", { command: "sort </work/custA/in.txt" }).block).toBe(false);
	});

	it("bash: nested script source is not scanned for redirects", () => {
		expect(check("bash", { command: "sh -c 'printf x >/shared/ctx/x'" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'printf x > /shared/ctx/x'" }).block).toBe(false);
		expect(check("bash", { command: "bash <<'EOF'\nprintf x >/shared/ctx/x\nEOF" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cat /shared/ctx/notes.md'" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cat </shared/ctx/notes.md'" }).block).toBe(false);
	});

	// A here-string supplies literal text on stdin; the shell never opens it. Verified against real
	// bash: `cat <<</tmp/f` prints the string "/tmp/f", not the contents of that file.
	it("bash: a here-string operand is data, not a path", () => {
		expect(check("bash", { command: "cat <<</work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "cat <<< /work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "cat <<<hello" }).block).toBe(false);
		// A heredoc delimiter and body are source text, not top-level path operands.
		expect(check("bash", { command: "cat << EOF\nbody\nEOF" }).block).toBe(false);
		expect(check("bash", { command: "bash <<'EOF'\ncat /work/custB/x\nEOF" }).block).toBe(false);
		// A real input redirect is unaffected.
		expect(check("bash", { command: "cat < /work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "cat </work/custB/secret" }).block).toBe(true);
	});

	// A redirect target is a file the shell opens whether or not it resembles a conventional path.
	it("bash: a relative redirect target is checked against the cwd it resolves in", () => {
		// A fence whose cwd is readable but not writable — reading context, emitting nothing.
		const readOnlyCwd: ContainmentFence = {
			allow: [],
			allowReadOnly: ["/shared/ctx"],
			allowWriteOnly: [],
			deny: [],
			denyEnumerate: [],
		};
		const inRoCwd = (command: string) =>
			evaluateToolCall({ toolName: "bash", input: { command }, cwd: "/shared/ctx", fence: readOnlyCwd });
		expect(inRoCwd("cat notes.md").block).toBe(false);
		expect(inRoCwd("printf x > out.txt").block).toBe(true);
		expect(inRoCwd("printf x >out.txt").block).toBe(true);
		expect(inRoCwd("printf x > ./sub/out.txt").block).toBe(true);
		expect(inRoCwd("printf x > /shared/ctx/out.txt").block).toBe(true);
		// Discarding output writes no file, so it stays allowed even here.
		expect(inRoCwd("make > /dev/null 2>&1").block).toBe(false);
		// And where the cwd *is* writable, a relative target is ordinary work.
		expect(check("bash", { command: "printf x > out.txt" }).block).toBe(false);
		expect(check("bash", { command: "printf x > ./sub/out.txt" }).block).toBe(false);
	});

	// The operand of a redirect was taken to the end of the whitespace token, so a metacharacter
	// glued to the target was absorbed into the "path" and `/dev/null;` matched no write sink
	// (#2540, a regression shipped in 19.98.2). Ordinary shell is full of this shape.
	it("bash: a metacharacter after a redirect target is not part of the path", () => {
		expect(check("bash", { command: "printf hello >/dev/null; echo x" }).block).toBe(false);
		expect(check("bash", { command: "printf hello 2>/dev/null; echo x" }).block).toBe(false);
		expect(check("bash", { command: "(printf hello >/dev/null)" }).block).toBe(false);
		expect(check("bash", { command: "printf hello >/dev/null&&echo x" }).block).toBe(false);
		expect(check("bash", { command: "printf hello >/dev/null|cat" }).block).toBe(false);
		expect(check("bash", { command: "printf hello >/dev/null&" }).block).toBe(false);
		expect(check("bash", { command: "ls 2>/dev/null|wc -l" }).block).toBe(false);
		// Truncating at the metacharacter must not lose the target itself.
		expect(check("bash", { command: "printf x >/work/custB/y; echo done" }).block).toBe(true);
		expect(check("bash", { command: "cat </work/custB/secret; echo x" }).block).toBe(true);
		expect(check("bash", { command: "printf x >/work/custB/y|cat" }).block).toBe(true);
		expect(check("bash", { command: "printf x >/shared/ctx/f; echo done" }).block).toBe(true);
		// A nested redirect is source text and is left to the runtime fence.
		expect(check("bash", { command: "sh -c 'printf x >/shared/ctx/x; echo done'" }).block).toBe(false);
	});

	/**
	 * The system trees are not mentioned by the fence, in either direction (#2624).
	 *
	 * This used to maintain its own read-allowance for `/usr`, `/bin`, `/etc` and a hand-kept list of
	 * writable `/dev` sinks, so that `> /dev/null` worked while `> /etc/hosts` did not. All of it went
	 * with the deny-by-default posture: the fence names no rule for any of these, so reads and writes
	 * alike are permitted here and the *filesystem* decides — `> /etc/hosts` and `> /dev/disk0` both
	 * need root, which this process does not have.
	 *
	 * That is the intended trade. The sandbox exists to stop the assistant reading another customer's
	 * folder, not to re-implement file permissions; a layer that refuses what the OS already refuses
	 * teaches the model to distrust its own error messages, which is how the `/title` refusal turned
	 * into abandoned work.
	 */
	it("bash: neither reads nor writes of the system trees are refused", () => {
		expect(check("bash", { command: "cat /etc/hosts" }).block).toBe(false);
		expect(check("bash", { command: "/usr/bin/python3 -c 'print(1)'" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /etc/hosts" }).block).toBe(false);
		expect(check("bash", { command: "printf x >> /etc/profile" }).block).toBe(false);
		expect(check("bash", { command: "printf x >/opt/homebrew/bin/xcsh" }).block).toBe(false);
		// `> /dev/null` needed a special case before and needs none now.
		expect(check("bash", { command: "printf x > /dev/null" }).block).toBe(false);
		expect(check("bash", { command: "echo hi > /dev/null 2>&1" }).block).toBe(false);
		expect(check("bash", { command: "make >/dev/null 2>/dev/null" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /dev/fd/3" }).block).toBe(false);
		// Literal read operands are runtime decisions; explicit redirects are still pre-checked.
		expect(check("bash", { command: "cat /work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /work/custB/planted" }).block).toBe(true);
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

	// Isolation off is the absence of a fence, not a disabled one: `resolveSessionFence` returns
	// undefined and `sandbox-guard` returns before evaluating. The equivalent here is a fence with no
	// rules at all, which allows everything by construction.
	it("allows everything under a fence with no rules", () => {
		const open: ContainmentFence = {
			allow: [],
			allowReadOnly: [],
			allowWriteOnly: [],
			deny: [],
			denyEnumerate: [],
		};
		expect(check("read", { file_path: "/etc/passwd" }, open).block).toBe(false);
		expect(check("bash", { command: "cat ../custB/x" }, open).block).toBe(false);
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

	it("checks Python's explicit cwd without scanning source or cells (#2931)", () => {
		expect(check("python", { code: "open('/work/custB/secret')" }).block).toBe(false);
		expect(check("python", { code: "x=1", cwd: "/work/custB" }).block).toBe(true);
		expect(check("python", { code: "open('notes.md')" }).block).toBe(false);
		expect(check("python", { cells: [{ code: "open('../custB/x')" }] }).block).toBe(false);
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
	// Inside a container rather than directly in the temp root, which is also the realistic layout: the
	// temp root is one of the directories the fence must never deny, so a workspace placed straight into
	// it has no denied parent and its "siblings" are reachable — the sibling assertion below would then
	// pass or fail for reasons that have nothing to do with symlinks.
	function symlinkedCwd(): string {
		const container = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sbx-container-"));
		const real = fs.mkdtempSync(path.join(container, "sbx-real-"));
		const link = path.join(container, `sbx-link-${path.basename(real)}`);
		fs.symlinkSync(real, link);
		cleanups.push(() => {
			try {
				fs.rmSync(container, { recursive: true, force: true });
			} catch {}
		});
		return link;
	}

	function checkAt(cwd: string, input: Record<string, unknown>, toolName = "read") {
		const fence = resolveSessionFence(cwd, { get: () => undefined })!;
		return evaluateToolCall({ toolName, input, cwd, fence });
	}

	it("allows in-tree reads/writes (including not-yet-existing targets) under a symlinked cwd", () => {
		const cwd = symlinkedCwd();
		expect(checkAt(cwd, { path: "notes.md" }).block).toBe(false);
		expect(checkAt(cwd, { path: "new/dir/output.json" }).block).toBe(false);
		// the original reported symptom: an internal-URL pseudo-path resolves under cwd and
		// must not be treated as an out-of-tree filesystem escape.
		expect(checkAt(cwd, { path: "xcsh://changes" }).block).toBe(false);
		expect(checkAt(cwd, { path: "brand-new.ts" }, "write").block).toBe(false);
	});

	it("still blocks parent enumeration from a symlinked cwd", () => {
		const cwd = symlinkedCwd();
		const parent = path.dirname(fs.realpathSync(cwd));
		expect(checkAt(cwd, { path: parent }).block).toBe(true);
		// The deny is exact and does not revoke operator authority over a named child.
		expect(checkAt(cwd, { path: "../elsewhere/secret.json" }).block).toBe(false);
	});
});

describe("option-attached paths (#2524)", () => {
	// Only options with a proven write contract are candidates. Unknown option text remains data.
	it("checks known output options without interpreting unrelated options", () => {
		expect(check("bash", { command: "curl --output=/work/custB/x https://e.com" }).block).toBe(true);
		expect(check("bash", { command: "grep TODO --file=/work/custB/patterns" }).block).toBe(false);
	});

	it("does not guess the meaning of attached short options", () => {
		expect(check("bash", { command: "curl -o/work/custB/x https://e.com" }).block).toBe(false);
		expect(check("bash", { command: "tar -C/work/custB -cf out.tgz ." }).block).toBe(false);
	});

	it("checks dd output without scanning its input operand", () => {
		expect(check("bash", { command: "dd if=/work/custB/secret of=./out" }).block).toBe(false);
		expect(check("bash", { command: "dd if=/work/custB/secret" }).block).toBe(false);
	});

	it("blocks an out-of-boundary destination operand", () => {
		// Deliberately not asserting WHICH boundary: knowing that `of=` is a write and `if=`
		// a read needs a per-command option table, which is the enumeration hazard #2479
		// warned against. Out-of-tree is out-of-tree either way, and that is what is fixed
		// here. A read-granted-but-not-write path attached to `of=` remains uncovered.
		expect(check("bash", { command: "dd if=./in of=/work/custB/out" }).block).toBe(true);
	});

	it("keeps #2470's false positives allowed — a regex address is not a path", () => {
		expect(check("bash", { command: "sed -n '/a/p'" }).block).toBe(false);
		expect(check("bash", { command: "sed -n '/^COMMANDS/,$p' notes.md" }).block).toBe(false);
		expect(check("bash", { command: "awk '/^a/ {print}'" }).block).toBe(false);
		expect(check("bash", { command: "echo '/a/p'" }).block).toBe(false);
	});

	it("still allows an in-boundary option value", () => {
		expect(check("bash", { command: "curl --output=./out.html https://e.com" }).block).toBe(false);
		expect(check("bash", { command: "dd if=./in of=./out" }).block).toBe(false);
		expect(check("bash", { command: "tar -C. -cf out.tgz ." }).block).toBe(false);
	});

	it("leaves a here-string operand literal — the shell never opens it", () => {
		// `cat <<</tmp/f` prints the string rather than reading the file, so an
		// option-shaped here-string operand must not be scanned either.
		expect(check("bash", { command: "cat <<<if=/work/custB/secret" }).block).toBe(false);
	});

	it("does not mistake a bare option or an equals sign in data for a path", () => {
		expect(check("bash", { command: "ls -la" }).block).toBe(false);
		expect(check("bash", { command: "echo a=b" }).block).toBe(false);
		expect(check("bash", { command: "git commit -m 'fix: a=b'" }).block).toBe(false);
	});
});

describe("paths reaching the shell through an expansion (#2534)", () => {
	/**
	 * The boundary reads the command as text, so a path arriving via a parameter expansion was
	 * never checked. Only part of that is fixable at this layer, and the split matters:
	 *
	 *   - `$HOME`/`${HOME}` mean exactly what `~` means, which is already handled. All three spellings
	 *     must preserve the operator's normal home access.
	 *   - Everything else — a variable in an operand, and a variable in a redirect target — is
	 *     genuinely unresolvable here and is left open on purpose. See below.
	 */
	// Assembled from escapes rather than written literally: a shell brace-expansion inside a TS
	// template literal is a template interpolation, and `HOME` is not a TS binding.
	const BRACED_HOME = `$\u007bHOME\u007d`;

	it("treats $HOME and its braced form as the operator-owned home", () => {
		expect(check("bash", { command: "cat ~/.ssh/id_rsa" }).block).toBe(false);
		expect(check("bash", { command: "cat $HOME/.ssh/id_rsa" }).block).toBe(false);
		expect(check("bash", { command: `cat ${BRACED_HOME}/.ssh/id_rsa` }).block).toBe(false);
		expect(check("bash", { command: 'cp secret "$HOME/exfil"' }).block).toBe(false);
		// A different variable that merely starts with HOME must not be rewritten.
		expect(check("bash", { command: "echo $HOMEBREW_PREFIX" }).block).toBe(false);
	});

	it("leaves ordinary redirects and globs working", () => {
		expect(check("bash", { command: "echo x > out.txt" }).block).toBe(false);
		expect(check("bash", { command: "echo x >> ./logs/run.log" }).block).toBe(false);
		expect(check("bash", { command: "ls *.ts" }).block).toBe(false);
		expect(check("bash", { command: "grep -rn TODO src/**/*.ts" }).block).toBe(false);
		// A here-string operand is literal data, not a file the shell opens.
		expect(check("bash", { command: "cat <<<$SECRET" }).block).toBe(false);
	});

	/**
	 * #2552 refused every non-literal redirect target. That is reverted here, deliberately.
	 *
	 * It broke ordinary in-tree shell — `make > "$LOG"`, `> "$TMPDIR/f"`, `> out-$$.txt`,
	 * `> "log-$(date +%s).txt"` — and it cannot be narrowed into safety: a variable's *value*
	 * can contain `../`, so `> "out-$X"` escapes while looking relative. The asymmetry with
	 * `cd` is the point: a bad redirect target damages one file, while a bad directory change
	 * silently relocates every later relative path. Phase 2 (#2554) resolves both properly.
	 */
	it("allows a redirect target it cannot resolve, and says why in the code", () => {
		expect(check("bash", { command: 'printf x >"$TARGET"' }).block).toBe(false);
		expect(check("bash", { command: "printf x > $TARGET" }).block).toBe(false);
		expect(check("bash", { command: "cat > $(mktemp)" }).block).toBe(false);
		// The idioms whose refusal made this a functionality regression.
		expect(check("bash", { command: 'make > "$LOG"' }).block).toBe(false);
		expect(check("bash", { command: 'echo x > "$TMPDIR/f"' }).block).toBe(false);
		expect(check("bash", { command: "printf x > out-$$.txt" }).block).toBe(false);
		expect(check("bash", { command: 'date > "log-$(date +%s).txt"' }).block).toBe(false);
	});

	it("documents the residual: a variable in an operand is still not resolvable here", () => {
		// Asserting CURRENT behaviour so a later change that closes this fails loudly and the
		// gap is re-evaluated rather than silently assumed. Phase 2 is what covers it.
		expect(check("bash", { command: 'cat "$SECRET"' }).block).toBe(false);
	});
});

/** Regression coverage for path-looking data that must never be interpreted as filesystem access. */
describe("evaluateToolCall — the reported false refusals (#2624)", () => {
	// Every one of these was refused before, on both bash and python, and none of them names a file.
	it("stops reading paths out of closing HTML and XML tags", () => {
		const commands = [
			`curl -sS -L "$u" | grep -oE '<title>[^<]*</title>' | head -1`,
			`echo x | grep -oE '<h1>[^<]*</h1>'`,
			`awk -F'</td>' '{print $1}' page.html`,
			`git log --pretty=format:'%h </%an>' | head`,
			`cat <<'X'\n<html></body>\nX`,
		];
		for (const command of commands) {
			const decision = check("bash", { command });
			expect(decision.block).toBe(false);
		}
	});

	it("stops refusing a closing tag inside python source", () => {
		expect(check("python", { code: 'import re\nre.findall(r"</title>", s)' }).block).toBe(false);
		expect(check("python", { code: 'x = "</body>"' }).block).toBe(false);
	});

	// The operational paths. Each was refused by this layer while a fenced `bash` was allowed it, so the
	// model was told a path was out of bounds and could then reach it another way — which is worse than
	// either answer on its own.
	it("stops refusing operational paths, through every tool that asks", () => {
		for (const command of ["cat /etc/hosts", "ls /usr/bin", "echo x > /tmp/scratch.txt", "cat /tmp/in.txt"]) {
			expect(check("bash", { command }).block).toBe(false);
		}
		expect(check("read", { file_path: "/etc/hosts" }).block).toBe(false);
		expect(check("read", { file_path: "/tmp/scratch.txt" }).block).toBe(false);
		expect(check("write", { file_path: "/tmp/out.txt" }).block).toBe(false);
		expect(check("grep", { pattern: "TODO", path: "/usr/share/doc" }).block).toBe(false);
		expect(check("python", { code: 'open("/etc/hosts").read()' }).block).toBe(false);
	});

	// The same file, the same question, through two interfaces. Disagreeing is what taught the model to
	// route ordinary reads through the shell.
	it("answers identically for bash and for the structured tools", () => {
		const gitconfig = path.join(os.homedir(), ".gitconfig");
		expect(check("bash", { command: `cat ${gitconfig}` }).block).toBe(false);
		expect(check("read", { file_path: gitconfig }).block).toBe(false);
		expect(check("bash", { command: `printf x > ${gitconfig}` }).block).toBe(false);
		expect(check("write", { file_path: gitconfig }).block).toBe(false);
	});

	it("leaves arbitrary-code paths to runtime while structured paths stay fenced", () => {
		expect(check("bash", { command: "cat /work/custB/secret.env" }).block).toBe(false);
		expect(check("read", { file_path: "/work/custB/secret.env" }).block).toBe(true);
		expect(check("python", { code: 'open("/work/custB/secret.env").read()' }).block).toBe(false);
		expect(check("grep", { pattern: "TOKEN", path: "/work/custB" }).block).toBe(true);
	});
});

describe("evaluateToolCall — the bash cwd parameter agrees with cd (#2624)", () => {
	// `cwd` is the parameter the bash prompt tells the model to prefer over `cd`, so the two have to
	// answer the same. A false refusal here just moves to the other interface.
	it("accepts a cwd the fence permits", () => {
		expect(check("bash", { command: "ls", cwd: "/tmp" }).block).toBe(false);
		expect(check("bash", { command: "ls", cwd: "/work/custA/sub" }).block).toBe(false);
		expect(check("bash", { command: "ls", cwd: "/" }).block).toBe(false);
	});

	it("still refuses a cwd the fence denies", () => {
		expect(check("bash", { command: "ls", cwd: "/work/custB" }).block).toBe(true);
	});

	// A read-only root is not somewhere a command may stand: every relative path it then writes would
	// land there unchecked. That is the #2516 split, and it survives.
	it("refuses a cwd that is readable but not writable", () => {
		expect(check("bash", { command: "ls", cwd: "/shared/ctx" }).block).toBe(true);
	});
});

/**
 * GHSA-q4hg — a write reached through a command *operand* was checked against the READ boundary.
 *
 * The read/write split applies to shell redirections. `tee FILE`, `dd of=FILE`, `cp SRC DST` and
 * `sort -o FILE` are writes the invoked program performs, and every one of them was classified as a read.
 * Under an `allowRead`-only grant that check passes, so the write lands on a path the operator shared for
 * reading only. Confirmed at the decision layer before this fix: all four returned `block: false`.
 *
 * It cuts the other way too. A write-only `allowWrite` grant refused `tee` into it, because a read check
 * against a write-only root fails — a false refusal produced by the same misclassification.
 *
 * On a host with an OS backend the fence also settles this below the text. The pre-check preserves a
 * precise refusal and directional-grant contract without scanning arbitrary arguments.
 */
describe("evaluateToolCall — operand writes are checked against the write boundary (GHSA-q4hg)", () => {
	// `/shared/ctx` is read-allowed and NOT write-allowed; `/drop` is write-allowed and NOT read-allowed.
	const bash = (command: string) => check("bash", { command });

	it("refuses an operand write into a read-only root", () => {
		for (const command of [
			"echo x | tee /shared/ctx/planted.txt",
			"echo x | tee -a /shared/ctx/planted.txt",
			"cp notes.md /shared/ctx/planted.txt",
			"dd of=/shared/ctx/planted.txt if=notes.md",
			"sort -o /shared/ctx/planted.txt notes.md",
		]) {
			expect(bash(command).block).toBe(true);
			expect(bash(command).reason).toContain("write boundary");
		}
	});

	it("permits the same operand write into a write-only root", () => {
		for (const command of ["echo x | tee /drop/out.log", "cp notes.md /drop/out.log", "dd of=/drop/out.log"]) {
			expect(bash(command).block).toBe(false);
		}
	});

	it("does not pre-check source operands", () => {
		expect(bash("cp /drop/out.log notes.md").block).toBe(false);
		expect(bash("cp /shared/ctx/in.txt notes.md").block).toBe(false);
	});

	it("leaves in-tree operand writes alone", () => {
		for (const command of ["echo x | tee out.log", "cp a.txt b.txt", "sort -o sorted.txt in.txt"]) {
			expect(bash(command).block).toBe(false);
		}
	});
});

/**
 * Review of the operand-direction fix found four more ways a write reached a read-only root.
 *
 * The critical one is structural and is NOT fully closed here: the table is a denylist, so a mutating
 * command it does not model still defaults to a read check. What is closed is the set that matters most —
 * the plain mutators (`rm`, `touch`, `mkdir`, `chmod`, …), which were the largest hole — plus three
 * defects in the model itself. The residual is tracked rather than implied away.
 */
describe("evaluateToolCall — operand writes, review round two (GHSA-q4hg)", () => {
	const bash = (command: string) => check("bash", { command });

	// `touch` and `rm` against a read-allowed root were classified as reads and permitted.
	it("refuses the plain mutators against a read-only root", () => {
		for (const command of [
			"touch /shared/ctx/x",
			"rm /shared/ctx/file",
			"rm -rf /shared/ctx/dir",
			"mkdir /shared/ctx/newdir",
			"rmdir /shared/ctx/dir",
			"ln -s /work/custA/a /shared/ctx/link",
			"shred /shared/ctx/file",
			"unlink /shared/ctx/file",
		]) {
			expect(bash(command).block).toBe(true);
			expect(bash(command).reason).toContain("write boundary");
		}
	});

	// `chmod 644 f` — the mode is a positional but not a path.
	it("skips the leading non-path operand of chmod and chown", () => {
		expect(bash("chmod 644 /shared/ctx/file").block).toBe(true);
		expect(bash("chown me /shared/ctx/file").block).toBe(true);
		// …and the mode itself is not mistaken for a path in the tree.
		expect(bash("chmod 644 in-tree.txt").block).toBe(false);
	});

	// `mv` REMOVES its source, so a source in a read-only root is a mutation of that root.
	it("treats an mv source as a write, because mv deletes it", () => {
		expect(bash("mv /shared/ctx/file .").block).toBe(true);
		expect(bash("mv /shared/ctx/file /shared/ctx/other").block).toBe(true);
		// `cp` does not remove its source, so that stays a read.
		expect(bash("cp /shared/ctx/file .").block).toBe(false);
	});

	// `install -d` creates directories rather than copying into the last operand.
	it("treats every operand of install -d as written", () => {
		expect(bash("install -d /shared/ctx/newdir").block).toBe(true);
		expect(bash("install -d /shared/ctx/a /shared/ctx/b").block).toBe(true);
	});

	// A bundled short option used to hit the unrecognized-option path and abandon the command, which
	// fails OPEN — the exact direction this module must never fail in.
	it("understands bundled short flags", () => {
		expect(bash("echo x | tee -ai /shared/ctx/x").block).toBe(true);
		expect(bash("rm -rf /shared/ctx/dir").block).toBe(true);
	});

	// Everything after `--` is a positional, however much it looks like an option.
	it("honours end-of-options", () => {
		// The source is not pre-checked; the final destination remains the only write operand.
		expect(bash("cp -- -t /drop/secret out.txt").block).toBe(false);
	});
});

/**
 * In-place editors, compressors and downloaders — the mutators found by measuring the residual rather
 * than by review. Each was permitted against a read-only root before being modelled.
 */
describe("evaluateToolCall — in-place and output-naming commands (GHSA-q4hg)", () => {
	const bash = (command: string) => check("bash", { command });

	it("treats an in-place sed as writing its file operands", () => {
		expect(bash("sed -i 's/a/b/' /shared/ctx/file").block).toBe(true);
		// GNU attaches the backup suffix to the flag; exact matching let this spelling through.
		expect(bash("sed -i.bak 's/a/b/' /shared/ctx/file").block).toBe(true);
	});

	it("leaves a reading sed alone", () => {
		// No -i, so nothing is written and the read-only grant is enough.
		expect(bash("sed -n 's/a/b/p' /shared/ctx/file").block).toBe(false);
		expect(bash("cat /shared/ctx/file").block).toBe(false);
	});

	it("treats compressors as replacing their input", () => {
		for (const command of ["gzip /shared/ctx/file", "xz /shared/ctx/file", "bzip2 /shared/ctx/file"]) {
			expect(bash(command).block).toBe(true);
		}
	});

	it("treats a downloader's output option as a write", () => {
		expect(bash("curl -o /shared/ctx/x https://example.com").block).toBe(true);
		expect(bash("wget -O /shared/ctx/x https://example.com").block).toBe(true);
	});
});
