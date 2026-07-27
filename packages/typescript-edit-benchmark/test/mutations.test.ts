/**
 * Contract of the AST mutations' snippet rendering (#2428).
 *
 * `mutations.ts` had no test coverage at all, which is how it came to carry a
 * monkey-patch of an unexported Babel internal (`generatorInfosMap`) with nothing
 * pinning what the patch was for. These tests pin the two properties that matter,
 * so the patch can be removed and the loss — if any — is visible:
 *
 *  1. A node whose subtree contains `(x: T)` (`TSTypeCastExpression`, which
 *     `@babel/generator` cannot print) still renders a non-empty snippet.
 *  2. `mutatedSnippet` reflects the MUTATION, not the original source. This is the
 *     one that makes the fix non-obvious: mutations edit the AST in place, so a
 *     mutated node's `start`/`end` still point at the ORIGINAL text. Rendering it
 *     by slicing source would silently return the pre-mutation string — and, worse,
 *     `buildEdits` uses that same string as the replacement written to the file, so
 *     the edit would be a no-op and every AST mutation would quietly stop working.
 */
import { describe, expect, test } from "bun:test";
import { ALL_MUTATIONS } from "../src/mutations";

/** Deterministic rng so a mutation's random choice is reproducible. */
function seededRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function mutationNamed(name: string) {
	const m = ALL_MUTATIONS.find(x => x.name === name);
	if (!m) throw new Error(`no mutation named ${name}; have: ${ALL_MUTATIONS.map(x => x.name).join(", ")}`);
	return m;
}

/**
 * A `(x: T)` parenthesised annotation that genuinely reaches `TSTypeCastExpression`.
 *
 * The `abstract class` is load-bearing, not decoration. `parseCode` tries its FLOW
 * plugin set first and only falls through to the TypeScript set when flow throws —
 * and under flow, `(a: number)` is a perfectly ordinary `TypeCastExpression` that
 * the generator prints without complaint. So a plain `.ts`-looking fixture never
 * reaches the TS parser at all. `abstract` is TS-only syntax, which makes the flow
 * parse fail, which is what routes this source to the TypeScript plugin set where
 * `(a: number)` becomes the unprintable `TSTypeCastExpression`.
 */
const WITH_TYPE_CAST = `abstract class Shape {
	abstract area(): number;
}
function pick(a: number, b: number) {
	if (a < b) {
		const y = (a: number);
		return y;
	} else {
		return b;
	}
}
`;

const PLAIN = `function pick(a: number, b: number) {
	if (a <= b) {
		return a;
	}
	return b;
}
`;

describe("snippet rendering survives nodes the generator cannot print (#2428)", () => {
	test("a mutation over a node containing (x: T) still produces a non-empty mutated snippet", () => {
		const swapIfElse = mutationNamed("swap-if-else");
		expect(swapIfElse.canApply(WITH_TYPE_CAST)).toBe(true);

		const [mutated, info] = swapIfElse.mutate(WITH_TYPE_CAST, seededRng(7));

		// The whole point of the removed generatorInfosMap patch: this node's subtree
		// contains a TSTypeCastExpression, so `generate()` throws on it.
		expect(info.mutatedSnippet).not.toBe("");
		expect(mutated).not.toBe(WITH_TYPE_CAST);
		expect(info.lineNumber).toBeGreaterThan(0);
	});

	test("the cast is normalized to the equivalent `as` expression, not dropped", () => {
		// `(a: number)` is rewritten to `a as number` at the parse boundary — the same
		// rendering the removed generator monkey-patch produced by hand. Assert the
		// binding is carried through rather than silently lost.
		//
		// Note the assertion targets `y = a as number` specifically: a bare
		// `toContain("a: number")` would pass on the untouched `pick(a: number, ...)`
		// signature elsewhere in the fixture and prove nothing.
		const [mutated] = mutationNamed("swap-if-else").mutate(WITH_TYPE_CAST, seededRng(7));
		expect(mutated).toContain("y = a as number");
		expect(mutated).not.toContain("y = (a: number)"); // the scratch form is gone
	});

	test("normalization leaves valid TypeScript untouched", () => {
		// The rewrite must be inert for code that never produced a scratch node.
		const [mutated, info] = mutationNamed("swap-comparison").mutate(PLAIN, seededRng(3));
		expect(mutated).toContain("function pick(a: number, b: number)"); // annotations intact
		expect(mutated).not.toContain(" as "); // nothing spuriously rewritten
		expect(info.lineNumber).toBeGreaterThan(0);
	});
});

describe("mutatedSnippet reflects the mutation, not the original source", () => {
	test("swap-comparison reports the swapped operator and actually edits the file", () => {
		const [mutated, info] = mutationNamed("swap-comparison").mutate(PLAIN, seededRng(3));

		expect(mutated).not.toBe(PLAIN); // a real edit landed
		expect(info.originalSnippet).toBe("a <= b");
		expect(info.mutatedSnippet).toBe("a < b"); // the SWAPPED form, not the source slice
		expect(info.mutatedSnippet).not.toBe(info.originalSnippet);
		expect(mutated).toContain("a < b");
	});

	test("every applicable mutation that reports a change actually changes the content", () => {
		// Guards the failure mode where a snippet regression turns edits into no-ops:
		// buildEdits writes snippetFromNode's output back into the file, so if that
		// ever returned the original slice the edit would be identity and mutate()
		// would silently report a no-op for every mutation at once.
		const applied: string[] = [];
		for (const m of ALL_MUTATIONS) {
			if (!m.canApply(PLAIN)) continue;
			const [mutated, info] = m.mutate(PLAIN, seededRng(11));
			if (info.lineNumber === 0) continue; // declined this input — fine
			applied.push(m.name);
			expect(mutated).not.toBe(PLAIN);
		}
		expect(applied.length).toBeGreaterThan(0);
	});
});
