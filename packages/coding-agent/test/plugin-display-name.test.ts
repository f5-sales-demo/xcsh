import { describe, expect, it } from "bun:test";
import { normalizePluginDisplayName } from "@f5xc-salesdemos/xcsh/modes/components/plugins/state-manager";

describe("normalizePluginDisplayName", () => {
	describe("f5xc- prefix stripping", () => {
		it("strips f5xc- prefix", () => {
			expect(normalizePluginDisplayName("f5xc-brand")).toBe("brand");
		});

		it("strips f5xc- prefix from multi-segment name", () => {
			expect(normalizePluginDisplayName("f5xc-docs-pipeline")).toBe("docs-pipeline");
		});

		it("strips f5xc- prefix from multi-segment name with more parts", () => {
			expect(normalizePluginDisplayName("f5xc-sales-engineer")).toBe("sales-engineer");
		});

		it("strips f5xc- prefix from name that also ends in -status", () => {
			expect(normalizePluginDisplayName("f5xc-cloudstatus")).toBe("cloudstatus");
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

		it("does not treat partial prefix match as f5xc-", () => {
			expect(normalizePluginDisplayName("f5xc")).toBe("f5xc");
		});
	});

	describe("edge cases", () => {
		it("strips both prefix and suffix when both present: f5xc-foo-status → foo", () => {
			expect(normalizePluginDisplayName("f5xc-foo-status")).toBe("foo");
		});

		it("handles f5xc- with single segment after stripping prefix", () => {
			expect(normalizePluginDisplayName("f5xc-platform")).toBe("platform");
		});

		it("handles f5xc- prefix only (trailing dash removed)", () => {
			expect(normalizePluginDisplayName("f5xc-meddpicc")).toBe("meddpicc");
		});

		it("handles f5xc-github-ops", () => {
			expect(normalizePluginDisplayName("f5xc-github-ops")).toBe("github-ops");
		});
	});
});
