import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../../../..");
const workflowPath = path.join(root, ".github/workflows/release-homebrew-backfill.yml");

describe("release Homebrew backfill workflow contract", () => {
	it("binds the immutable tag to the original successful source jobs", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("tag:");
		expect(workflow).toContain("source_run_id:");
		expect(workflow).toContain('.event == "push" and .head_branch == $tag and .head_sha == $tag_sha');
		expect(workflow).toContain("/attempts/1/jobs?per_page=100");
		expect(workflow).toContain("jq -e -f scripts/ci-release-source-jobs.jq");
		expect(workflow).toContain(".immutable == true");
	});

	it("reconciles the cask from immutable ZIPs without publishing npm", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("path: .release-source");
		expect(workflow).toContain("--pattern 'xcsh-*.zip'");
		expect(workflow).toMatch(/RELEASE_TAG: \$\{\{ inputs\.tag \}\}/);
		expect(workflow).toContain('GITHUB_REF_NAME="$RELEASE_TAG" bun scripts/ci-release-homebrew.ts --update-tap');
		expect(workflow).not.toMatch(/GITHUB_REF_NAME: \$\{\{ inputs\.tag \}\}/);
		expect(workflow).toContain("RELEASE_TOKEN");
		expect(workflow).not.toContain("NPM_TOKEN");
		expect(workflow).not.toContain("ci-release-publish.ts");
	});

	it("runs the existing no-sudo UAT on arm64 and Intel macOS", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("os: macos-15-intel");
		expect(workflow).toContain("arch: x64");
		expect(workflow).toContain("os: macos-14");
		expect(workflow).toContain("arch: arm64");
		expect(workflow).toContain('cd "$UAT_HOME"');
		expect(workflow).toContain('sudo -H -u "$UAT_USER" env');
		expect(workflow).toContain('RELEASE_ARCH="$RELEASE_ARCH"');
		expect(workflow).toContain('PATH="$UAT_BREW_PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"');
		expect(workflow).toContain('/bin/bash "$UAT_HOME/ci-verify-homebrew-cask.sh"');
	});
});
