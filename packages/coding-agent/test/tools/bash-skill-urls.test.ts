import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMemoriesDir } from "@f5-sales-demo/pi-utils";
import type { Skill } from "../../src/extensibility/skills";
import { resolveLocalUrlToPath } from "../../src/internal-urls";
import { resolveSessionFence } from "../../src/sandbox/session-fence";
import { readBoundaryFor } from "../../src/tools/bash";
import { expandInternalUrls } from "../../src/tools/bash-skill-urls";
import { ToolError } from "../../src/tools/tool-errors";

function shellEscape(p: string): string {
	return `'${p.replace(/'/g, "'\\''")}'`;
}

function createSkill(name: string, baseDir: string): Skill {
	const resolvedBaseDir = path.resolve(baseDir);
	return {
		name,
		description: `${name} description`,
		filePath: path.join(resolvedBaseDir, "SKILL.md"),
		baseDir: resolvedBaseDir,
		source: "test",
	};
}

function createInternalRouter(resources: Record<string, { sourcePath?: string; error?: string }>): {
	canHandle: (input: string) => boolean;
	resolve: (
		input: string,
	) => Promise<{ url: string; content: string; contentType: "text/plain"; sourcePath?: string }>;
} {
	return {
		canHandle: input => /^(agent|artifact|plan|memory|rule|xcsh):\/\//.test(input),
		resolve: async input => {
			const entry = resources[input];
			if (!entry) {
				throw new Error(`No mapping for ${input}`);
			}
			if (entry.error) {
				throw new Error(entry.error);
			}
			return {
				url: input,
				content: "",
				contentType: "text/plain",
				sourcePath: entry.sourcePath,
			};
		},
	};
}

describe("expandInternalUrls — path operands", () => {
	it("expands a skill:// URI to a shell-escaped absolute path", async () => {
		const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
		const expectedPath = path.join(skills[0].baseDir, "scripts/init.py");

		await expect(expandInternalUrls("python skill://valid-skill/scripts/init.py", { skills })).resolves.toBe(
			`python ${shellEscape(expectedPath)}`,
		);
	});

	it("expands multiple URIs in one command", async () => {
		const skills = [
			createSkill("first-skill", "/tmp/skills/first-skill"),
			createSkill("second-skill", "/tmp/skills/second-skill"),
		];
		const firstPath = path.join(skills[0].baseDir, "a.txt");
		const secondPath = path.join(skills[1].baseDir, "b.txt");

		await expect(
			expandInternalUrls("cp skill://first-skill/a.txt skill://second-skill/b.txt", { skills }),
		).resolves.toBe(`cp ${shellEscape(firstPath)} ${shellEscape(secondPath)}`);
	});

	it("expands skill/agent/artifact/memory/rule URLs in one command", async () => {
		const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
		const router = createInternalRouter({
			"artifact://12": { sourcePath: "/tmp/artifacts/12.bash.log" },
			"agent://reviewer_0": { sourcePath: "/tmp/session/reviewer_0.md" },
			"memory://root/memory_summary.md": { sourcePath: "/tmp/memories/memory_summary.md" },
			"rule://rs-no-unwrap": { sourcePath: "/tmp/rules/rs-no-unwrap.md" },
		});
		const command =
			"cat agent://reviewer_0 artifact://12 memory://root/memory_summary.md rule://rs-no-unwrap skill://valid-skill/scripts/init.py";
		const expectedSkillPath = path.join(skills[0].baseDir, "scripts/init.py");

		await expect(expandInternalUrls(command, { skills, internalRouter: router })).resolves.toBe(
			`cat ${shellEscape("/tmp/session/reviewer_0.md")} ${shellEscape("/tmp/artifacts/12.bash.log")} ${shellEscape("/tmp/memories/memory_summary.md")} ${shellEscape("/tmp/rules/rs-no-unwrap.md")} ${shellEscape(expectedSkillPath)}`,
		);
	});

	// A quoted operand is still an operand: the quotes span the whole word and nothing else.
	it("expands a whole-word URI whether bare, single-quoted, or double-quoted", async () => {
		const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
		const expectedPath = path.join(skills[0].baseDir, "scripts/init.py");
		const expected = `python ${shellEscape(expectedPath)}`;

		await expect(expandInternalUrls("python skill://valid-skill/scripts/init.py", { skills })).resolves.toBe(
			expected,
		);
		await expect(expandInternalUrls('python "skill://valid-skill/scripts/init.py"', { skills })).resolves.toBe(
			expected,
		);
		await expect(expandInternalUrls("python 'skill://valid-skill/scripts/init.py'", { skills })).resolves.toBe(
			expected,
		);
	});

	it("expands quoted non-skill URLs and shell-escapes quotes in paths", async () => {
		const router = createInternalRouter({
			"artifact://7": { sourcePath: "/tmp/artifacts/with'quote.log" },
		});
		await expect(expandInternalUrls('cat "artifact://7"', { skills: [], internalRouter: router })).resolves.toBe(
			`cat ${shellEscape("/tmp/artifacts/with'quote.log")}`,
		);
	});

	it("expands local:// URLs to filesystem paths without requiring preexisting files", async () => {
		const localOptions = {
			getArtifactsDir: () => "/tmp/session-artifacts",
			getSessionId: () => "session-1",
		};
		const expectedPath = resolveLocalUrlToPath("local://handoffs/new-file.json", localOptions);

		await expect(
			expandInternalUrls("mv /tmp/source.json local://handoffs/new-file.json", { skills: [], localOptions }),
		).resolves.toBe(`mv /tmp/source.json ${shellEscape(expectedPath)}`);
	});

	it("shell-escapes paths with spaces and single quotes", async () => {
		const spaceSkill = [createSkill("space-skill", "/tmp/skills/with space")];
		await expect(
			expandInternalUrls("python skill://space-skill/scripts/my%20file.py", { skills: spaceSkill }),
		).resolves.toBe(`python ${shellEscape(path.join(spaceSkill[0].baseDir, "scripts/my file.py"))}`);

		const quoteSkill = [createSkill("quote-skill", "/tmp/skills/with'quote")];
		await expect(
			expandInternalUrls("python skill://quote-skill/scripts/init.py", { skills: quoteSkill }),
		).resolves.toBe(`python ${shellEscape(path.join(quoteSkill[0].baseDir, "scripts/init.py"))}`);
	});

	it("resolves skill://name with no relative path to SKILL.md", async () => {
		const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
		await expect(expandInternalUrls("cat skill://valid-skill", { skills })).resolves.toBe(
			`cat ${shellEscape(skills[0].filePath)}`,
		);
	});

	it("returns the command unchanged when there are no internal URLs", async () => {
		await expect(expandInternalUrls("git status", { skills: [] })).resolves.toBe("git status");
	});
});

// #2468: the expander matched bare tokens anywhere in the command text, so a URL merely *mentioned*
// inside a quoted string was rewritten — corrupting data on its way to GitHub, git, and stdout.
describe("expandInternalUrls — argument data is left alone (#2468)", () => {
	const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
	const router = createInternalRouter({ "xcsh://about": { sourcePath: "/tmp/about.md" } });

	it("leaves a URL mentioned inside a quoted word untouched", async () => {
		for (const command of [
			'echo "A: xcsh://about"',
			"echo 'B: see xcsh://about inline'",
			`printf '%s\\n' 'D: xcsh://api-catalog/?resource=origin_pool'`,
			'git commit -m "fix(internal-urls): report the model in xcsh://about"',
		]) {
			await expect(expandInternalUrls(command, { skills, internalRouter: router })).resolves.toBe(command);
		}
	});

	// The reason the original bug corrupted an issue title: a bare token mid-word was matched and
	// the replacement was shell-escaped into the surrounding text.
	it("never injects shell quoting into prose", async () => {
		const command = 'gh issue create --title "report the model in xcsh://about"';
		const result = await expandInternalUrls(command, { skills, internalRouter: router });
		expect(result).toBe(command);
		expect(result).not.toContain("'/tmp/about.md'");
	});

	// An unknown skill inside prose is not an operand, so it must not abort the command.
	it("does not resolve — and so cannot fail on — a URL inside quoted prose", async () => {
		const command = `echo "see skill://no-such-skill/bar inline"`;
		await expect(expandInternalUrls(command, { skills, internalRouter: router })).resolves.toBe(command);
	});

	it("still rejects an unknown skill in operand position", async () => {
		await expect(expandInternalUrls("python skill://missing/run.py", { skills })).rejects.toThrow(
			"Unknown skill: missing. Available: valid-skill",
		);
	});

	// A nested word's offsets index a derived string, and one level of shell escaping cannot express
	// a path with spaces inside an already-quoted -c argument. Expansion is top-level only.
	it("does not expand inside a nested command", async () => {
		for (const command of ["sh -c 'cat artifact://7'", "echo $(cat xcsh://about)"]) {
			await expect(expandInternalUrls(command, { skills, internalRouter: router })).resolves.toBe(command);
		}
	});

	it("refuses to rewrite anything when the command has unbalanced quotes", async () => {
		await expect(expandInternalUrls("cat 'xcsh://about", { skills, internalRouter: router })).rejects.toThrow(
			"unbalanced quotes",
		);
	});
});

describe("expandInternalUrls — query strings and fragments", () => {
	const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];

	// Previously `?resource=origin_pool` was parsed and silently discarded, so the command ran
	// against a different target than the one written. Either outcome below is acceptable — an
	// explicit error, or the text left exactly as authored. Quietly dropping part of it is not.
	it("rejects a quoted whole-word URL carrying a query or fragment", async () => {
		await expect(expandInternalUrls("cat 'skill://valid-skill/a.md?v=1'", { skills })).rejects.toThrow(
			"cannot carry a query string or fragment",
		);
		await expect(expandInternalUrls("cat 'skill://valid-skill/a.md#top'", { skills })).rejects.toThrow(
			"cannot carry a query string or fragment",
		);
		await expect(expandInternalUrls("cat skill://valid-skill/a.md#top", { skills })).rejects.toThrow(
			"cannot carry a query string or fragment",
		);
	});

	it("rejects a query on a router-backed scheme too", async () => {
		const router = createInternalRouter({ "artifact://7": { sourcePath: "/tmp/artifacts/7.log" } });
		await expect(
			expandInternalUrls("cat 'artifact://7?x=1'", { skills: [], internalRouter: router }),
		).rejects.toThrow("cannot carry a query string or fragment");
	});

	// An unquoted `?` is a shell glob, so the word is not a reliable single path and is left exactly
	// as written. The query survives verbatim, which is the property that matters.
	it("leaves an unquoted URL containing a glob character exactly as written", async () => {
		const command = "cat skill://valid-skill/a.md?v=1";
		await expect(expandInternalUrls(command, { skills })).resolves.toBe(command);
	});
});

describe("expandInternalUrls — resolution failures", () => {
	it("throws for path traversal, encoded or plain", async () => {
		const skills = [createSkill("valid-skill", "/tmp/skills/valid-skill")];
		await expect(expandInternalUrls("cat skill://valid-skill/../../../etc/passwd", { skills })).rejects.toThrow(
			"Path traversal (..) is not allowed in skill:// URLs",
		);
		await expect(expandInternalUrls("cat skill://valid-skill/%2E%2E/%2E%2E/etc/passwd", { skills })).rejects.toThrow(
			ToolError,
		);
	});

	it("throws when local:// URL is used without local protocol options", async () => {
		await expect(expandInternalUrls("mv foo local://bar", { skills: [] })).rejects.toThrow(
			"Cannot resolve local:// URL in bash command: local protocol options are unavailable for this session.",
		);
	});

	it("throws when a non-skill URL is used without an internal router", async () => {
		await expect(expandInternalUrls("cat artifact://1", { skills: [] })).rejects.toThrow(
			"Cannot resolve artifact:// URL in bash command",
		);
	});

	it("throws when the router resolves a URL without a sourcePath", async () => {
		const router = createInternalRouter({ "rule://my-rule": {} });
		await expect(expandInternalUrls("cat rule://my-rule", { skills: [], internalRouter: router })).rejects.toThrow(
			"rule:// URL resolved without a filesystem path",
		);
	});

	// xcsh://about reports its own URL as sourcePath. path.resolve() turned that into
	// `<cwd>/xcsh:/about` — a path that does not exist — and handed it to bash.
	it("throws when the router returns a sourcePath that is not a filesystem path", async () => {
		const router = createInternalRouter({ "xcsh://about": { sourcePath: "xcsh://about" } });
		await expect(expandInternalUrls("cat xcsh://about", { skills: [], internalRouter: router })).rejects.toThrow(
			"resolved to a virtual location",
		);
	});

	it("surfaces resolver errors with actionable context", async () => {
		const router = createInternalRouter({ "memory://root/missing.md": { error: "Memory file not found" } });
		await expect(
			expandInternalUrls("cat memory://root/missing.md", { skills: [], internalRouter: router }),
		).rejects.toThrow("Failed to resolve memory:// URL in bash command");
	});
});

// #2468 item 6: the expander and the sandbox disagreed about what was reachable, so bash was handed
// paths the read tool refuses. Tested against the REAL default policy: a permissive stub would hide
// the production failure this check exists to prevent.
describe("expandInternalUrls — session read boundary", () => {
	// Nested in a container, not placed directly in the temp root: the fence must never deny the temp
	// root, so a workspace put straight into it has no denied parent and the "outside the boundary" case
	// below would be reachable for reasons unrelated to this check.
	const container = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-boundary-")));
	const cwd = path.join(container, "session");
	fs.mkdirSync(cwd, { recursive: true });
	// The production adapter, so this exercises what bash actually hands the expander (#2624).
	const policy = readBoundaryFor(resolveSessionFence(cwd, { get: () => undefined }), cwd);

	it("allows a path inside the session's working directory", async () => {
		const inside = path.join(cwd, "notes.md");
		const router = createInternalRouter({ "artifact://1": { sourcePath: inside } });
		await expect(
			expandInternalUrls("cat artifact://1", { skills: [], internalRouter: router, readBoundary: policy }),
		).resolves.toBe(`cat ${shellEscape(inside)}`);
	});

	it("refuses a path outside the boundary, naming the scheme and the boundary", async () => {
		const outside = path.join(container, "xcsh-elsewhere", "secret.md");
		const router = createInternalRouter({ "artifact://2": { sourcePath: outside } });
		const attempt = expandInternalUrls("cat artifact://2", {
			skills: [],
			internalRouter: router,
			readBoundary: policy,
		});
		await expect(attempt).rejects.toThrow("artifact://");
		await expect(attempt).rejects.toThrow("outside this session's read boundary");
	});

	// The default policy deny-lists the whole sessions directory, and a session's own artifact root
	// lives under it — so artifact:// and local:// would break without this carve-out.
	it("allows a path under a session-owned root even when the policy denies its parent", async () => {
		const ownedRoot = path.join(cwd, "..", "xcsh-owned-root");
		fs.mkdirSync(ownedRoot, { recursive: true });
		const owned = path.join(fs.realpathSync(ownedRoot), "12.bash.log");
		const router = createInternalRouter({ "artifact://12": { sourcePath: owned } });

		// Without the carve-out this is outside the boundary.
		await expect(
			expandInternalUrls("cat artifact://12", { skills: [], internalRouter: router, readBoundary: policy }),
		).rejects.toThrow("outside this session's read boundary");

		await expect(
			expandInternalUrls("cat artifact://12", {
				skills: [],
				internalRouter: router,
				readBoundary: policy,
				sessionOwnedRoots: () => [fs.realpathSync(ownedRoot)],
			}),
		).resolves.toBe(`cat ${shellEscape(owned)}`);
	});

	// Containment is canonicalized, so a symlink planted under an owned root cannot smuggle a path
	// back out of the boundary.
	it("refuses a symlink under an owned root that points outside it", async () => {
		// Both inside `container`, whose sibling-of-the-workspace status is what the fence denies. Placed
		// in the temp root instead they would match no rule at all and be allowed by default.
		const ownedRoot = fs.realpathSync(fs.mkdtempSync(path.join(container, "xcsh-owned-")));
		const target = fs.realpathSync(fs.mkdtempSync(path.join(container, "xcsh-target-")));
		const link = path.join(ownedRoot, "escape");
		fs.symlinkSync(target, link);

		const router = createInternalRouter({ "artifact://3": { sourcePath: path.join(link, "secret.md") } });
		await expect(
			expandInternalUrls("cat artifact://3", {
				skills: [],
				internalRouter: router,
				readBoundary: policy,
				sessionOwnedRoots: () => [ownedRoot],
			}),
		).rejects.toThrow("outside this session's read boundary");
	});

	// The concrete #2468 item-6 case: memory:// resolved under ~/.xcsh, which the same session's
	// sandbox refuses to read. Refusing at expansion time is what makes the two agree.
	it("refuses memory:// because the default policy deny-lists the memories directory", async () => {
		const memoryPath = path.join(getMemoriesDir(), "--work--", "memory_summary.md");
		const router = createInternalRouter({ "memory://root": { sourcePath: memoryPath } });
		await expect(
			expandInternalUrls("cat memory://root", { skills: [], internalRouter: router, readBoundary: policy }),
		).rejects.toThrow("outside this session's read boundary");
	});

	it("does not create parent directories for a refused local:// URL", async () => {
		const outsideArtifacts = path.join(container, "xcsh-refused-local");
		fs.rmSync(outsideArtifacts, { recursive: true, force: true });
		const localOptions = {
			getArtifactsDir: () => outsideArtifacts,
			getSessionId: () => "session-1",
		};

		await expect(
			expandInternalUrls("cp x local://handoffs/new.json", {
				skills: [],
				localOptions,
				ensureLocalParentDirs: true,
				readBoundary: policy,
			}),
		).rejects.toThrow("outside this session's read boundary");

		// The directory must not have been created before the refusal.
		expect(fs.existsSync(path.join(outsideArtifacts, "handoffs"))).toBe(false);
	});
});
