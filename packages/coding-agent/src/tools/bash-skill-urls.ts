import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathIsWithin } from "@f5-sales-demo/pi-utils";
import type { Skill } from "../extensibility/skills";
import { type LocalProtocolOptions, resolveLocalUrlToPath } from "../internal-urls";
import { validateRelativePath } from "../internal-urls/skill-protocol";
import type { InternalResource } from "../internal-urls/types";
import { lexShellCommand } from "./shell-lex";
import { ToolError } from "./tool-errors";

const SUPPORTED_INTERNAL_SCHEMES = ["skill", "agent", "artifact", "plan", "memory", "rule", "local", "xcsh"] as const;

type SupportedInternalScheme = (typeof SUPPORTED_INTERNAL_SCHEMES)[number];

interface InternalUrlResolver {
	canHandle(input: string): boolean;
	resolve(input: string): Promise<InternalResource>;
}

/** The part of the sandbox policy this needs, so tests can pass a real policy without a session. */
export interface ReadBoundary {
	cwd: string;
	isAllowed(candidate: string, access: "read"): boolean;
}

export interface InternalUrlExpansionOptions {
	skills: readonly Skill[];
	noEscape?: boolean;
	internalRouter?: InternalUrlResolver;
	localOptions?: LocalProtocolOptions;
	ensureLocalParentDirs?: boolean;
	/**
	 * The session's read boundary. When present, a URL resolving outside it is refused rather than
	 * handed to bash as a path the session's own `read` tool would deny.
	 */
	readBoundary?: ReadBoundary;
	/**
	 * Roots the session owns and may always read, evaluated lazily. The default policy deny-lists the
	 * whole sessions directory, and a session's own artifact root sits inside it, so `artifact://`,
	 * `agent://` and `local://` need this carve-out. Must come from the same resolver the protocols
	 * use — `local://` falls back to a temp root when the session is not persisted.
	 */
	sessionOwnedRoots?: () => readonly string[];
}

import { resolveSkillFromPath } from "../extensibility/skill-resolution";

/**
 * Resolve a single skill:// URL to its absolute filesystem path.
 * Does NOT read file content or verify existence.
 */
export function resolveSkillUrlToPath(url: string, skills: readonly Skill[]): string {
	rejectQueryOrFragment(url);
	const parsed = /^skill:\/\/([^/?#]+)(\/[^?#]*)?$/.exec(url);
	if (!parsed) {
		throw new ToolError(`Invalid skill:// URL: ${url}`);
	}

	let rawHost = parsed[1];
	if (!rawHost) {
		throw new ToolError(`skill:// URL requires a skill name: ${url}`);
	}
	try {
		rawHost = decodeURIComponent(rawHost);
	} catch {
		// Leave as-is if decoding fails
	}

	const rawPathname = parsed[2] ?? "";
	const match = resolveSkillFromPath(rawHost, rawPathname, skills);
	if (!match) {
		const available = skills.map(s => s.name);
		const availableStr = available.length > 0 ? available.join(", ") : "none";
		const requested = rawHost;
		throw new ToolError(`Unknown skill: ${requested}. Available: ${availableStr}`);
	}

	const { skill, relativePath } = match;
	if (!relativePath) {
		return path.resolve(skill.filePath);
	}

	let decodedRelative: string;
	try {
		decodedRelative = decodeURIComponent(relativePath);
	} catch {
		throw new ToolError(`Invalid skill:// URL path encoding: ${url}`);
	}

	try {
		validateRelativePath(decodedRelative);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new ToolError(message);
	}

	const targetPath = path.join(skill.baseDir, decodedRelative);
	const resolvedPath = path.resolve(targetPath);
	const resolvedBaseDir = path.resolve(skill.baseDir);
	if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
		throw new ToolError("Path traversal is not allowed in skill:// URLs");
	}

	return resolvedPath;
}

function extractScheme(url: string): SupportedInternalScheme | undefined {
	const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
	if (!match) return undefined;
	const scheme = match[1].toLowerCase();
	if (!SUPPORTED_INTERNAL_SCHEMES.includes(scheme as SupportedInternalScheme)) return undefined;
	return scheme as SupportedInternalScheme;
}

/**
 * A query string or fragment cannot be represented in a filesystem path.
 *
 * This used to be parsed and discarded, so `xcsh://api-catalog/?resource=origin_pool` resolved to
 * the same path as `xcsh://api-catalog` and the command ran against a different target than the one
 * written, with no warning. Refusing is the only honest option: silently losing part of an argument
 * is worse than either preserving it or failing.
 */
function rejectQueryOrFragment(url: string): void {
	const marker = /[?#]/.exec(url);
	if (!marker) return;
	throw new ToolError(
		`Internal URL cannot carry a query string or fragment in a bash command: ${url}\n` +
			`Remove the "${url.slice(marker.index)}" suffix — it has no meaning as a filesystem path.`,
	);
}

/** Shell-escape a path using single quotes. */
function shellEscape(p: string): string {
	return `'${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Refuse a resolved path the session is not allowed to read.
 *
 * Without this the expander and the sandbox can disagree when an operator configures an explicit
 * directional or recursive boundary. Session-owned roots are still carved out so `artifact://`,
 * `agent://` and `local://` keep working under those opt-in policies. The default production fence
 * preserves named operator access and therefore reaches this check only for enumeration attempts.
 */
function enforceReadBoundary(scheme: SupportedInternalScheme, resolved: string, options: InternalUrlExpansionOptions) {
	const boundary = options.readBoundary;
	if (!boundary) return;
	if (boundary.isAllowed(resolved, "read")) return;

	// Canonicalized containment, not a string prefix: a symlink planted under an owned root must not
	// smuggle a path back out of the boundary.
	for (const root of options.sessionOwnedRoots?.() ?? []) {
		if (pathIsWithin(root, resolved)) return;
	}

	throw new ToolError(
		`${scheme}:// URL resolves outside this session's read boundary (working directory: ${boundary.cwd}): ${resolved}\n` +
			"The session sandbox denies this path, so bash cannot read it. Read it through the URL directly instead of " +
			"shelling out, or widen the boundary with --allow-path / sandbox.allowRead.",
	);
}

async function resolveInternalUrlToPath(url: string, options: InternalUrlExpansionOptions): Promise<string> {
	const scheme = extractScheme(url);
	if (!scheme) {
		throw new ToolError(`Unsupported internal URL in bash command: ${url}`);
	}
	rejectQueryOrFragment(url);

	if (scheme === "skill") {
		const resolved = resolveSkillUrlToPath(url, options.skills);
		enforceReadBoundary(scheme, resolved, options);
		return resolved;
	}

	if (scheme === "local") {
		if (!options.localOptions) {
			throw new ToolError(
				"Cannot resolve local:// URL in bash command: local protocol options are unavailable for this session.",
			);
		}
		const resolvedLocalPath = resolveLocalUrlToPath(url, options.localOptions);
		// The boundary check precedes the mkdir, or a refused URL would still leave a directory behind
		// outside the session's tree.
		enforceReadBoundary(scheme, resolvedLocalPath, options);
		if (options.ensureLocalParentDirs) {
			await fs.mkdir(path.dirname(resolvedLocalPath), { recursive: true });
		}
		return resolvedLocalPath;
	}

	if (!options.internalRouter?.canHandle(url)) {
		throw new ToolError(
			`Cannot resolve ${scheme}:// URL in bash command: ${url}\n` +
				"Internal URL router is unavailable for this protocol in the current session.",
		);
	}

	let resource: InternalResource;
	try {
		resource = await options.internalRouter.resolve(url);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ToolError(`Failed to resolve ${scheme}:// URL in bash command: ${url}\n${message}`);
	}

	if (!resource.sourcePath) {
		throw new ToolError(`${scheme}:// URL resolved without a filesystem path and cannot be used in bash: ${url}`);
	}

	// Rendered docs report their own URL as sourcePath. path.resolve() turned that into a path like
	// `<cwd>/xcsh:/about`, which does not exist, and passed it to bash as though it did.
	if (!path.isAbsolute(resource.sourcePath)) {
		throw new ToolError(
			`${scheme}:// URL resolved to a virtual location, not a file on disk, and cannot be used in bash: ${url}`,
		);
	}

	const resolved = path.resolve(resource.sourcePath);
	enforceReadBoundary(scheme, resolved, options);
	return resolved;
}

/**
 * Expand internal URLs in a bash command to shell-escaped absolute paths.
 *
 * A URL is expanded only when it is an entire shell word at the top level. That is the whole fix for
 * #2468: the expander used to match bare tokens anywhere in the command text, so `echo "A:
 * xcsh://about"` had its argument rewritten — and shell-escaped, leaving stray quotes in the output.
 * It corrupted an issue title on its way to GitHub. Because `word.text` is the literal after quote
 * removal, "the whole word is the URL" is the only thing a match can mean, so quoting no longer
 * changes the outcome: `cat "artifact://7"` still expands, `echo "see artifact://7"` does not.
 *
 * Two consequences worth noting. A URL mentioned in prose is never resolved, so an unknown skill
 * name inside an `echo` string can no longer abort the command. And expansion is top-level only: a
 * word inside `$(…)` or a quoted `sh -c` argument cannot be rewritten, because one level of shell
 * escaping cannot express a path with spaces nested inside an already-quoted word.
 */
export async function expandInternalUrls(command: string, options: InternalUrlExpansionOptions): Promise<string> {
	if (!command.includes("://")) return command;

	const lexed = lexShellCommand(command);
	if (lexed.unterminated) {
		throw new ToolError(
			`Cannot expand internal URLs: the command has unbalanced quotes or an unterminated substitution: ${command}`,
		);
	}

	const candidates = lexed.commands
		.filter(simpleCommand => simpleCommand.depth === 0)
		.flatMap(simpleCommand => simpleCommand.words)
		.filter(word => word.literal && extractScheme(word.text) !== undefined);
	if (candidates.length === 0) return command;

	// Splice from the end so earlier offsets stay valid.
	let expanded = command;
	for (const word of [...candidates].sort((a, b) => b.start - a.start)) {
		const resolvedPath = await resolveInternalUrlToPath(word.text, options);
		const replacement = options.noEscape ? resolvedPath : shellEscape(resolvedPath);
		expanded = `${expanded.slice(0, word.start)}${replacement}${expanded.slice(word.end)}`;
	}

	return expanded;
}
