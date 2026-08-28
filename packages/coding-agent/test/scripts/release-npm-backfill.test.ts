import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	isAlreadyPublished,
	isExactRegistryVersion,
	npmPublishArgs,
	resolveReleaseSourceRoot,
	waitForRegistryVisibility,
} from "../../../../scripts/ci-release-publish";

const root = path.resolve(import.meta.dir, "../../../..");
const workflowPath = path.join(root, ".github/workflows/release-npm-backfill.yml");

describe("release npm backfill publish semantics", () => {
	it("does not misclassify a lower-than-latest dist-tag rejection as already published", () => {
		const output =
			'npm error Cannot implicitly apply the "latest" tag because previously published version 20.19.3 is higher than the new version 20.13.1. You must specify a tag using --tag.';
		expect(isAlreadyPublished(output, "20.13.1")).toBe(false);
	});

	it("recognizes only an exact existing-version conflict", () => {
		const output = "npm error EPUBLISHCONFLICT Cannot publish over previously published version 20.13.1.";
		expect(isAlreadyPublished(output, "20.13.1")).toBe(true);
		expect(isAlreadyPublished(output, "20.15.0")).toBe(false);
	});

	it("adds an explicit non-latest dist-tag for backfills", () => {
		expect(npmPublishArgs()).toEqual(["npm", "publish", "--access", "public"]);
		expect(npmPublishArgs("backfill")).toEqual(["npm", "publish", "--access", "public", "--tag", "backfill"]);
	});

	it("rejects malformed or latest backfill tags", () => {
		expect(() => npmPublishArgs("latest")).toThrow(/latest/);
		expect(() => npmPublishArgs("bad tag")).toThrow(/dist-tag/);
	});

	it("requires an absolute isolated release-source root", () => {
		expect(resolveReleaseSourceRoot("/tmp/release-source")).toBe("/tmp/release-source");
		expect(() => resolveReleaseSourceRoot("release-source")).toThrow(/absolute/);
	});

	it("accepts only the exact registry version response", () => {
		expect(isExactRegistryVersion('"21.0.0"', "21.0.0")).toBe(true);
		expect(isExactRegistryVersion('"20.22.3"', "21.0.0")).toBe(false);
		expect(isExactRegistryVersion("not-json", "21.0.0")).toBe(false);
		expect(isExactRegistryVersion('{"version":"21.0.0"}', "21.0.0")).toBe(false);
	});

	it("waits for exact registry visibility before returning", async () => {
		const responses = [null, '"20.22.3"', '"21.0.0"'];
		const sleeps: number[] = [];
		const attempts = await waitForRegistryVisibility("@f5-sales-demo/pi-agent-core", "21.0.0", {
			lookup: async () => responses.shift() ?? null,
			sleep: async delayMs => {
				sleeps.push(delayMs);
			},
			initialDelayMs: 5,
			maxDelayMs: 10,
			maxAttempts: 3,
		});

		expect(attempts).toBe(3);
		expect(sleeps).toEqual([5, 10]);
	});

	it("identifies the exact package and version on registry timeout", async () => {
		expect(
			waitForRegistryVisibility("@f5-sales-demo/pi-agent-core", "21.0.0", {
				lookup: async () => null,
				sleep: async () => {},
				maxAttempts: 2,
			}),
		).rejects.toThrow("@f5-sales-demo/pi-agent-core@21.0.0");
	});
});

describe("release npm backfill workflow contract", () => {
	it("binds a manual backfill to an immutable tag and original run", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("tag:");
		expect(workflow).toContain("source_run_id:");
		expect(workflow).toContain('event == "push"');
		expect(workflow).toContain("head_branch == $tag");
		expect(workflow).toContain("head_sha == $tag_sha");
		expect(workflow).toContain(".immutable == true");
		expect(workflow).toContain('select(.name == "check" or .name == "test" or .name == "Test installation methods")');
		expect(workflow).toContain('select(.name | startswith("Native build ("))');
	});

	it("publishes from the isolated tag checkout without moving latest", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("path: .release-source");
		expect(workflow).toContain("XCSH_RELEASE_SOURCE_ROOT:");
		expect(workflow).toContain("bun scripts/ci-release-publish.ts --tag backfill");
		expect(workflow).toContain("NPM_TOKEN");
		expect(workflow).toContain("dist-tags.latest");
		expect(workflow).toContain("LATEST_BEFORE");
		expect(workflow).toContain("@f5-sales-demo/xcsh@");
	});
});
