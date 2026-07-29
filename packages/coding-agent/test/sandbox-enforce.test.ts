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
			{ root: "/shared/ctx", allow: true }, // shared context: readable, deliberately not writable
		],
		write: [
			{ root: CWD, allow: true },
			{ root: "/drop", allow: true }, // write-only drop box: writable, deliberately not readable
		],
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
		expect(check("bash", { command: "cat /work/custB/secret" }).reason).toContain("read boundary");
		// An input redirect is a read, so a readable root stays usable as one.
		expect(check("bash", { command: "sort < /shared/ctx/notes.md" }).block).toBe(false);
		// The mirror case: a write-only grant accepts the write and still refuses the read.
		expect(check("bash", { command: "printf x > /drop/out.log" }).block).toBe(false);
		expect(check("bash", { command: "cat /drop/out.log" }).block).toBe(true);
		// In-boundary redirects are unaffected.
		expect(check("bash", { command: "printf x > out.txt" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /work/custA/out.txt" }).block).toBe(false);
		// `<>` opens for both, so it has to clear both boundaries — neither grant alone is enough.
		expect(check("bash", { command: "cat <>/drop/f" }).block).toBe(true); // writable, not readable
		expect(check("bash", { command: "cat <>/shared/ctx/notes.md" }).block).toBe(true); // the reverse
		expect(check("bash", { command: "cat <>/work/custA/f" }).block).toBe(false); // both granted
	});

	// The floor splits on whitespace, so an operator glued to its path was one token that did not
	// look like a path, and the boundary never saw it at all (#2520). A single space was the only
	// thing standing between a blocked read and an allowed one.
	// A relative operand is never checked, because the floor assumes it resolves under the session
	// directory. `cd` is what breaks that assumption: the bash tool runs one persistent in-process
	// shell, so a directory change outlives the call that made it and every later relative path
	// resolves somewhere else. Refusing a `cd` that cannot be proven to stay in-tree is what keeps
	// the assumption true — see #2542, where `cd /` then `cat tmp/x` read a sibling's file.
	it("bash: cd cannot leave the session tree", () => {
		// Provably in-tree: allowed.
		expect(check("bash", { command: "cd sub" }).block).toBe(false);
		expect(check("bash", { command: "cd ./sub/deeper" }).block).toBe(false);
		expect(check("bash", { command: "cd /work/custA/sub" }).block).toBe(false);
		expect(check("bash", { command: "cd ." }).block).toBe(false);
		// Provably out of tree.
		expect(check("bash", { command: "cd /" }).block).toBe(true);
		expect(check("bash", { command: "cd /work/custB" }).block).toBe(true);
		expect(check("bash", { command: "cd .." }).block).toBe(true);
		expect(check("bash", { command: "cd ~" }).block).toBe(true);
		// Not provable — no target, or one the scanner cannot resolve. Fail closed.
		expect(check("bash", { command: "cd" }).block).toBe(true);
		expect(check("bash", { command: "cd $HOME" }).block).toBe(true);
		expect(check("bash", { command: 'cd "$HOME"' }).block).toBe(true);
		expect(check("bash", { command: "cd -" }).block).toBe(true);
		expect(check("bash", { command: "pushd /" }).block).toBe(true);
		expect(check("bash", { command: "pushd $HOME" }).block).toBe(true);
	});

	// Clamping the session cwd between calls would not have been enough: one call can both move the
	// shell and use the new location.
	it("bash: a cd and a relative read in the same call cannot combine into an escape", () => {
		expect(check("bash", { command: "cd / && cat tmp/esc/canary.txt" }).block).toBe(true);
		expect(check("bash", { command: "cd /; cat tmp/esc/canary.txt" }).block).toBe(true);
		expect(check("bash", { command: "(cd / && cat tmp/esc/canary.txt)" }).block).toBe(true);
		expect(check("bash", { command: "cd $HOME && cat .ssh/id_rsa" }).block).toBe(true);
		expect(check("bash", { command: "cd /work/custB && cat secret" }).block).toBe(true);
		// The same shape entirely in-tree is ordinary work.
		expect(check("bash", { command: "cd sub && cat notes.md" }).block).toBe(false);
		expect(check("bash", { command: "cd ./sub; cat notes.md" }).block).toBe(false);
	});

	// The gate is on the directory change, so every spelling of one has to reach it: options before
	// the target, a `builtin` prefix, and a change buried in a script operand that the lexer hands
	// over as a single word. All found by adversarial review, all verified allowed beforehand.
	it("bash: alternative spellings of a directory change are gated too", () => {
		expect(check("bash", { command: "cd -P /" }).block).toBe(true);
		expect(check("bash", { command: "cd -L /" }).block).toBe(true);
		expect(check("bash", { command: "cd -P / && cat tmp/esc/canary.txt" }).block).toBe(true);
		expect(check("bash", { command: "builtin cd /" }).block).toBe(true);
		expect(check("bash", { command: "command cd /" }).block).toBe(true);
		expect(check("bash", { command: "eval 'cd /'" }).block).toBe(true);
		expect(check("bash", { command: "sh -c 'cd / && cat tmp/x'" }).block).toBe(true);
		expect(check("bash", { command: "bash -c 'cd /; cat tmp/x'" }).block).toBe(true);
		// A script the scanner cannot read is not a proof of anything.
		expect(check("bash", { command: 'eval "$cmd"' }).block).toBe(true);
		expect(check("bash", { command: 'sh -c "$script"' }).block).toBe(true);
		// The same options staying in-tree remain ordinary work.
		expect(check("bash", { command: "cd -P sub" }).block).toBe(false);
		expect(check("bash", { command: "builtin cd sub" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cd sub && cat notes.md'" }).block).toBe(false);
		// An option the model does not know disables the proof rather than guessing.
		expect(check("bash", { command: "cd --future-flag sub" }).block).toBe(true);
	});

	// A cd destination must be somewhere any relative path would be acceptable — which means write
	// as well as read. The default policy grants the plugin and skill directories read-only, and
	// moving into one turned every unchecked relative path into a write there.
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
		// A relative escape is invisible to `looksLikePath` while the operator is glued on, because
		// the `..` is preceded by `>` rather than by a separator.
		expect(check("bash", { command: "printf x >../custB/y" }).block).toBe(true);
		expect(check("bash", { command: "cat <../custB/secret" }).block).toBe(true);
		// An unterminated quote makes every word boundary a guess, so the floor stands alone. That
		// is safe rather than lucky: bash refuses to run such a command, so it is not a way in.
		expect(check("bash", { command: "cat '/work/custB/secret" }).block).toBe(true);
		// Inside a quoted script the lexer sees one ordinary word, so the floor is the only thing
		// looking — it has to recognise the operator in raw text, not just in lexed words.
		expect(check("bash", { command: "sh -c 'cat </work/custB/secret'" }).block).toBe(true);
		expect(check("bash", { command: "/bin/bash -c 'printf x >/work/custB/y'" }).block).toBe(true);
		expect(check("bash", { command: "find . -exec sh -c 'cat </work/custB/x' \\;" }).block).toBe(true);
		expect(check("bash", { command: "bash <<'EOF'\ncat </work/custB/x\nEOF" }).block).toBe(true);
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

	// Inside a quoted script or a heredoc body the lexer has no words to mark, so the direction has
	// to come from the operator text itself — otherwise a nested write is checked as a read and a
	// read-only grant is writable after all, which is the whole of #2516.
	it("bash: a nested redirect carries its direction too", () => {
		expect(check("bash", { command: "sh -c 'printf x >/shared/ctx/x'" }).block).toBe(true);
		expect(check("bash", { command: "sh -c 'printf x > /shared/ctx/x'" }).block).toBe(true);
		expect(check("bash", { command: "bash <<'EOF'\nprintf x >/shared/ctx/x\nEOF" }).block).toBe(true);
		expect(check("bash", { command: "sh -c 'printf x >/shared/ctx/x'" }).reason).toContain("write boundary");
		// Reading the same root from a nested script is still ordinary work.
		expect(check("bash", { command: "sh -c 'cat /shared/ctx/notes.md'" }).block).toBe(false);
		expect(check("bash", { command: "sh -c 'cat </shared/ctx/notes.md'" }).block).toBe(false);
	});

	// A here-string supplies literal text on stdin; the shell never opens it. Verified against real
	// bash: `cat <<</tmp/f` prints the string "/tmp/f", not the contents of that file.
	it("bash: a here-string operand is data, not a path", () => {
		expect(check("bash", { command: "cat <<</work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "cat <<< /work/custB/secret" }).block).toBe(false);
		expect(check("bash", { command: "cat <<<hello" }).block).toBe(false);
		// A heredoc delimiter is not a path either — but the body still is scanned, and that is what
		// the coverage floor exists for.
		expect(check("bash", { command: "cat << EOF\nbody\nEOF" }).block).toBe(false);
		expect(check("bash", { command: "bash <<'EOF'\ncat /work/custB/x\nEOF" }).block).toBe(true);
		// A real input redirect is unaffected.
		expect(check("bash", { command: "cat < /work/custB/secret" }).block).toBe(true);
		expect(check("bash", { command: "cat </work/custB/secret" }).block).toBe(true);
	});

	// A redirect target is a file the shell opens whether or not it looks like a path, so the write
	// check cannot be gated on `looksLikePath` the way the floor's guesses are.
	it("bash: a relative redirect target is checked against the cwd it resolves in", () => {
		// A policy whose cwd is readable but not writable — reading context, emitting nothing.
		const readOnlyCwd = new SandboxPolicy({
			enabled: true,
			cwd: "/shared/ctx",
			read: [{ root: "/shared/ctx", allow: true }],
			write: [],
		});
		const inRoCwd = (command: string) =>
			evaluateToolCall({ toolName: "bash", input: { command }, cwd: "/shared/ctx", policy: readOnlyCwd });
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
		// Nor the direction of a nested one.
		expect(check("bash", { command: "sh -c 'printf x >/shared/ctx/x; echo done'" }).block).toBe(true);
	});

	// SYSTEM_READ_ROOTS is a *read* allowance — "directories a subprocess may legitimately read or
	// traverse". Applying it to a redirect target licensed writes into /etc, /usr and /opt.
	it("bash: the system-root read exemption does not license a write", () => {
		expect(check("bash", { command: "cat /etc/hosts" }).block).toBe(false);
		expect(check("bash", { command: "/usr/bin/python3 -c 'print(1)'" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /etc/hosts" }).block).toBe(true);
		expect(check("bash", { command: "printf x >> /etc/profile" }).block).toBe(true);
		expect(check("bash", { command: "printf x >/opt/homebrew/bin/xcsh" }).block).toBe(true);
		expect(check("bash", { command: "printf x > /usr/local/lib/evil.so" }).block).toBe(true);
		// The discard-and-echo devices stay writable: `> /dev/null` is in a large share of ordinary
		// commands, and a write to one reaches no file.
		expect(check("bash", { command: "printf x > /dev/null" }).block).toBe(false);
		expect(check("bash", { command: "echo hi > /dev/null 2>&1" }).block).toBe(false);
		expect(check("bash", { command: "make >/dev/null 2>/dev/null" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /dev/stderr" }).block).toBe(false);
		expect(check("bash", { command: "printf x > /dev/fd/3" }).block).toBe(false);
		// A raw block device is in /dev too, and a write there is an escape, not a discard.
		expect(check("bash", { command: "printf x > /dev/disk0" }).block).toBe(true);
		expect(check("bash", { command: "printf x >/dev/rdisk0" }).block).toBe(true);
		// Note the limit of this: `dd of=/dev/rdisk0` is an *operand*, not a redirect, and the
		// floor cannot see a path attached to an option. That is #2524, not this change.
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

describe("option-attached paths (#2524)", () => {
	/**
	 * `looksLikePath` is applied to a whole whitespace token, and a path glued to its
	 * option is one token that starts with the option — `path.isAbsolute("if=/work/custB/secret")`
	 * is false — so the boundary never saw it. A single space was the difference between
	 * the blocked form and the allowed one.
	 *
	 * The hazard in fixing it is #2470: scanning any `/`-containing substring re-reads
	 * `sed -n '/a/p'` as a path. Those stay allowed here, and must, because they are what
	 * #2479 was filed to remove.
	 */
	it("blocks a path attached to a long option", () => {
		expect(check("bash", { command: "curl --output=/work/custB/x https://e.com" }).block).toBe(true);
		expect(check("bash", { command: "grep TODO --file=/work/custB/patterns" }).block).toBe(true);
	});

	it("blocks a path attached to a short option with no separator", () => {
		expect(check("bash", { command: "curl -o/work/custB/x https://e.com" }).block).toBe(true);
		expect(check("bash", { command: "tar -C/work/custB -cf out.tgz ." }).block).toBe(true);
	});

	it("blocks a path in an operand-style name=value word (dd)", () => {
		expect(check("bash", { command: "dd if=/work/custB/secret of=./out" }).block).toBe(true);
		expect(check("bash", { command: "dd if=/work/custB/secret" }).block).toBe(true);
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
	 *   - `$HOME`/`${HOME}` mean exactly what `~` means, which is already handled. Three
	 *     spellings of one file, one of them blocked, is an oversight rather than a policy.
	 *   - Everything else — a variable in an operand, and a variable in a redirect target — is
	 *     genuinely unresolvable here and is left open on purpose. See below.
	 */
	// Assembled from escapes rather than written literally: a shell brace-expansion inside a TS
	// template literal is a template interpolation, and `HOME` is not a TS binding.
	const BRACED_HOME = `$\u007bHOME\u007d`;

	it("treats $HOME and its braced form as ~, which is already blocked", () => {
		expect(check("bash", { command: "cat ~/.ssh/id_rsa" }).block).toBe(true); // the existing rule
		expect(check("bash", { command: "cat $HOME/.ssh/id_rsa" }).block).toBe(true);
		expect(check("bash", { command: `cat ${BRACED_HOME}/.ssh/id_rsa` }).block).toBe(true);
		expect(check("bash", { command: 'cp secret "$HOME/exfil"' }).block).toBe(true);
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

/**
 * #2582: two policy engines with opposite defaults, and the composite was stricter than either.
 *
 * This scan is `SandboxPolicy` — deny-by-default, confined to the cwd. The containment fence is
 * allow-by-default with targeted denies. Running both made the effective policy their intersection, so
 * the scan refused work the fence permits and `xcsh://about` promises: a `/tmp` write, a `~/.gitconfig`
 * read, `cd /tmp`.
 *
 * Only those false refusals go away. The scan keeps deciding, because it is NOT a slower copy of the
 * fence — adversarial review showed the fence allows a second customer tree under an unrelated root, and
 * `policy.ts` withholds the shared temp dir from the file tools deliberately. Standing this layer down
 * would have handed both away, so #2582's premise that it "cannot add security" is refuted.
 */
describe("evaluateToolCall — bash false refusals under an OS fence (#2582)", () => {
	const fenced = (input: Record<string, unknown>) =>
		evaluateToolCall({ toolName: "bash", input, cwd: CWD, policy: makePolicy(), shellOsConfined: true });
	const unfenced = (input: Record<string, unknown>) =>
		evaluateToolCall({ toolName: "bash", input, cwd: CWD, policy: makePolicy(), shellOsConfined: false });
	const tmp = fs.realpathSync(os.tmpdir());

	// Each was measured refused on v19.100.0 while the fence permitted it.
	it("stops refusing the operational paths the fence grants", () => {
		expect(fenced({ command: `printf x > ${path.join(tmp, "probe.txt")}` }).block).toBe(false);
		expect(fenced({ command: `cat ${path.join(tmp, "probe.txt")}` }).block).toBe(false);
		expect(fenced({ command: `cd ${tmp}` }).block).toBe(false);
		expect(fenced({ command: `cat ${path.join(os.homedir(), ".gitconfig")} | wc -l` }).block).toBe(false);
	});

	// The fence grants ~/.gitconfig READ only, and so does this. Diverging in the other direction would
	// be worse than the bug: a permitted-looking write that the fence then refuses.
	it("keeps the read-only home config read-only", () => {
		expect(fenced({ command: `echo x >> ${path.join(os.homedir(), ".gitconfig")}` }).block).toBe(true);
	});

	// The protection the fence does NOT provide, and the reason this layer stays.
	it("still refuses a tree the fence would allow", () => {
		for (const command of ["cat /work/custB/secret.json", "cat /data/globex/secrets.tf"]) {
			expect(fenced({ command }).block).toBe(true);
			expect(unfenced({ command }).block).toBe(true);
		}
	});

	// Nothing changes where no backend is enforcing: there the scan is the whole boundary.
	it("changes nothing on a host with no OS backend", () => {
		expect(unfenced({ command: `printf x > ${path.join(tmp, "probe.txt")}` }).block).toBe(true);
		expect(unfenced({ command: `cd ${tmp}` }).block).toBe(true);
	});

	// python is covered by no fence on any platform, so it must never get the allowance.
	it("never widens python", () => {
		const python = (code: string) =>
			evaluateToolCall({
				toolName: "python",
				input: { code },
				cwd: CWD,
				policy: makePolicy(),
				shellOsConfined: true,
			});
		expect(python(`open('${path.join(tmp, "probe.txt")}','w')`).block).toBe(true);
		expect(python("open('notes.md').read()").block).toBe(false);
	});

	// Nor the structured file tools, which have no subprocess to confine.
	it("never widens the structured file tools", () => {
		const write = evaluateToolCall({
			toolName: "write",
			input: { file_path: path.join(tmp, "probe.txt") },
			cwd: CWD,
			policy: makePolicy(),
			shellOsConfined: true,
		});
		expect(write.block).toBe(true);
	});

	// Absent must mean "keep deciding": a caller that cannot answer must not relax the boundary.
	it("keeps refusing when the caller does not say", () => {
		expect(check("bash", { command: `printf x > ${path.join(tmp, "probe.txt")}` }).block).toBe(true);
	});
});

// Review: the fenced allowance was applied only to paths parsed out of the command text, so the
// documented `cwd` parameter — which the bash prompt tells the model to prefer over `cd` — still
// refused a temp path. The false refusal simply moved to the other interface.
describe("evaluateToolCall — the bash cwd parameter agrees with cd (#2582)", () => {
	const tmp = fs.realpathSync(os.tmpdir());

	it("accepts a cwd the fence permits", () => {
		const decision = evaluateToolCall({
			toolName: "bash",
			input: { command: "pwd", cwd: tmp },
			cwd: CWD,
			policy: makePolicy(),
			shellOsConfined: true,
		});
		expect(decision.block).toBe(false);
	});

	it("still refuses a cwd nothing permits", () => {
		for (const dir of ["/work/custB", "/data/globex"]) {
			const decision = evaluateToolCall({
				toolName: "bash",
				input: { command: "pwd", cwd: dir },
				cwd: CWD,
				policy: makePolicy(),
				shellOsConfined: true,
			});
			expect(decision.block).toBe(true);
		}
	});

	it("keeps refusing a temp cwd where no backend is enforcing", () => {
		const decision = evaluateToolCall({
			toolName: "bash",
			input: { command: "pwd", cwd: tmp },
			cwd: CWD,
			policy: makePolicy(),
			shellOsConfined: false,
		});
		expect(decision.block).toBe(true);
	});
});
