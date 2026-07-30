import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
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
 * The block is hard-wrapped, so a phrase can straddle a line break plus its indent
 * ("reach the\n  same path another way"). Matching the raw text would make these
 * assertions fail on a rewrap that changed nothing about the meaning.
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

	// A possibility, never an assertion: nothing in the prompt knows the directory's
	// shape, because a customer boundary is not visible in the filesystem.
	it("primes the single-customer case without asserting it", () => {
		expect(flat()).toMatch(/may be scoped to a single customer/i);
	});

	it("prohibits ranging across the filesystem for context", () => {
		expect(flat()).toContain("**MUST NOT** range across the filesystem");
	});

	// `buildDefaultSandboxPolicy` allows reads OUTSIDE the CWD: user-level skills, the
	// plugin dir, and any `--allow-path` / `sandbox.allowRead` grant. An absolute "never
	// widen beyond the working directory" would forbid paths the operator deliberately
	// granted, and would contradict the Procedure section's "if a skill matches the
	// domain, you MUST read it before starting".
	it("acknowledges explicit grants and the allowlisted read locations", () => {
		expect(flat()).toMatch(/--allow-path/);
		expect(flat()).toMatch(/skills and plugins/i);
		expect(flat()).not.toMatch(/never widen to its parent/i);
	});

	// The sandbox link: naming the sandbox is what makes a refusal legible as the
	// boundary working, which stops the reach-for-another-spelling reflex.
	//
	// But it MUST be conditional. `buildSystemPrompt` is handed no containment status,
	// so the block cannot know whether isolation is on; under `--no-sandbox` or
	// `sandbox.enabled: false` nothing is refused at all. Asserting enforcement as fact
	// would give a deliberately-degraded session false assurance about isolation.
	it("names the sandbox without asserting enforcement unconditionally", () => {
		expect(flat()).toMatch(/sandbox confines this session/i);
		expect(flat()).toMatch(/when it is active/i);
		expect(flat()).not.toMatch(/isolation is enforced/i);
		expect(flat()).toMatch(/reach the same path another way/i);
	});

	// Guards the non-goal. Work that genuinely spans two subdirectories must stay
	// possible; the requirement is that the crossing be deliberate and stated. This
	// fails if a later edit quietly turns the block into a lockdown.
	it("does not forbid cross-customer work outright", () => {
		expect(flat()).not.toMatch(/MUST NOT (read|access|open|touch) (another|other|a different)/i);
		expect(flat()).toMatch(/state the crossing/i);
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
