/**
 * Which words of a command are provably *not* filesystem references.
 *
 * The read-boundary scan in `enforce.ts` finds path-like tokens by scanning raw command text. That
 * is indiscriminate on purpose, and it is what makes the scan hard to fool — it sees inside quoted
 * scripts, heredoc bodies and nested commands by accident. It also produces the false positives in
 * issue #2470: `sed -n '/a/p'` is refused because `/a/p` is absolute-looking, even though sed never
 * opens it.
 *
 * So this module does not replace that scan. It identifies the narrow set of words a command
 * demonstrably treats as a script or a pattern rather than a filename; `enforce.ts` blanks those
 * spans and re-runs the scan over what is left. The scan remains the floor.
 *
 * Note the exemption is *positional*. An earlier version subtracted token strings, which lost track
 * of which occurrence a token came from: exempting the quoted operand of
 * `echo '/elsewhere/x' && cat /elsewhere/x` also cleared the identical token belonging to `cat`.
 *
 * The invariant to preserve: an exemption must never let a command read a file it would not
 * otherwise open. Concretely, that means every one of these must stay unexempted, because each one
 * really does open the path inside it — `test/sandbox-enforce.test.ts` pins all of them:
 *
 *     sh -c 'cat /work/custB/x'          the shell runs the string
 *     bash <<'EOF' … EOF                 the heredoc body is a script
 *     find . -exec sh -c '…' \;          -exec consumes a whole command run
 *     sed -n 'r /work/custB/x'           sed's `r` reads a file
 *     sed 's|x|cat /work/custB/x|e'      sed's `e` flag executes the replacement
 *     awk 'BEGIN { getline x < "…" }'    awk's getline reads a file
 *
 * When a dialect construct cannot be ruled out, do not exempt. A missed construct is a sandbox
 * escape; a falsely-detected one is only a false positive the current code already produces.
 */
import type { ShellSimpleCommand, ShellWord } from "../tools/shell-lex";

interface OperandSpec {
	/** Count of leading non-option operands that are scripts or patterns rather than files. */
	readonly exemptLeading: number;
	/** Options that relocate the script, so no leading operand is exemptible. */
	readonly suppressedBy: readonly string[];
	/** Options taking no argument. Anything not listed here or in `valueOptions` disables exemption. */
	readonly booleanOptions: readonly string[];
	/** Options whose following word is a value, not an operand. */
	readonly valueOptions: readonly string[];
	/** Set when every operand is text the command never interprets as a path. */
	readonly exemptAll?: true;
	/** Dialect whose file-access constructs must be absent for the exemption to hold. */
	readonly dialect?: "sed" | "awk";
}

const SED: OperandSpec = {
	exemptLeading: 1,
	suppressedBy: ["-e", "--expression", "-f", "--file"],
	booleanOptions: [
		"-n",
		"--quiet",
		"--silent",
		"-s",
		"--separate",
		"-u",
		"--unbuffered",
		"-z",
		"--null-data",
		"-E",
		"-r",
		"--regexp-extended",
		"--posix",
		"--debug",
		"--sandbox",
	],
	// -i and -l are deliberately absent: GNU sed attaches -i's suffix and gives -l an argument,
	// while BSD sed gives -i an argument and treats -l as a flag. Their arity is unknowable here,
	// so they land in the unrecognized bucket and disable exemption.
	valueOptions: [],
	dialect: "sed",
};

const AWK: OperandSpec = {
	exemptLeading: 1,
	suppressedBy: ["-f", "--file", "--source"],
	booleanOptions: ["--posix", "--traditional", "--re-interval", "-c"],
	valueOptions: ["-v", "--assign", "-F", "--field-separator"],
	dialect: "awk",
};

const GREP: OperandSpec = {
	exemptLeading: 1,
	suppressedBy: ["-e", "--regexp", "-f", "--file"],
	booleanOptions: [
		"-r",
		"-R",
		"--recursive",
		"-i",
		"--ignore-case",
		"-v",
		"--invert-match",
		"-n",
		"--line-number",
		"-H",
		"--with-filename",
		"-h",
		"--no-filename",
		"-c",
		"--count",
		"-l",
		"--files-with-matches",
		"-L",
		"--files-without-match",
		"-w",
		"--word-regexp",
		"-x",
		"--line-regexp",
		"-F",
		"--fixed-strings",
		"-E",
		"--extended-regexp",
		"-P",
		"--perl-regexp",
		"-o",
		"--only-matching",
		"-q",
		"--quiet",
		"-a",
		"--text",
		"-s",
		"--no-messages",
		"-z",
		"--null-data",
		"-b",
		"--byte-offset",
		"--color",
		"--colour",
	],
	valueOptions: [
		"-m",
		"--max-count",
		"-A",
		"--after-context",
		"-B",
		"--before-context",
		"-C",
		"--context",
		"--include",
		"--exclude",
		"--exclude-dir",
	],
};

const EMITTER: OperandSpec = {
	exemptLeading: 0,
	suppressedBy: [],
	booleanOptions: ["-n", "-e", "-E"],
	valueOptions: [],
	exemptAll: true,
};

/**
 * Per-command operand models.
 *
 * `find` and `rg` are deliberately absent. `find -exec` consumes an entire command run, and `rg` has
 * options that execute a program per input (`--pre`, `--hostname-bin`) — in both cases an operand
 * that looks like a pattern can be a path the command runs, so the cost of drawing the boundary
 * wrong is a bypass rather than a false positive. #2470 reports false positives for neither, so
 * there is nothing to buy. `grep`/`egrep`/`fgrep` stay: their option surface is POSIX-stable and
 * contains nothing that executes.
 */
const SPECS: Record<string, OperandSpec> = {
	sed: SED,
	gsed: SED,
	awk: AWK,
	gawk: AWK,
	mawk: AWK,
	nawk: AWK,
	grep: GREP,
	egrep: GREP,
	fgrep: GREP,
	echo: EMITTER,
	printf: EMITTER,
};

/** A sed address: a line number, `$`, a `/regex/`, or nothing at all. */
const SED_ADDRESS = String.raw`(?:\/(?:\\.|[^\/\\])*\/|[0-9]+|\$)?`;

/**
 * sed commands that read a file (`r`, `R`), write one (`w`, `W`), or execute a shell command (`e`),
 * in command position after an optional address range. Anchoring on the address is what keeps
 * `s/red/blue/` exempt while catching `/foo/r file`.
 */
const SED_FILE_ACCESS = new RegExp(
	String.raw`(?:^|[;{}\n])\s*${SED_ADDRESS}(?:,${SED_ADDRESS})?\s*!?\s*[rRwWe](?:\s|$)`,
);

/**
 * A substitution flag that writes a file (`w`) or executes the replacement as a shell command (`e`),
 * as in `s/a/b/w file` or `s|x|cat /elsewhere/secret|e`. The `e` flag makes the script arbitrary
 * code, so a script carrying it is never inert text.
 */
const SED_SUBSTITUTE_EXECUTES = /s(.)(?:\\.|(?!\1)[^\\])*\1(?:\\.|(?!\1)[^\\])*\1[a-zA-Z0-9]*[we]/;

/** awk constructs that read, write, or execute rather than just matching and printing. */
const AWK_FILE_ACCESS = [
	/\bgetline\b/,
	/\bsystem\s*\(/,
	/\bclose\s*\(/,
	/\bfflush\s*\(/,
	/\|/, // a pipe to or from a command
	/\b(?:print|printf)\b[^;}\n]*>/,
];

function hasFileAccessConstruct(dialect: "sed" | "awk" | undefined, script: string): boolean {
	if (dialect === "sed") return SED_FILE_ACCESS.test(script) || SED_SUBSTITUTE_EXECUTES.test(script);
	if (dialect === "awk") return AWK_FILE_ACCESS.some(pattern => pattern.test(script));
	return false;
}

/** The option name of a word, ignoring any `=value` suffix; undefined when it is not an option. */
function optionName(text: string): string | undefined {
	if (!text.startsWith("-") || text === "-" || text === "--") return undefined;
	const equals = text.indexOf("=");
	return equals === -1 ? text : text.slice(0, equals);
}

/**
 * Words of `cmd` whose contents the invoked command provably never opens as a path.
 *
 * Returns an empty array whenever anything is uncertain: an unknown command, a suppressing option, a
 * word that is unquoted or carries an expansion, a redirect target, or a script containing a
 * file-access construct.
 */
export function provenExemptWords(cmd: ShellSimpleCommand): ShellWord[] {
	if (cmd.name === undefined) return [];
	const spec = SPECS[cmd.name];
	if (spec === undefined) return [];

	const operandWords = cmd.words.slice(cmd.operandStart);

	// Which operand holds the script depends entirely on how the options parsed, so an option the
	// model cannot parse exactly makes the whole command unmodellable. Two ways that bites:
	// a suppressing option carrying an attached argument (`-e's/a/b/'`) would go unrecognized and
	// let a real file operand slide into the script slot, and an option of unknown arity (`sed -i`)
	// would shift every operand by one. Both end in exempting a path the command really opens, so
	// anything unrecognized disables exemption for this command.
	for (const word of operandWords) {
		if (word.redirect !== undefined) continue;
		const option = optionName(word.text);
		if (option === undefined) continue;
		if (spec.suppressedBy.includes(option)) return [];
		if (!spec.booleanOptions.includes(option) && !spec.valueOptions.includes(option)) return [];
	}

	const exempt: ShellWord[] = [];
	let leadingSeen = 0;

	for (let i = 0; i < operandWords.length; i++) {
		const word = operandWords[i];

		// A redirect target is a real file the shell opens, whatever the command does with its args.
		if (word.redirect !== undefined) continue;

		const option = optionName(word.text);
		if (option !== undefined) {
			// An option's value is consumed here so it is never mistaken for the first operand.
			if (!word.text.includes("=") && spec.valueOptions.includes(option)) i++;
			continue;
		}

		if (!spec.exemptAll) {
			if (leadingSeen >= spec.exemptLeading) continue;
			leadingSeen++;
		}

		// Quoting is the author's own signal that the word is data. An unquoted or expansion-bearing
		// word is not provably anything, so it stays on the floor.
		if (word.quote !== "single" && word.quote !== "double") continue;
		if (!word.literal) continue;
		if (hasFileAccessConstruct(spec.dialect, word.text)) continue;

		exempt.push(word);
	}

	return exempt;
}
