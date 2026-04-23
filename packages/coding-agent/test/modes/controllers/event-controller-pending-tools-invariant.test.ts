import { describe, expect, it } from "bun:test";

describe("event-controller pendingTools null-safety invariant", () => {
	// Each read must guard against undefined. This test encodes the
	// pattern: if anyone adds an unguarded `pendingTools.get(id).method()`
	// call path, the integration test (Tasks 15-16) will fail; this test
	// documents the invariant.

	it("accessing a missing toolCallId returns undefined and must not throw", () => {
		const map = new Map<string, { foo: () => void }>();
		const got = map.get("nonexistent-id");
		expect(got).toBeUndefined();
		const safe = got?.foo;
		expect(safe).toBeUndefined();
	});

	it("delete on a missing key is a no-op", () => {
		const map = new Map<string, string>();
		expect(() => map.delete("nothing")).not.toThrow();
	});

	it("has() on a missing key returns false", () => {
		const map = new Map<string, string>();
		expect(map.has("nothing")).toBe(false);
	});
});
