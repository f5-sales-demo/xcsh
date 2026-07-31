import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import type { StartFolder } from "../src/discovery/start-folder";
import { buildSystemPrompt } from "../src/system-prompt";

const OPEN_TAG = "<start-folder>";
const CLOSE_TAG = "</start-folder>";
const MARKER = "%%START_FOLDER%%";

beforeAll(() => {
	registerCodingAgentPromptHelpers();
});

async function render(startFolder: StartFolder, customPrompt?: string): Promise<string> {
	return await buildSystemPrompt({ tools: new Map(), startFolder, customPrompt });
}

/** The block's own text, so an assertion cannot be satisfied by the rest of the prompt. */
function block(rendered: string): string {
	const open = rendered.indexOf(OPEN_TAG);
	const close = rendered.indexOf(CLOSE_TAG);
	if (open === -1 || close === -1) return "";
	return rendered.slice(open, close + CLOSE_TAG.length);
}

/** Whitespace collapsed, so a rewrap cannot fail an assertion whose property still holds. */
function flat(rendered: string): string {
	return block(rendered).replace(/\s+/g, " ");
}

describe("start folder: GitHub-backed repository", () => {
	let out = "";
	beforeAll(async () => {
		out = await render({ kind: "github", slug: "f5-sales-demo/mcn" });
	});

	it("names the repository slug", () => {
		expect(flat(out)).toContain("f5-sales-demo/mcn");
	});

	it("puts git and GitHub work in scope", () => {
		expect(flat(out)).toMatch(/git and github work is in scope/i);
	});

	// The prohibition belongs to the plain branch only. Carrying it here would tell an
	// agent in a real checkout not to offer the version control that is the point of it.
	it("does not carry the do-not-publish rule", () => {
		expect(block(out)).not.toBe("");
		expect(flat(out)).not.toMatch(/MUST NOT/);
	});
});

describe("start folder: repository without a GitHub remote", () => {
	let out = "";
	beforeAll(async () => {
		out = await render({ kind: "git" });
	});

	it("keeps version control in scope but not GitHub actions", () => {
		expect(flat(out)).toMatch(/version control/i);
		expect(flat(out)).toMatch(/not on github/i);
	});

	it("does not invent a slug", () => {
		expect(block(out)).not.toBe("");
		expect(flat(out)).not.toMatch(/[\w-]+\/[\w-]+/);
	});
});

describe("start folder: not a repository", () => {
	let out = "";
	beforeAll(async () => {
		out = await render({ kind: "plain" });
	});

	it("states that the folder is not a repository", () => {
		expect(flat(out)).toMatch(/not a git repository/i);
	});

	// The operator's actual ask: never volunteer it. A folder of tenant automations must
	// not be offered up for publication just because publishing is possible.
	it("forbids offering to initialise or publish it", () => {
		expect(flat(out)).toMatch(/MUST NOT\*{0,2} offer/i);
		expect(flat(out)).toMatch(/git init/);
		expect(flat(out)).toMatch(/publish/i);
	});

	// And the counterweight, so this is a bar on volunteering rather than on doing. The
	// operator knows what is in their own folder; #2637 settled that direction.
	it("still permits it on an explicit request", () => {
		expect(flat(out)).toMatch(/asks for it explicitly|explicitly asks/i);
	});

	it("says why, so the rule is followable rather than arbitrary", () => {
		expect(flat(out)).toMatch(/credential|secret|sensitive/i);
	});
});

describe("start folder block mechanics", () => {
	it("renders exactly one branch, with no marker left behind", async () => {
		for (const sf of [{ kind: "github", slug: "o/r" }, { kind: "git" }, { kind: "plain" }] as StartFolder[]) {
			const out = await render(sf);
			expect(out.split(OPEN_TAG).length - 1).toBe(1);
			expect(out.split(CLOSE_TAG).length - 1).toBe(1);
			expect(out).not.toContain(MARKER);
			expect(block(out)).not.toContain("{{");
			// Exactly one branch: the three are mutually exclusive statements, so a
			// template that fell through would show two of them at once.
			const branches = [/git and github work is in scope/i, /not on github/i, /not a git repository/i].filter(r =>
				r.test(flat(out)),
			);
			expect(branches).toHaveLength(1);
		}
	});

	// A custom system prompt swaps in custom-system-prompt.md, which has no Workspace
	// section. The secrets protection MUST NOT be what disappears when an operator sets
	// --system-prompt; same requirement the workspace boundary and deprecation
	// guardrails already meet, via the same replace-or-append marker.
	it("survives a custom system prompt", async () => {
		const out = await render({ kind: "plain" }, "You are a custom operator prompt.");
		expect(out).toContain(OPEN_TAG);
		expect(out).not.toContain(MARKER);
		expect(flat(out)).toMatch(/MUST NOT\*{0,2} offer/i);
	});

	// End to end, against the real cwd rather than an injected kind: this suite runs
	// inside a GitHub checkout (or a worktree of one, which `repo.root` resolves), so
	// omitting `startFolder` must probe and land on the github branch naming this repo.
	//
	// The fail-safe direction is asserted in start-folder.test.ts against stubbed probes;
	// it cannot be exercised here, because here the probes succeed.
	it("probes the real cwd when no start folder is supplied", async () => {
		const out = await buildSystemPrompt({ tools: new Map() });
		expect(out).toContain(OPEN_TAG);
		expect(flat(out)).toMatch(/git and github work is in scope/i);
		expect(flat(out)).toContain("f5-sales-demo/xcsh");
	});
});
