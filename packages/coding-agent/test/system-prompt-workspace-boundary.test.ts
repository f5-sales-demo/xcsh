import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { evaluateToolCall } from "../src/sandbox/enforce";
import { resolveSessionFence } from "../src/sandbox/session-fence";
import { buildSystemPrompt } from "../src/system-prompt";

const OPEN_TAG = "<workspace-boundary>";
const CLOSE_TAG = "</workspace-boundary>";

let rendered = "";

beforeAll(async () => {
	registerCodingAgentPromptHelpers();
	rendered = await buildSystemPrompt({ tools: new Map() });
});

/** The block's own text, so assertions about it cannot be satisfied by the rest of the prompt. */
function block(): string {
	const open = rendered.indexOf(OPEN_TAG);
	const close = rendered.indexOf(CLOSE_TAG);
	if (open === -1 || close === -1) return "";
	return rendered.slice(open, close + CLOSE_TAG.length);
}

/**
 * The block with whitespace runs collapsed, for matching prose.
 *
 * The block is hard-wrapped, so a phrase can straddle a line break plus its indent.
 * Matching the raw text would make these assertions fail on a rewrap that changed
 * nothing about the meaning.
 */
function flat(): string {
	return block().replace(/\s+/g, " ");
}

function count(needle: string): number {
	return rendered.split(needle).length - 1;
}

describe("system prompt workspace boundary", () => {
	it("renders the block exactly once", () => {
		expect(count(OPEN_TAG)).toBe(1);
		expect(count(CLOSE_TAG)).toBe(1);
		expect(rendered).not.toContain("%%WORKSPACE_BOUNDARY%%");
	});

	// The filesystem scope belongs beside the F5 XC tenant/namespace scope — the two
	// things that bound a session — not appended wherever it happened to fit.
	it("places the block inside the Workspace section", () => {
		const workstation = rendered.indexOf("</workstation>");
		const boundary = rendered.indexOf(OPEN_TAG);
		const nextSection = rendered.indexOf("## Resource Manifest Format");
		expect(workstation).toBeGreaterThan(-1);
		expect(nextSection).toBeGreaterThan(-1);
		expect(boundary).toBeGreaterThan(workstation);
		expect(boundary).toBeLessThan(nextSection);
	});

	// The one thing the fence cannot do. Where the working directory holds several
	// customers, they are all inside the allowed subtree, so separating them is
	// judgment and nothing else.
	it("covers the case the fence leaves open", () => {
		expect(flat()).toMatch(/subdirectories of the working directory may be separate customers/i);
		expect(flat()).toMatch(/your judgment/i);
	});

	// Guards the non-goal. Work that genuinely spans two subdirectories must stay
	// possible; the requirement is that the crossing be deliberate and stated. This
	// fails if a later edit quietly turns the block into a lockdown.
	it("does not forbid cross-customer work outright", () => {
		expect(flat()).not.toMatch(/MUST NOT (read|access|open|touch) (another|other|a different)/i);
		expect(flat()).toMatch(/say so when the task genuinely spans more than one/i);
		expect(flat()).toMatch(/MUST NOT\*{0,2} merge two customers/i);
	});

	// #2643. The block must not re-impose at the prompt layer what the fence
	// deliberately stopped enforcing: `containment.ts` records that a deny-by-default
	// boundary "refuses ordinary work", and the wider filesystem is open on purpose.
	// A blanket prohibition on looking anywhere is the restriction that was removed.
	it("does not prohibit reading paths the fence allows", () => {
		expect(flat()).not.toMatch(/range across the filesystem/i);
		expect(flat()).not.toMatch(/never widen/i);
	});

	// A custom system prompt (--system-prompt, or an auto-discovered project/global
	// SYSTEM.md) swaps in custom-system-prompt.md, which has no Workspace section. The
	// confidentiality guidance MUST NOT be the thing that disappears when an operator
	// customises their prompt. Same requirement the deprecation guardrails already meet,
	// via the same replace-or-append marker.
	it("survives a custom system prompt", async () => {
		const custom = await buildSystemPrompt({
			tools: new Map(),
			customPrompt: "You are a custom operator prompt.",
		});
		expect(custom).toContain(OPEN_TAG);
		expect(custom).toContain(CLOSE_TAG);
		expect(custom).not.toContain("%%WORKSPACE_BOUNDARY%%");
	});

	// The non-empty guard is load-bearing: `block()` returns "" when the block is
	// absent, and "" contains no "{{" — so without it this assertion passes vacuously
	// on a prompt that never rendered the block at all.
	it("leaves no unrendered template syntax in the block", () => {
		expect(block()).not.toBe("");
		expect(block()).not.toContain("{{");
	});
});

/**
 * Binds the prompt's description of reachability to what the fence actually does.
 *
 * This block has twice asserted a mechanism fact that reality contradicted: an
 * unconditional "isolation is enforced" (false under `--no-sandbox`, caught in review),
 * and "nothing refuses a sibling" (true when written, falsified a day later when #2624 /
 * #2637 unified the fence and started denying the workspace's parent). Prose cannot be
 * trusted to stay true about code it does not import.
 *
 * So the claim is measured rather than reviewed. If the deny logic changes again, this
 * fails and names the sentence that went stale, instead of shipping a confident
 * falsehood in every session's prompt.
 */
describe("workspace boundary claims match the real fence", () => {
	let tmp: TempDir;
	let parent: string;
	let custA: string;
	let custB: string;

	beforeAll(() => {
		tmp = TempDir.createSync("xcsh-boundary-claim-");
		parent = path.join(tmp.absolute(), "customers");
		custA = path.join(parent, "custA");
		custB = path.join(parent, "custB");
		fs.mkdirSync(custA, { recursive: true });
		fs.mkdirSync(custB, { recursive: true });
		fs.writeFileSync(path.join(custA, "notes.md"), "a");
		fs.writeFileSync(path.join(custB, "secret.env"), "TOKEN=b");
	});

	afterAll(() => tmp.removeSync());

	/** Whether the `read` tool would be refused from `cwd`, through the real session fence. */
	function refuses(cwd: string, filePath: string): boolean {
		const fence = resolveSessionFence(cwd, { get: () => undefined });
		if (!fence) throw new Error("expected a fence: sandboxing should default to on");
		return evaluateToolCall({ toolName: "read", input: { file_path: filePath }, cwd, fence }).block;
	}

	// What the block claims: from a working directory holding several customers, every
	// one of them is reachable and no crossing is refused.
	it("is right that a crossing between children of the working directory is not refused", () => {
		expect(refuses(parent, path.join(custA, "notes.md"))).toBe(false);
		expect(refuses(parent, path.join(custB, "secret.env"))).toBe(false);
	});

	// And the converse the block must NOT claim. From inside one customer the fence
	// denies the parent, so a sibling read IS refused — the generalisation this block
	// used to make ("nothing refuses a sibling") is false and must not come back.
	it("does not let the block generalise to siblings the fence refuses", () => {
		const siblingRefused = refuses(custA, path.join(custB, "secret.env"));
		expect(siblingRefused).toBe(true);
		expect(flat()).not.toMatch(/nothing refuses a sibling/i);
		expect(flat()).not.toMatch(/boundary is the working directory, not the customer subdirectory/i);
	});
});
