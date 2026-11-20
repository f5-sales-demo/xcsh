import { describe, expect, it } from "bun:test";
import { formatContent } from "../src/formatter";

describe("formatContent", () => {
	// Probe the `.js` -> flow pin with Flow-EXCLUSIVE syntax rather than TS-only syntax.
	// Prettier's flow parser keeps widening to accept TS-shaped constructs (as of 3.9.x it parses
	// `namespace`, `enum`, and `satisfies`), so a TS-only probe silently stops distinguishing
	// `flow` from `babel-ts`. `opaque type` is rejected by both `typescript` and `babel-ts`, so
	// formatting it is positive proof that flow is the parser actually in use.
	const flowOnlySyntax = "opaque type ID = string;\n";
	// This syntax is accepted by current Flow as well as TypeScript; it tests .ts formatting.
	const tsOnlySyntax = "abstract class A {\n  abstract m(): void;\n}\n";

	it("pins .js files to the flow parser (no fallback to babel-ts)", async () => {
		const result = await formatContent("fixture.js", flowOnlySyntax);

		expect(result.didFormat).toBe(true);
		expect(result.formatted).toBe(flowOnlySyntax);
	});

	it("pins .jsx files to the flow parser (no fallback to babel-ts)", async () => {
		const result = await formatContent("fixture.jsx", flowOnlySyntax);

		expect(result.didFormat).toBe(true);
		expect(result.formatted).toBe(flowOnlySyntax);
	});

	it("leaves invalid syntax in a .js file unformatted", async () => {
		const invalidSyntax = "const = ;\n";
		const result = await formatContent("fixture.js", invalidSyntax);

		expect(result.didFormat).toBe(false);
		expect(result.formatted).toBe(invalidSyntax);
	});

	it("routes .ts files to the typescript parser", async () => {
		const result = await formatContent("fixture.ts", tsOnlySyntax);

		expect(result.didFormat).toBe(true);
		expect(result.formatted).toBe(tsOnlySyntax);
	});

	it("leaves an unmapped extension untouched", async () => {
		const content = "whatever\n";
		const result = await formatContent("fixture.bin", content);

		expect(result.didFormat).toBe(false);
		expect(result.formatted).toBe(content);
	});
});
