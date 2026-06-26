import { describe, expect, it } from "bun:test";
import { validateWizardName, validateWizardUrl } from "@f5-sales-demo/xcsh/modes/components/context-add-wizard";

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

	it("rejects incomplete hostname with trailing dot only", () => {
		expect(validateWizardUrl("https://api.")).not.toBeNull();
	});

	it("rejects single-label hostname without domain", () => {
		expect(validateWizardUrl("https://localhost")).not.toBeNull();
	});

	it("accepts valid multi-label hostname", () => {
		expect(validateWizardUrl("https://api.example.com")).toBeNull();
		expect(validateWizardUrl("https://acme.console.ves.volterra.io")).toBeNull();
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
