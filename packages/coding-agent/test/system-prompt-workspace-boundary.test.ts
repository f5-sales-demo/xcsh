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
	// tenants, they are all inside the allowed subtree, so separating them is
	// judgment and nothing else.
	//
	// "tenant" is deliberate: it is the agnostic term for one bounded scope of work,
	// and it matches the F5 XC tenant named in the Platform Context block directly
	// below. "customer" would be narrower than the category this actually covers.
	it("covers the case the fence leaves open", () => {
		expect(flat()).toMatch(/subdirectories of the working directory/i);
		expect(flat()).toMatch(/your judgment/i);
	});

	// #2643 review, confirmed. `resolveSessionFence` returns undefined outright when
	// `sandbox.enabled` is false, so under `--no-sandbox` nothing is refused anywhere.
	// Scoping this block to subdirectories of the working directory would leave those
	// sessions with no always-loaded statement about tenant scope at all — the text
	// that covers it (containment.md) sits behind the `xcsh://` gate, which the prompt
	// tells the model not to read unless asked about xcsh itself.
	//
	// Stated as judgment, never as a prohibition on reading: the point is that reaching
	// something is not the same as it being in scope, not that paths are off limits.
	it("covers sessions where filesystem isolation is off", () => {
		expect(flat()).toMatch(/isolation is off/i);
		expect(flat()).toMatch(/not the same as it being in scope/i);
	});

	// #2643 review round 2, confirmed. "Work in the one the task names" is guidance,
	// not a rule, so the only MUST NOT covered merging — leaving an agent free to read
	// a neighbouring tenant's secrets for "precedent" without breaking anything
	// explicit. That accidental context loading is the whole reason this block exists.
	//
	// The rule is scoped to TENANTS and conditioned on the task, which is what keeps it
	// a useful control rather than a filesystem-wide prohibition: it says nothing about
	// the paths the fence deliberately leaves open.
	it("forbids opening another tenant only when the task did not ask", () => {
		expect(flat()).toMatch(/MUST NOT\*{0,2} open another tenant/i);
		expect(flat()).toMatch(/the task did not ask/i);
	});

	// Guards the non-goal. Work that genuinely spans two tenants must stay possible;
	// the requirement is that the crossing be deliberate and stated. A MUST NOT about
	// opening another tenant is acceptable ONLY while that permission survives beside
	// it, so this guards the permission rather than pattern-matching the prohibition.
	it("does not forbid cross-tenant work outright", () => {
		expect(flat()).toMatch(/say so when the task genuinely spans more than one/i);
		expect(flat()).toMatch(/MUST NOT\*{0,2} merge two tenants/i);
		expect(flat()).not.toMatch(/MUST NOT\*{0,2} (work|operate|act) across/i);
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
 * and "nothing refuses a sibling" (too broad once the workspace parent stopped being
 * enumerable). Prose cannot be trusted to stay true about code it does not import.
 *
 * So the claim is measured rather than reviewed. If the deny logic changes again, this
 * fails and names the sentence that went stale, instead of shipping a confident
 * falsehood in every session's prompt.
 */
describe("workspace boundary claims match the real fence", () => {
	let tmp: TempDir;
	let parent: string;
	let tenantA: string;
	let tenantB: string;

	beforeAll(() => {
		tmp = TempDir.createSync("xcsh-boundary-claim-");
		parent = path.join(tmp.absolute(), "customers");
		tenantA = path.join(parent, "tenantA");
		tenantB = path.join(parent, "tenantB");
		fs.mkdirSync(tenantA, { recursive: true });
		fs.mkdirSync(tenantB, { recursive: true });
		fs.writeFileSync(path.join(tenantA, "notes.md"), "a");
		fs.writeFileSync(path.join(tenantB, "secret.env"), "TOKEN=b");
	});

	afterAll(() => tmp.removeSync());

	/** Whether the `read` tool would be refused from `cwd`, through the real session fence. */
	function refuses(cwd: string, filePath: string): boolean {
		const fence = resolveSessionFence(cwd, { get: () => undefined });
		if (!fence) throw new Error("expected a fence: sandboxing should default to on");
		return evaluateToolCall({ toolName: "read", input: { file_path: filePath }, cwd, fence }).block;
	}

	// What the block claims: from a working directory holding several tenants, every
	// one of them is reachable and no crossing is refused.
	it("is right that a crossing between children of the working directory is not refused", () => {
		expect(refuses(parent, path.join(tenantA, "notes.md"))).toBe(false);
		expect(refuses(parent, path.join(tenantB, "secret.env"))).toBe(false);
	});

	// From inside one tenant the courtesy boundary removes discovery, not operator authority. The
	// parent cannot be listed, but a sibling file named by the task remains reachable. The prompt must
	// therefore keep tenant separation in judgment instead of claiming the filesystem makes it happen.
	it("matches the discovery-only boundary around sibling workspaces", () => {
		expect(refuses(tenantA, parent)).toBe(true);
		expect(refuses(tenantA, path.join(tenantB, "secret.env"))).toBe(false);
		expect(flat()).toMatch(/keeping tenants apart is your judgment/i);
		expect(flat()).not.toMatch(/filesystem (?:refuses|prevents|blocks) (?:a )?sibling/i);
	});
});
