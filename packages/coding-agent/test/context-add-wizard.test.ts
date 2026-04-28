import { describe, expect, it } from "bun:test";
import { validateWizardName, validateWizardUrl } from "@f5xc-salesdemos/xcsh/modes/components/context-add-wizard";

describe("validateWizardUrl", () => {
	it("accepts valid HTTPS URL", () => {
		expect(validateWizardUrl("https://acme.console.ves.volterra.io")).toBeNull();
	});

	it("rejects HTTP URL", () => {
		expect(validateWizardUrl("http://acme.console.ves.volterra.io")).not.toBeNull();
	});

	it("rejects non-URL string", () => {
		expect(validateWizardUrl("not-a-url")).not.toBeNull();
	});

	it("rejects empty string", () => {
		expect(validateWizardUrl("")).not.toBeNull();
	});
});

describe("validateWizardName", () => {
	it("accepts alphanumeric with hyphens and underscores", () => {
		expect(validateWizardName("my-context")).toBeNull();
		expect(validateWizardName("prod_01")).toBeNull();
	});

	it("rejects empty string", () => {
		expect(validateWizardName("")).not.toBeNull();
	});

	it("rejects strings over 64 characters", () => {
		expect(validateWizardName("a".repeat(65))).not.toBeNull();
	});

	it("rejects special characters", () => {
		expect(validateWizardName("my context")).not.toBeNull();
		expect(validateWizardName("prod@01")).not.toBeNull();
	});
});
