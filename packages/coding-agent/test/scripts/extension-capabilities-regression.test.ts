import { describe, expect, it } from "bun:test";
import { compareContractVersions, regressionReason } from "../../scripts/generate-extension-capabilities";

/**
 * The capability generator adopts a sibling extension checkout's manifest when one is present, and used to
 * do so on the strength of the directory existing (#2578).
 *
 * On a real machine that meant a checkout left at contractVersion 1.8.0 overwrote the committed 1.12.0 and
 * deleted the entire `handshake` feature block — silently, with no error, on every `bun run check`,
 * `bun test` and `bun run build`, because all three run this generator. `release.ts` commits with
 * `git commit -a`, so the downgrade was one release away from shipping a contract four minor versions old.
 *
 * `regressionReason` is the gate. Two independent checks, because they catch different mistakes: a lower
 * version is a stale checkout, while a missing tool or feature at the same-or-higher version is a broken
 * build that a version comparison alone would wave through.
 */
describe("regressionReason", () => {
	const vendored = {
		contractVersion: "1.12.0",
		tools: [{ name: "navigate" }, { name: "click" }],
		features: { handshake: {}, explainMode: {} },
	};

	// The exact shape of the incident.
	it("refuses a sibling whose contract version goes backwards", () => {
		const reason = regressionReason({ ...vendored, contractVersion: "1.8.0" }, vendored);
		expect(reason).toContain("backwards");
		expect(reason).toContain("1.12.0 -> 1.8.0");
	});

	it("refuses a sibling that drops a feature, even at the same version", () => {
		const reason = regressionReason({ ...vendored, features: { explainMode: {} } }, vendored);
		expect(reason).toContain("features would be lost");
		expect(reason).toContain("handshake");
	});

	it("refuses a sibling that drops a tool, even at a higher version", () => {
		const reason = regressionReason(
			{ ...vendored, contractVersion: "2.0.0", tools: [{ name: "navigate" }] },
			vendored,
		);
		expect(reason).toContain("tools would be lost");
		expect(reason).toContain("click");
	});

	it("adopts a genuinely newer sibling that keeps everything", () => {
		const sibling = {
			contractVersion: "1.13.0",
			tools: [...vendored.tools, { name: "screenshot" }],
			features: { ...vendored.features, newThing: {} },
		};
		expect(regressionReason(sibling, vendored)).toBeUndefined();
	});

	it("adopts an identical sibling — the ordinary co-build case", () => {
		expect(regressionReason(vendored, vendored)).toBeUndefined();
	});

	// A manifest with no contractVersion compares as 0.0.0, so it can never overwrite a real one.
	it("refuses a manifest missing its contract version", () => {
		expect(regressionReason({ tools: vendored.tools, features: vendored.features }, vendored)).toContain("backwards");
	});
});

describe("compareContractVersions", () => {
	it("orders by numeric segment, not lexically", () => {
		// The bug this prevents: "1.8.0" > "1.12.0" as strings, which would have called the downgrade an
		// upgrade and adopted it.
		expect(compareContractVersions("1.8.0", "1.12.0")).toBe(-1);
		expect(compareContractVersions("1.12.0", "1.8.0")).toBe(1);
		expect(compareContractVersions("1.12.0", "1.12.0")).toBe(0);
	});

	it("treats absent segments as zero", () => {
		expect(compareContractVersions("1.12", "1.12.0")).toBe(0);
		expect(compareContractVersions("2", "1.99.99")).toBe(1);
	});

	it("does not throw on unparsable input", () => {
		expect(compareContractVersions("", "1.0.0")).toBe(-1);
		expect(compareContractVersions("abc", "1.0.0")).toBe(-1);
	});
});
