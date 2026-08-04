import type { ShellSimpleCommand, ShellWord } from "../tools/shell-lex";

/** The option name of a word, ignoring any `=value` suffix; undefined when it is not an option. */
function optionName(text: string): string | undefined {
	if (!text.startsWith("-") || text === "-" || text === "--") return undefined;
	const equals = text.indexOf("=");
	return equals === -1 ? text : text.slice(0, equals);
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
 * An option this model cannot parse exactly shifts operand positions, so anything unrecognized
 * abandons the command rather than guessing at a slot.
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
	/** Options that move the destination into their value, so positional slots stop being writes. */
	destinationOptions?: readonly string[];
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
	// `of=` is the output file. `if=` is deliberately not interpreted by the pre-check.
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
		destinationOptions: ["-t", "--target-directory"],
	},
	// `mv` also REMOVES its sources, so a source in a read-only root is a mutation of that root.
	// Marking only the destination let `mv /shared/ctx/file .` delete from a read-allowed grant.
	mv: {
		valueOptions: ["-S", "--suffix", "-t", "--target-directory"],
		booleanOptions: ["-f", "--force", "-i", "--interactive", "-n", "--no-clobber", "-v", "--verbose", "-u"],
		writesLastPositional: true,
		writesSourcesToo: true,
		destinationOptions: ["-t", "--target-directory"],
	},
	install: {
		valueOptions: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory", "-S", "--suffix"],
		booleanOptions: ["-b", "-c", "-C", "-d", "-D", "-p", "-s", "-v", "--verbose", "--backup"],
		writesLastPositional: true,
		destinationOptions: ["-t", "--target-directory"],
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
		destinationOptions: ["-t", "--target-directory"],
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
	for (let index = 0; index < operandWords.length; index += 1) {
		const word = operandWords[index];
		if (word.text === "--") {
			sawEndOfOptions = true;
			continue;
		}
		if (sawEndOfOptions) continue;
		const option = optionName(word.text);
		if (option === undefined) continue;
		if (isOutputOption(spec, option) || spec.valueOptions.includes(option)) {
			if (!word.text.includes("=")) index += 1;
			continue;
		}
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
				const target = attached ? valueAfterEquals(word) : operandWords[index + 1];
				if (!attached) index += 1;
				if (spec.destinationOptions?.includes(option)) {
					destinationMoved = true;
					if (target?.literal) written.push(target);
				}
			}
			continue;
		}

		// `of=PATH` and friends are positional in shape but name their own direction.
		const prefix = spec.outputPrefixes?.find(candidate => word.text.startsWith(candidate));
		if (prefix !== undefined) {
			if (word.literal) written.push({ ...word, text: word.text.slice(prefix.length) });
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
