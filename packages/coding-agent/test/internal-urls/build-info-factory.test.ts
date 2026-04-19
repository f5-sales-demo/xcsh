import { describe, expect, it } from "bun:test";
import { detectCompiledRuntime, findGitRoot, getRuntimeBuildInfo } from "../../src/internal-urls/build-info-runtime";

describe("detectCompiledRuntime", () => {
	it("is true when URL contains the $bunfs marker", () => {
		expect(detectCompiledRuntime("bunfs:///$bunfs/root/x.ts", {})).toBe(true);
	});

	it("is true when URL contains the ~BUN marker", () => {
		expect(detectCompiledRuntime("file:///~BUN/root/x.ts", {})).toBe(true);
	});

	it("is true when URL contains the URL-encoded %7EBUN marker", () => {
		expect(detectCompiledRuntime("file:///%7EBUN/root/x.ts", {})).toBe(true);
	});

	it("is true when PI_COMPILED env is set, even for plain URLs", () => {
		expect(detectCompiledRuntime("file:///home/dev/xcsh/src/x.ts", { PI_COMPILED: "1" })).toBe(true);
	});

	it("is false for an ordinary source file:// URL with no env", () => {
		expect(detectCompiledRuntime("file:///home/dev/xcsh/src/x.ts", {})).toBe(false);
	});

	it("is false when PI_COMPILED env is explicitly empty", () => {
		expect(detectCompiledRuntime("file:///home/dev/xcsh/src/x.ts", { PI_COMPILED: "" })).toBe(false);
	});

	it("is true if any one of the markers is present (first match short-circuits)", () => {
		expect(detectCompiledRuntime("bunfs:///~BUN/$bunfs/%7EBUN/x.ts", {})).toBe(true);
	});
});

describe("findGitRoot", () => {
	const exists =
		(paths: string[]) =>
		(p: string): boolean =>
			paths.includes(p);

	it("returns startDir when .git exists right there", () => {
		const start = "/repo";
		expect(findGitRoot(start, exists(["/repo/.git"]))).toBe("/repo");
	});

	it("walks up to find .git in an ancestor", () => {
		const start = "/repo/packages/coding-agent/src/internal-urls";
		expect(findGitRoot(start, exists(["/repo/.git"]))).toBe("/repo");
	});

	it("returns null when no ancestor has .git", () => {
		expect(findGitRoot("/tmp/nothing/here", exists([]))).toBe(null);
	});

	it("terminates at filesystem root without infinite loop", () => {
		let calls = 0;
		const exists = (_p: string) => {
			calls += 1;
			if (calls > 50) throw new Error("walked too far");
			return false;
		};
		expect(findGitRoot("/tmp/a/b/c", exists)).toBe(null);
		expect(calls).toBeLessThan(10);
	});
});

describe("getRuntimeBuildInfo (no cache)", () => {
	it("re-resolves on every call — does not memoize across calls", async () => {
		const first = await getRuntimeBuildInfo();
		const second = await getRuntimeBuildInfo();
		expect(first).not.toBe(second);
		expect(first.resolvedAt).not.toBe("");
		expect(second.resolvedAt).not.toBe("");
	});
});
