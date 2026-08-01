import { describe, expect, it } from "bun:test";
import { lexShellCommand } from "../../src/tools/shell-lex";

/** The raw source span a word covers, so offset assertions stay readable. */
function span(command: string, index: number): string {
	const word = lexShellCommand(command).words[index];
	return command.slice(word.start, word.end);
}

function texts(command: string): string[] {
	return lexShellCommand(command).words.map(w => w.text);
}

describe("lexShellCommand words", () => {
	it("reports the literal text and the raw source span of a quoted word", () => {
		const command = 'cat "artifact://7"';
		const word = lexShellCommand(command).words[1];
		expect(word.text).toBe("artifact://7");
		expect(word.quote).toBe("double");
		// The span covers the quotes, so a replacement can substitute the whole word.
		expect(command.slice(word.start, word.end)).toBe('"artifact://7"');
	});

	it("treats adjacent quoted and bare segments as one concatenated word", () => {
		const result = lexShellCommand(`a"b"'c'`);
		expect(result.words).toHaveLength(1);
		expect(result.words[0].text).toBe("abc");
		expect(result.words[0].quote).toBe("mixed");
		expect(span(`a"b"'c'`, 0)).toBe(`a"b"'c'`);
	});

	it("keeps a URL embedded in prose as part of its enclosing word", () => {
		expect(texts('echo "A: xcsh://about"')).toEqual(["echo", "A: xcsh://about"]);
		expect(texts(`printf '%s' 'D: xcsh://x?q=1'`)).toEqual(["printf", "%s", "D: xcsh://x?q=1"]);
	});

	it("decodes ANSI-C quoting", () => {
		expect(texts("printf $'a\\tb'")).toEqual(["printf", "a\tb"]);
	});

	it("keeps single-quoted content fully literal", () => {
		expect(texts(`sed -n '/a/p'`)).toEqual(["sed", "-n", "/a/p"]);
		expect(texts(`awk '/^a/ {print "hit:" $0}'`)).toEqual(["awk", `/^a/ {print "hit:" $0}`]);
	});

	it("processes backslash escapes outside quotes and inside double quotes", () => {
		expect(texts("cat a\\ b")).toEqual(["cat", "a b"]);
		expect(texts('echo "a\\"b"')).toEqual(["echo", 'a"b']);
		// A backslash before an ordinary character is literal inside double quotes.
		expect(texts('echo "a\\db"')).toEqual(["echo", "a\\db"]);
	});

	it("marks words containing expansions or globs as non-literal", () => {
		const bare = lexShellCommand("cat notes.md").words[1];
		expect(bare.literal).toBe(true);
		expect(lexShellCommand("cat $HOME/x").words[1].literal).toBe(false);
		expect(lexShellCommand("cat *.md").words[1].literal).toBe(false);
		expect(lexShellCommand('cat "$HOME/x"').words[1].literal).toBe(false);
		// Single quotes suppress expansion, so the word is literal.
		expect(lexShellCommand(`cat '$HOME/x'`).words[1].literal).toBe(true);
	});
});

describe("lexShellCommand operators and redirection", () => {
	it("splits a pipeline into simple commands and resolves each command name", () => {
		const result = lexShellCommand(`cat a | sed -n '/x/p'`);
		expect(result.commands.map(c => c.name)).toEqual(["cat", "sed"]);
		expect(result.commands[0].terminator).toBe("|");
		expect(result.commands[1].terminator).toBeUndefined();
	});

	it("splits on &&, ||, ; and newline", () => {
		expect(lexShellCommand("a && b || c ; d\ne").commands.map(c => c.name)).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("does not mistake a file-descriptor duplication for the background operator", () => {
		const result = lexShellCommand("cmd 2>&1");
		expect(result.commands).toHaveLength(1);
		expect(result.words.map(w => w.text)).toEqual(["cmd"]);
	});

	it("records the direction of a redirect target", () => {
		const write = lexShellCommand("printf x > out.txt");
		expect(write.words.at(-1)?.text).toBe("out.txt");
		expect(write.words.at(-1)?.redirect).toBe("write");
		expect(lexShellCommand("cat < in.txt").words.at(-1)?.redirect).toBe("read");
		expect(lexShellCommand("printf x >> out.txt").words.at(-1)?.redirect).toBe("write");
		// A plain operand carries no direction.
		expect(lexShellCommand("cat in.txt").words.at(-1)?.redirect).toBeUndefined();
	});

	// The operator does not need a space before its target, and `>|` overrides noclobber. Read as a
	// pipe instead, `>|out.txt` would make `out.txt` the next command's name and lose the target.
	it("records a redirect target attached to its operator, including >|", () => {
		for (const [command, direction] of [
			["printf x >out.txt", "write"],
			["printf x >>out.txt", "write"],
			["printf x >|out.txt", "write"],
			["printf x 2>out.txt", "write"],
			["printf x &>out.txt", "write"],
			["cat <in.txt", "read"],
		] as const) {
			const lexed = lexShellCommand(command);
			expect(lexed.words.at(-1)?.text).toBe(direction === "write" ? "out.txt" : "in.txt");
			expect(lexed.words.at(-1)?.redirect).toBe(direction);
		}
		// `>|` is one operator, so it must not leave a pipe behind that splits the command.
		expect(lexShellCommand("printf x >|out.txt").commands).toHaveLength(1);
	});

	// `>&word` duplicates a descriptor only when `word` is a descriptor. Otherwise bash opens it as
	// a file — verified against real bash: `printf hello >&/tmp/f` writes "hello" to /tmp/f.
	it("distinguishes >&file from descriptor duplication", () => {
		for (const command of ["printf x >&out.txt", "printf x >& out.txt"]) {
			const lexed = lexShellCommand(command);
			expect(lexed.words.at(-1)?.text).toBe("out.txt");
			expect(lexed.words.at(-1)?.redirect).toBe("write");
		}
		// A descriptor target is a dup, and produces no filename word at all.
		for (const command of ["printf x 2>&1", "printf x >&2", "cat <&0", "exec 3>&-"]) {
			expect(lexShellCommand(command).words.some(word => word.redirect !== undefined)).toBe(false);
		}
	});

	// `<>` opens one file for both reading and writing. Reported as either direction alone it would
	// tell a caller half the truth about what the shell is about to do with that path.
	it("reports <> as a read-write target", () => {
		for (const command of ["cat <>rw.txt", "cat <> rw.txt", "cat 3<>rw.txt"]) {
			const lexed = lexShellCommand(command);
			expect(lexed.words.at(-1)?.text).toBe("rw.txt");
			expect(lexed.words.at(-1)?.redirect).toBe("read-write");
			expect(lexed.commands).toHaveLength(1);
		}
	});

	it("keeps a redirect target in its own simple command", () => {
		const result = lexShellCommand("printf x > out.txt");
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0].name).toBe("printf");
	});

	// Bash starts a comment at any word boundary, not only before a command's first word. Treating a
	// trailing comment as arguments made URL expansion try to resolve text the shell would ignore.
	it("treats a trailing comment as a comment, not as arguments", () => {
		expect(lexShellCommand("true # skill://missing/x").words.map(w => w.text)).toEqual(["true"]);
		expect(lexShellCommand("ls -la  # a note").words.map(w => w.text)).toEqual(["ls", "-la"]);
		// A # inside a word is literal, as bash treats it.
		expect(lexShellCommand("echo a#b").words.map(w => w.text)).toEqual(["echo", "a#b"]);
		expect(lexShellCommand("echo '# not a comment'").words.map(w => w.text)).toEqual(["echo", "# not a comment"]);
	});

	it("consumes a heredoc body as data rather than as words", () => {
		const result = lexShellCommand("bash <<'EOF'\ncat /work/custB/x\nEOF");
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0].name).toBe("bash");
		// Neither the delimiter nor the body is a word: the body is not shell text here.
		expect(result.words.map(w => w.text)).toEqual(["bash"]);
	});
});

describe("lexShellCommand command names", () => {
	it("unwraps wrapper commands to the program actually invoked", () => {
		expect(lexShellCommand("sudo /usr/bin/env sed -n p").commands[0].name).toBe("sed");
		expect(lexShellCommand("command time nohup grep x f").commands[0].name).toBe("grep");
		expect(lexShellCommand("/usr/bin/sed -n p").commands[0].name).toBe("sed");
	});

	it("skips assignment prefixes when resolving the name and the first operand", () => {
		const result = lexShellCommand("FOO=1 sed -n p");
		expect(result.commands[0].name).toBe("sed");
		expect(result.commands[0].operandStart).toBe(2);
		expect(result.commands[0].words[0].text).toBe("FOO=1");
	});

	it("reports operandStart past the command name", () => {
		expect(lexShellCommand("sed -n p").commands[0].operandStart).toBe(1);
		expect(lexShellCommand("sudo /usr/bin/env sed -n p").commands[0].operandStart).toBe(3);
	});

	it("leaves the name undefined when the command begins with an expansion", () => {
		expect(lexShellCommand("$TOOL foo").commands[0].name).toBeUndefined();
	});
});

describe("lexShellCommand nesting", () => {
	it("recurses into command substitution and marks the enclosing word non-literal", () => {
		const result = lexShellCommand("cat $(echo /work/custB/x)");
		expect(result.commands.map(c => c.name)).toEqual(["cat", "echo"]);
		expect(result.commands[1].depth).toBe(1);
		const outer = result.commands[0].words[1];
		expect(outer.literal).toBe(false);
		// The nested path is visible as a word, so the sandbox scan can see it.
		expect(result.words.some(w => w.text === "/work/custB/x")).toBe(true);
	});

	it("recurses into backticks and subshells", () => {
		expect(lexShellCommand("cat `echo x`").commands.map(c => c.name)).toEqual(["cat", "echo"]);
		expect(lexShellCommand("(cat x)").commands.map(c => c.name)).toEqual(["cat"]);
		expect(lexShellCommand("(cat x)").commands[0].depth).toBe(1);
	});

	it("reports depth 0 for top-level words", () => {
		const result = lexShellCommand("cat x");
		expect(result.commands[0].depth).toBe(0);
	});
});

describe("lexShellCommand failure modes", () => {
	it("flags an unterminated quote", () => {
		expect(lexShellCommand("cat 'a").unterminated).toBe(true);
		expect(lexShellCommand('cat "a').unterminated).toBe(true);
		expect(lexShellCommand("cat $(echo x").unterminated).toBe(true);
		expect(lexShellCommand("cat a\\").unterminated).toBe(true);
	});

	it("does not flag balanced input", () => {
		expect(lexShellCommand(`cat 'a' "b" $(echo c)`).unterminated).toBe(false);
		expect(lexShellCommand("").unterminated).toBe(false);
	});

	it("returns no commands for empty or whitespace-only input", () => {
		expect(lexShellCommand("").commands).toEqual([]);
		expect(lexShellCommand("   \n  ").commands).toEqual([]);
	});
});
