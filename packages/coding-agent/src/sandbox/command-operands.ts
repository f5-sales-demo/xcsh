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

/** Flag-only options shared by the compressors. */
const GZIP_BOOLEAN_OPTIONS = [
	"-1",
	"-2",
	"-3",
	"-4",
	"-5",
	"-6",
	"-7",
	"-8",
	"-9",
	"-c",
	"--stdout",
	"-d",
	"--decompress",
	"-f",
	"--force",
	"-k",
	"--keep",
	"-q",
	"--quiet",
	"-r",
	"--recursive",
	"-t",
	"--test",
	"-v",
	"--verbose",
] as const satisfies readonly string[];

/** curl options that consume a separate value, so it is not mistaken for a path. */
const CURL_VALUE_OPTIONS = [
	"-H",
	"--header",
	"-X",
	"--request",
	"-d",
	"--data",
	"-u",
	"--user",
	"-A",
	"--user-agent",
	"--connect-timeout",
	"--max-time",
	"-m",
	"--retry",
	"-b",
	"--cookie",
	"-c",
	"--cookie-jar",
] as const satisfies readonly string[];

/** cp's flag-only options; shared so the mv/install entries stay readable. */
const COPY_BOOLEAN_OPTIONS = [
	"-a",
	"--archive",
	"-b",
	"--backup",
	"-d",
	"-f",
	"--force",
	"-i",
	"--interactive",
	"-H",
	"-l",
	"--link",
	"-L",
	"--dereference",
	"-n",
	"--no-clobber",
	"-P",
	"--no-dereference",
	"-p",
	"-R",
	"-r",
	"--recursive",
	"-s",
	"--symbolic-link",
	"-u",
	"--update",
	"-v",
	"--verbose",
	"-x",
	"--one-file-system",
] as const satisfies readonly string[];

/**
 * Which operands a command *writes*, so the boundary check picks the right direction.
 *
 * The read/write split in `enforce.ts` is derived from shell redirections. A write the invoked program
 * performs on one of its own operands — `tee FILE`, `dd of=FILE`, `cp SRC DST`, `sort -o FILE` — had no
 * such signal and defaulted to a read check. Under an `allowRead`-only grant that check passes, so the
 * write lands on a path shared for reading only; confirmed at the decision layer, where all four returned
 * `block: false` (GHSA-q4hg). The same misclassification refused those commands against a *write-only*
 * grant, which is the mirror-image false refusal.
 *
 * Adding to this table is monotonic. Marking an operand as a write that is really a read costs a false
 * refusal, which is the direction the surrounding code already errs in; missing one leaves today's
 * behaviour untouched. So it is safe to extend, and deliberately incomplete rather than guessed at:
 * `tar -f` is absent because whether it reads or writes depends on the mode letters, and getting that
 * wrong in the permissive direction is the bug being fixed.
 *
 * Same suppression rule as `provenExemptWords`: an option this model cannot parse exactly shifts operand
 * positions, so anything unrecognized abandons the command rather than guessing at a slot.
 */
interface WriteOperandSpec {
	/** Options taking a separate value, so it is not mistaken for a positional operand. */
	valueOptions: readonly string[];
	/** Options that are flags only. */
	booleanOptions: readonly string[];
	/** `--output=F` style options whose value is the written path. */
	outputOptions?: readonly string[];
	/** `of=F` style prefixes whose value is the written path. */
	outputPrefixes?: readonly string[];
	/** Every positional operand is written (`tee a b c`). */
	writesAllPositional?: boolean;
	/** The final positional operand is written (`cp src dst`). */
	writesLastPositional?: boolean;
	/** With this option present the destination moves into it, so positional slots stop being writes. */
	destinationOption?: string;
	/** Positional operands that are not paths at all — `chmod 644 f`, `chown me f`. */
	skipLeadingPositional?: number;
	/** Every positional is written once this option appears (`install -d a b c`). */
	allPositionalOption?: string;
	/** Sources are written too, because the command removes them (`mv`). */
	writesSourcesToo?: boolean;
}

const WRITE_OPERAND_SPECS: Record<string, WriteOperandSpec> = {
	// tee writes every file operand; it reads stdin, never the files.
	tee: {
		valueOptions: [],
		booleanOptions: ["-a", "--append", "-i", "--ignore-interrupts", "-p"],
		writesAllPositional: true,
	},
	// `of=` is the output file. `if=` stays a read, which is what the floor already gives it.
	dd: { valueOptions: [], booleanOptions: [], outputPrefixes: ["of="] },
	sort: {
		valueOptions: ["-k", "-t", "-S", "-T", "--key", "--field-separator", "--buffer-size"],
		booleanOptions: ["-b", "-d", "-f", "-g", "-i", "-M", "-h", "-n", "-R", "-r", "-u", "-V", "-z", "-c", "-s"],
		outputOptions: ["-o", "--output"],
	},
	cp: {
		valueOptions: ["-S", "--suffix", "-t", "--target-directory"],
		booleanOptions: COPY_BOOLEAN_OPTIONS,
		writesLastPositional: true,
		destinationOption: "-t",
	},
	// `mv` also REMOVES its sources, so a source in a read-only root is a mutation of that root.
	// Marking only the destination let `mv /shared/ctx/file .` delete from a read-allowed grant.
	mv: {
		valueOptions: ["-S", "--suffix", "-t", "--target-directory"],
		booleanOptions: ["-f", "--force", "-i", "--interactive", "-n", "--no-clobber", "-v", "--verbose", "-u"],
		writesLastPositional: true,
		writesSourcesToo: true,
		destinationOption: "-t",
	},
	install: {
		valueOptions: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory", "-S", "--suffix"],
		booleanOptions: ["-b", "-c", "-C", "-d", "-D", "-p", "-s", "-v", "--verbose", "--backup"],
		writesLastPositional: true,
		destinationOption: "-t",
		// `install -d a b c` creates every operand as a directory rather than copying into the last.
		allPositionalOption: "-d",
	},
	// Plain mutators: every path operand is written. Their absence was the largest hole in the table —
	// `rm` and `touch` against a read-only root are the obvious cases, and both were classified as reads.
	rm: {
		valueOptions: [],
		booleanOptions: ["-f", "--force", "-i", "-I", "-r", "-R", "--recursive", "-d", "--dir", "-v", "--verbose"],
		writesAllPositional: true,
	},
	rmdir: { valueOptions: [], booleanOptions: ["-p", "--parents", "-v", "--verbose"], writesAllPositional: true },
	touch: {
		valueOptions: ["-d", "--date", "-r", "--reference", "-t"],
		booleanOptions: ["-a", "-c", "--no-create", "-f", "-h", "--no-dereference", "-m"],
		writesAllPositional: true,
	},
	mkdir: {
		valueOptions: ["-m", "--mode"],
		booleanOptions: ["-p", "--parents", "-v", "--verbose"],
		writesAllPositional: true,
	},
	ln: {
		valueOptions: ["-S", "--suffix", "-t", "--target-directory"],
		booleanOptions: ["-b", "-f", "--force", "-i", "-L", "-n", "-P", "-r", "-s", "--symbolic", "-v"],
		writesLastPositional: true,
		destinationOption: "-t",
	},
	shred: {
		valueOptions: ["-n", "--iterations", "-s", "--size"],
		booleanOptions: ["-f", "--force", "-u", "--remove", "-v", "--verbose", "-x", "-z", "--zero"],
		writesAllPositional: true,
	},
	unlink: { valueOptions: [], booleanOptions: [], writesAllPositional: true },
	// The first positional is a mode or an owner, not a path.
	chmod: {
		valueOptions: ["--reference"],
		booleanOptions: ["-c", "-f", "-v", "-R", "--recursive", "--silent", "--changes", "--verbose"],
		writesAllPositional: true,
		skipLeadingPositional: 1,
	},
	chown: {
		valueOptions: ["--reference", "--from"],
		booleanOptions: ["-c", "-f", "-v", "-R", "--recursive", "-h", "--no-dereference", "--silent", "--changes"],
		writesAllPositional: true,
		skipLeadingPositional: 1,
	},
	// In-place editors and compressors REPLACE the file they are given.
	//
	// `sed -i` has famously ambiguous arity — GNU takes an attached suffix, BSD a separate one — so
	// which positional is the script cannot be settled. Every literal positional is therefore marked
	// written, which over-marks the script operand. That is the safe direction: a false refusal, not a
	// permitted write. The marking only applies when `-i` is present at all.
	sed: {
		valueOptions: ["-e", "--expression", "-f", "--file", "-l", "--line-length"],
		booleanOptions: ["-n", "--quiet", "--silent", "-E", "-r", "--regexp-extended", "-s", "-u", "-z", "--debug"],
		writesAllPositional: false,
		allPositionalOption: "-i",
	},
	gzip: { valueOptions: ["-S", "--suffix"], booleanOptions: GZIP_BOOLEAN_OPTIONS, writesAllPositional: true },
	gunzip: { valueOptions: ["-S", "--suffix"], booleanOptions: GZIP_BOOLEAN_OPTIONS, writesAllPositional: true },
	bzip2: { valueOptions: [], booleanOptions: GZIP_BOOLEAN_OPTIONS, writesAllPositional: true },
	xz: { valueOptions: ["-T", "--threads"], booleanOptions: GZIP_BOOLEAN_OPTIONS, writesAllPositional: true },
	// Downloaders name their output explicitly; the URL operand is not a path.
	curl: {
		valueOptions: CURL_VALUE_OPTIONS,
		booleanOptions: ["-L", "--location", "-s", "--silent", "-S", "--show-error", "-f", "--fail", "-k", "-I", "-v"],
		outputOptions: ["-o", "--output"],
	},
	wget: {
		valueOptions: ["--user-agent", "--header", "-P", "--directory-prefix", "-T", "--timeout"],
		booleanOptions: ["-q", "--quiet", "-c", "--continue", "-N", "--no-verbose", "-nv"],
		outputOptions: ["-O", "--output-document"],
	},
	truncate: {
		valueOptions: ["-s", "--size", "-r", "--reference"],
		booleanOptions: ["-c", "--no-create", "-o", "--io-blocks"],
		writesAllPositional: true,
	},
};

/**
 * Words of `cmd` the invoked command writes to.
 *
 * Empty whenever anything is uncertain — an unknown command, an unrecognized option, a non-literal word.
 * A word returned here is checked against the write boundary instead of the read one.
 */
export function writtenOperandWords(cmd: ShellSimpleCommand): ShellWord[] {
	if (cmd.name === undefined) return [];
	const spec = WRITE_OPERAND_SPECS[cmd.name];
	if (spec === undefined) return [];

	const operandWords = cmd.words.slice(cmd.operandStart).filter(word => word.redirect === undefined);

	// An unparsable option shifts every positional slot, so abandon rather than mark the wrong word.
	// Everything after `--` is a positional, however much it looks like an option — otherwise a file
	// literally named `-t` makes `cp -- -t /drop/secret out/` read as a target-directory option and
	// relabels a source as a write target.
	let sawEndOfOptions = false;
	for (const word of operandWords) {
		if (word.text === "--") {
			sawEndOfOptions = true;
			continue;
		}
		if (sawEndOfOptions) continue;
		const option = optionName(word.text);
		if (option === undefined) continue;
		if (isOutputOption(spec, option) || spec.valueOptions.includes(option)) continue;
		if (spec.booleanOptions.includes(option)) continue;
		if (matchesAllPositionalOption(spec, option)) continue;
		if (bundledBooleans(option, spec) !== undefined) continue;
		return [];
	}

	const written: ShellWord[] = [];
	const positional: ShellWord[] = [];
	let destinationMoved = false;
	let allPositionalWritten = spec.writesAllPositional ?? false;
	let pastEndOfOptions = false;

	for (let index = 0; index < operandWords.length; index += 1) {
		const word = operandWords[index];
		if (!pastEndOfOptions && word.text === "--") {
			pastEndOfOptions = true;
			continue;
		}
		const option = pastEndOfOptions ? undefined : optionName(word.text);

		if (option !== undefined && matchesAllPositionalOption(spec, option)) {
			// `install -d` stops copying and starts creating, so every operand becomes a written path.
			allPositionalWritten = true;
			continue;
		}

		if (option !== undefined) {
			const attached = word.text.includes("=");
			if (isOutputOption(spec, option)) {
				// `--output=F` carries its value; `-o F` takes the next word.
				const target = attached ? valueAfterEquals(word) : operandWords[index + 1];
				if (!attached) index += 1;
				if (target?.literal) written.push(target);
				continue;
			}
			if (spec.valueOptions.includes(option)) {
				if (option === spec.destinationOption) destinationMoved = true;
				if (!attached) {
					const target = operandWords[index + 1];
					index += 1;
					if (target?.literal) written.push(target);
				} else if (word.literal) {
					written.push(word);
				}
			}
			continue;
		}

		// `of=PATH` and friends are positional in shape but name their own direction.
		const prefix = spec.outputPrefixes?.find(candidate => word.text.startsWith(candidate));
		if (prefix !== undefined) {
			if (word.literal) written.push(word);
			continue;
		}

		positional.push(word);
	}

	const paths = positional.slice(spec.skipLeadingPositional ?? 0);
	if (allPositionalWritten) {
		written.push(...paths.filter(word => word.literal));
	} else if (spec.writesSourcesToo && spec.writesLastPositional && !destinationMoved && paths.length >= 2) {
		// Destination AND sources: `mv` removes what it moves.
		written.push(...paths.filter(word => word.literal));
	} else if (spec.writesLastPositional && !destinationMoved && paths.length >= 2) {
		// Only with a source present. A lone operand is `cp x` — an error, not a write to model.
		const destination = paths[paths.length - 1];
		if (destination.literal) written.push(destination);
	}

	return written;
}

/**
 * Split a bundled short option (`-ai`) into its letters when every one is a known boolean flag.
 *
 * Without this, `tee -ai /shared/ctx/x` hit the unrecognized-option path and abandoned the command —
 * failing open to a read check on a write, which is the defect this module exists to fix.
 */
function bundledBooleans(option: string, spec: WriteOperandSpec): string[] | undefined {
	if (!option.startsWith("-") || option.startsWith("--") || option.length <= 2) return undefined;
	const letters = [...option.slice(1)].map(letter => `-${letter}`);
	return letters.every(letter => spec.booleanOptions.includes(letter)) ? letters : undefined;
}

/**
 * Whether an option turns every operand into a written path.
 *
 * Prefix-matched for the single-letter form, because GNU `sed` attaches the backup suffix to the flag:
 * `-i.bak` is the same in-place edit as `-i`, and exact matching let that spelling through.
 */
function matchesAllPositionalOption(spec: WriteOperandSpec, option: string): boolean {
	const target = spec.allPositionalOption;
	if (target === undefined) return false;
	if (option === target) return true;
	return target.length === 2 && !target.startsWith("--") && option.startsWith(target);
}

function isOutputOption(spec: WriteOperandSpec, option: string): boolean {
	return spec.outputOptions?.includes(option) ?? false;
}

/** The value half of an `--option=value` word, as a span the caller can mark. */
function valueAfterEquals(word: ShellWord): ShellWord | undefined {
	const equals = word.text.indexOf("=");
	if (equals === -1) return undefined;
	return { ...word, text: word.text.slice(equals + 1) };
}
