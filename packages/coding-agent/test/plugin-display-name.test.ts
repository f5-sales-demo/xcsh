import { describe, expect, it } from "bun:test";
import { normalizePluginDisplayName } from "@f5-sales-demo/xcsh/modes/components/plugins/state-manager";

describe("normalizePluginDisplayName", () => {
	describe("xcsh- prefix stripping", () => {
		it("strips xcsh- prefix", () => {
			expect(normalizePluginDisplayName("xcsh-brand")).toBe("brand");
		});

		it("strips xcsh- prefix from multi-segment name", () => {
			expect(normalizePluginDisplayName("xcsh-docs-pipeline")).toBe("docs-pipeline");
		});

		it("strips xcsh- prefix from multi-segment name with more parts", () => {
			expect(normalizePluginDisplayName("xcsh-sales-engineer")).toBe("sales-engineer");
		});

		it("strips xcsh- prefix from name that also ends in -status", () => {
			expect(normalizePluginDisplayName("xcsh-cloudstatus")).toBe("cloudstatus");
		});
	});

	describe("-status suffix stripping", () => {
		it("strips -status suffix", () => {
			expect(normalizePluginDisplayName("aws-status")).toBe("aws");
		});

		it("strips -status suffix from gcloud", () => {
			expect(normalizePluginDisplayName("gcloud-status")).toBe("gcloud");
		});

		it("strips -status suffix from azure", () => {
			expect(normalizePluginDisplayName("azure-status")).toBe("azure");
		});
	});

	describe("no transformation", () => {
		it("leaves plain names unchanged", () => {
			expect(normalizePluginDisplayName("bash-lsp")).toBe("bash-lsp");
		});

		it("leaves css-lsp unchanged", () => {
			expect(normalizePluginDisplayName("css-lsp")).toBe("css-lsp");
		});

		it("leaves eslint-lsp unchanged", () => {
			expect(normalizePluginDisplayName("eslint-lsp")).toBe("eslint-lsp");
		});

		it("does not strip -status when it is the entire name", () => {
			expect(normalizePluginDisplayName("status")).toBe("status");
		});

		it("does not treat partial prefix match as xcsh-", () => {
			expect(normalizePluginDisplayName("xcsh")).toBe("xcsh");
		});
	});

	describe("edge cases", () => {
		it("strips both prefix and suffix when both present: xcsh-foo-status → foo", () => {
			expect(normalizePluginDisplayName("xcsh-foo-status")).toBe("foo");
		});

		it("handles xcsh- with single segment after stripping prefix", () => {
			expect(normalizePluginDisplayName("xcsh-platform")).toBe("platform");
		});

		it("handles xcsh- prefix only (trailing dash removed)", () => {
			expect(normalizePluginDisplayName("xcsh-meddpicc")).toBe("meddpicc");
		});

		it("handles xcsh-github-ops", () => {
			expect(normalizePluginDisplayName("xcsh-github-ops")).toBe("github-ops");
		});
	});
});
