import { describe, expect, it } from "bun:test";
import { isLocalSpecsCurrent, normalizeSpecsTag } from "../../scripts/api-specs-version";

describe("normalizeSpecsTag", () => {
	it("strips a leading v", () => {
		expect(normalizeSpecsTag("v2.1.167")).toBe("2.1.167");
	});
	it("leaves a bare version unchanged", () => {
		expect(normalizeSpecsTag("2.1.167")).toBe("2.1.167");
	});
	it("trims surrounding whitespace", () => {
		expect(normalizeSpecsTag("  v2.1.167  ")).toBe("2.1.167");
	});
});

describe("isLocalSpecsCurrent", () => {
	it("is true when the local version matches the latest tag", () => {
		expect(isLocalSpecsCurrent("2.1.167", "v2.1.167")).toBe(true);
	});
	it("is true when neither side has a v prefix", () => {
		expect(isLocalSpecsCurrent("2.1.167", "2.1.167")).toBe(true);
	});
	it("is false when the local checkout is behind the latest release", () => {
		expect(isLocalSpecsCurrent("2.1.137", "v2.1.167")).toBe(false);
	});
	it("is false when the local version is unknown", () => {
		expect(isLocalSpecsCurrent(undefined, "v2.1.167")).toBe(false);
		expect(isLocalSpecsCurrent("", "v2.1.167")).toBe(false);
	});
});
