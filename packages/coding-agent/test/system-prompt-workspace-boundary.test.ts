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
		expect(flat()).toMatch(/never widen to its parent/i);
	});

	// The sandbox link: enforcement is named so a refusal is legible as the boundary
	// working, which is what stops the reach-for-another-spelling reflex.
	it("names that filesystem isolation is enforced and refusals are not reroutable", () => {
		expect(flat()).toMatch(/isolation is enforced/i);
		expect(flat()).toMatch(/reach the same path another way/i);
	});

	// Guards the non-goal. Work that genuinely spans two subdirectories must stay
	// possible; the requirement is that the crossing be deliberate and stated. This
	// fails if a later edit quietly turns the block into a lockdown.
	it("does not forbid cross-customer work outright", () => {
		expect(flat()).not.toMatch(/MUST NOT (read|access|open|touch) (another|other|a different)/i);
		expect(flat()).toMatch(/state the crossing/i);
	});

	// The non-empty guard is load-bearing: `block()` returns "" when the block is
	// absent, and "" contains no "{{" — so without it this assertion passes vacuously
	// on a prompt that never rendered the block at all.
	it("leaves no unrendered template syntax in the block", () => {
		expect(block()).not.toBe("");
		expect(block()).not.toContain("{{");
	});
});
