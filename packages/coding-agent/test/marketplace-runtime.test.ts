import { expect, it } from "bun:test";
import { assertRuntimeRequirement } from "../src/extensibility/plugins/marketplace/runtime";

it("rejects too old and malformed runtime requirements before installing", () => {
	expect(() => assertRuntimeRequirement({ name: "salesforce", minimumRuntimeVersion: "22.5.0" }, "22.4.5")).toThrow(
		"22.5.0",
	);
	expect(() => assertRuntimeRequirement({ name: "salesforce", minimumRuntimeVersion: "invalid" }, "22.5.0")).toThrow(
		"Invalid",
	);
	expect(() =>
		assertRuntimeRequirement({ name: "salesforce", minimumRuntimeVersion: "22.5.0" }, "22.5.0"),
	).not.toThrow();
});
