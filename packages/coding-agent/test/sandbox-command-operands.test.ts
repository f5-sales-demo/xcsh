import { describe, expect, it } from "bun:test";
import { provenExemptWords } from "../src/sandbox/command-operands";
import { lexShellCommand } from "../src/tools/shell-lex";

/** The literal text of every word the exemption rules can prove is not a filesystem reference. */
function exempt(command: string): string[] {
	return lexShellCommand(command).commands.flatMap(cmd => provenExemptWords(cmd).map(w => w.text));
}

describe("provenExemptWords — script and pattern operands", () => {
	it("exempts a sed script operand", () => {
		expect(exempt(`sed -n '/a/p'`)).toEqual(["/a/p"]);
		expect(exempt(`sed -n '/^COMMANDS/,$p' notes.md`)).toEqual(["/^COMMANDS/,$p"]);
		expect(exempt(`sed 's/^a/X/' notes.md`)).toEqual(["s/^a/X/"]);
	});

	it("exempts an awk program operand", () => {
		expect(exempt(`awk '/^a/ {print "hit:" $0}'`)).toEqual([`/^a/ {print "hit:" $0}`]);
		expect(exempt(`gawk '{print $1}' notes.md`)).toEqual(["{print $1}"]);
	});

	it("exempts a grep pattern operand but not its file operands", () => {
		expect(exempt(`grep '/work/custB/x' .`)).toEqual(["/work/custB/x"]);
		// The file operand that follows the pattern is never exempt.
		expect(exempt(`grep 'TODO' '/work/custB/x'`)).toEqual(["TODO"]);
	});

	it("exempts every operand of a pure emitter", () => {
		expect(exempt(`echo '/a/p'`)).toEqual(["/a/p"]);
		expect(exempt(`printf '%s\\n' '/a/b'`)).toEqual(["%s\\n", "/a/b"]);
	});

	it("exempts nothing for a command with no entry", () => {
		expect(exempt("cat /work/custB/secrets.env")).toEqual([]);
		expect(exempt("sh -c 'cat /work/custB/x'")).toEqual([]);
		expect(exempt("find . -exec sh -c 'cat /work/custB/x' \\;")).toEqual([]);
		expect(exempt("bash <<'EOF'\ncat /work/custB/x\nEOF")).toEqual([]);
	});
});

describe("provenExemptWords — file-access constructs defeat the exemption", () => {
	it("refuses to exempt a sed script that reads or writes a file", () => {
		expect(exempt(`sed -n 'r /work/custB/x' notes.md`)).toEqual([]);
		expect(exempt(`sed -n '/foo/r /work/custB/x' notes.md`)).toEqual([]);
		expect(exempt(`sed '1,3w /work/custB/x' notes.md`)).toEqual([]);
		expect(exempt(`sed 's/a/b/w /work/custB/x' notes.md`)).toEqual([]);
		expect(exempt(`sed '1e cat /work/custB/x' notes.md`)).toEqual([]);
	});

	it("still exempts a sed substitution whose regex merely contains r, w or e", () => {
		expect(exempt(`sed 's/red/blue/' notes.md`)).toEqual(["s/red/blue/"]);
		expect(exempt(`sed 's/write/read/g' notes.md`)).toEqual(["s/write/read/g"]);
	});

	it("refuses to exempt an awk program that reads, writes, or executes", () => {
		expect(exempt(`awk 'BEGIN { getline x < "/work/custB/x" }'`)).toEqual([]);
		expect(exempt(`awk '{print > "/work/custB/x"}'`)).toEqual([]);
		expect(exempt(`awk '{print $0 >> "/work/custB/x"}'`)).toEqual([]);
		expect(exempt(`awk 'BEGIN { system("cat /work/custB/x") }'`)).toEqual([]);
		expect(exempt(`awk 'BEGIN { close("/work/custB/x") }'`)).toEqual([]);
		expect(exempt(`awk 'BEGIN { "cat /work/custB/x" | getline }'`)).toEqual([]);
	});
});

describe("provenExemptWords — preconditions", () => {
	it("never exempts a redirect target, even for a command whose operands are all exempt", () => {
		// The quoted operand is exempt; the redirect target beside it is not.
		expect(exempt(`echo '/a/b' > '/work/custB/y'`)).toEqual(["/a/b"]);
		expect(exempt(`printf '%s' '/a/b' >> '/work/custB/y'`)).toEqual(["%s", "/a/b"]);
	});

	it("never exempts an unquoted operand", () => {
		expect(exempt("sed -n /a/p")).toEqual([]);
		expect(exempt("echo /work/custB/x")).toEqual([]);
	});

	it("never exempts a word carrying an expansion or glob", () => {
		expect(exempt(`echo "$HOME/x"`)).toEqual([]);
		expect(exempt(`sed -n "/$PATTERN/p"`)).toEqual([]);
		expect(exempt(`echo "$(cat /work/custB/x)"`)).toEqual([]);
	});

	it("does not exempt a leading operand when the script came from an option", () => {
		// With -e the first operand is a FILE, not the script.
		expect(exempt(`sed -e 's/a/b/' /work/custB/x`)).toEqual([]);
		expect(exempt(`sed -f prog.sed /work/custB/x`)).toEqual([]);
		expect(exempt(`awk -f prog.awk /work/custB/x`)).toEqual([]);
		expect(exempt(`grep -e TODO /work/custB/x`)).toEqual([]);
		expect(exempt(`grep -f pats.txt /work/custB/x`)).toEqual([]);
	});

	it("skips over an option's value when locating the first operand", () => {
		// -F is a value option, so ':' is not the program; '{print $1}' is.
		expect(exempt(`awk -F : '{print $1}' notes.md`)).toEqual(["{print $1}"]);
		expect(exempt(`grep -m 3 '/a/b' .`)).toEqual(["/a/b"]);
	});

	it("exempts only the first script operand, never subsequent file operands", () => {
		expect(exempt(`sed -n '/a/p' '/work/custB/x'`)).toEqual(["/a/p"]);
		expect(exempt(`awk '{print}' '/work/custB/x'`)).toEqual(["{print}"]);
	});

	it("resolves the command through a wrapper", () => {
		expect(exempt(`sudo sed -n '/a/p'`)).toEqual(["/a/p"]);
		expect(exempt(`/usr/bin/env awk '{print}'`)).toEqual(["{print}"]);
	});

	it("exempts per simple command across a pipeline", () => {
		expect(exempt(`cat /work/custB/x | sed -n '/a/p'`)).toEqual(["/a/p"]);
	});
});
