import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	isAlreadyPublished,
	isExactRegistryVersion,
	npmPublishArgs,
	publishWithRetry,
	resolveReleaseSourceRoot,
	waitForPublishedPackages,
	waitForRegistryVisibility,
} from "../../../../scripts/ci-release-publish";

const root = path.resolve(import.meta.dir, "../../../..");
const nativesPackageRoot = path.join(root, "packages/natives");
const ciWorkflowPath = path.join(root, ".github/workflows/ci.yml");
const workflowPath = path.join(root, ".github/workflows/release-npm-backfill.yml");
const runnerPolicyPath = path.join(root, ".github/config/self-hosted-runner-policy.json");
const sourceJobsPath = path.join(root, "scripts/ci-release-source-jobs.jq");

describe("release npm backfill publish semantics", () => {
	it("keeps platform binaries out of the umbrella native package", async () => {
		const packRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-native-pack-"));
		try {
			await fs.mkdir(path.join(packRoot, "native"));
			await fs.copyFile(path.join(nativesPackageRoot, "package.json"), path.join(packRoot, "package.json"));
			await fs.copyFile(path.join(nativesPackageRoot, "README.md"), path.join(packRoot, "README.md"));
			for (const filename of ["embedded-addon.js", "index.d.ts", "index.js"]) {
				await fs.copyFile(
					path.join(nativesPackageRoot, "native", filename),
					path.join(packRoot, "native", filename),
				);
			}
			await fs.writeFile(path.join(packRoot, "native", "native-manifest.json"), "{}\n");
			await fs.writeFile(path.join(packRoot, "native", "pi_natives.linux-x64-modern.node"), "native addon");

			const packed = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], {
				cwd: packRoot,
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(packed.exitCode).toBe(0);
			const [manifest] = JSON.parse(packed.stdout.toString()) as Array<{ files: Array<{ path: string }> }>;
			const files = manifest.files.map(file => file.path);
			expect(files).toContain("native/index.js");
			expect(files).toContain("native/index.d.ts");
			expect(files).toContain("native/native-manifest.json");
			expect(files.some(file => file.endsWith(".node"))).toBe(false);
		} finally {
			await fs.rm(packRoot, { recursive: true, force: true });
		}
	});

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

	it("recognizes the exact version when npm reports it is still staged", () => {
		const output = 'npm error 409 Conflict - Cannot publish over previously staged version "21.11.1".';
		expect(isAlreadyPublished(output, "21.11.1")).toBe(true);
		expect(isAlreadyPublished(output, "21.11.0")).toBe(false);
	});

	it("adds an explicit non-latest dist-tag for backfills", () => {
		expect(npmPublishArgs()).toEqual(["npm", "publish", "--access", "public", "--provenance"]);
		expect(npmPublishArgs("backfill")).toEqual([
			"npm",
			"publish",
			"--access",
			"public",
			"--provenance",
			"--tag",
			"backfill",
		]);
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

	it("skips publishing an exact version that is already visible", async () => {
		let publishes = 0;
		let visibilityChecks = 0;
		const attempt = await publishWithRetry("@f5-sales-demo/pi-utils", "21.43.3", {
			lookupExisting: async () => '"21.43.3"',
			publish: async () => {
				publishes++;
				return { exitCode: 1, output: "must not publish" };
			},
			waitForVisibility: async () => {
				visibilityChecks++;
			},
		});

		expect(attempt).toBe(0);
		expect(publishes).toBe(0);
		expect(visibilityChecks).toBe(0);
	});

	it("continues immediately after npm accepts a missing exact version", async () => {
		for (const existing of [null, '"21.43.2"']) {
			let publishes = 0;
			let visibilityChecks = 0;
			const attempt = await publishWithRetry("@f5-sales-demo/pi-utils", "21.43.3", {
				lookupExisting: async () => existing,
				publish: async () => {
					publishes++;
					return { exitCode: 0, output: "package accepted" };
				},
				waitForVisibility: async () => {
					visibilityChecks++;
				},
			});

			expect(attempt).toBe(1);
			expect(publishes).toBe(1);
			expect(visibilityChecks).toBe(0);
		}
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

	it("allows registry visibility after the former default retry limit", async () => {
		let lookups = 0;
		const attempts = await waitForRegistryVisibility("@f5-sales-demo/pi-agent-core", "21.0.0", {
			lookup: async () => {
				lookups++;
				return lookups === 17 ? '"21.0.0"' : null;
			},
			sleep: async () => {},
		});

		expect(attempts).toBe(17);
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

	it("retries an exact staged-version conflict until it is visible", async () => {
		let publishes = 0;
		let visibilityChecks = 0;
		const sleeps: number[] = [];
		const attempt = await publishWithRetry("@f5-sales-demo/pi-natives-linux-arm64-gnu", "21.11.1", {
			publish: async () => {
				publishes++;
				return { exitCode: 1, output: 'Cannot publish over previously staged version "21.11.1".' };
			},
			waitForVisibility: async () => {
				visibilityChecks++;
				if (visibilityChecks === 1) throw new Error("not visible");
			},
			sleep: async delayMs => {
				sleeps.push(delayMs);
			},
			initialDelayMs: 5,
			maxAttempts: 3,
		});

		expect(attempt).toBe(2);
		expect(publishes).toBe(2);
		expect(visibilityChecks).toBe(2);
		expect(sleeps).toEqual([5]);
	});

	it("bounds repeated publish failures", async () => {
		const sleeps: number[] = [];
		await expect(
			publishWithRetry("@f5-sales-demo/pi-utils", "21.11.1", {
				publish: async () => ({ exitCode: 1, output: "temporary registry failure" }),
				waitForVisibility: async () => {
					throw new Error("must not run");
				},
				sleep: async delayMs => {
					sleeps.push(delayMs);
				},
				initialDelayMs: 5,
				maxDelayMs: 10,
				maxAttempts: 3,
			}),
		).rejects.toThrow("after 3 attempts");
		expect(sleeps).toEqual([5, 10]);
	});

	it("waits for every accepted package at one final visibility barrier", async () => {
		const checked: string[] = [];
		await waitForPublishedPackages(
			[
				{ name: "@f5-sales-demo/pi-natives-linux-arm64-gnu", version: "21.11.1" },
				{ name: "@f5-sales-demo/pi-utils", version: "21.11.1" },
			],
			async (packageName, version) => {
				checked.push(`${packageName}@${version}`);
				return 1;
			},
		);

		expect(checked).toEqual(["@f5-sales-demo/pi-natives-linux-arm64-gnu@21.11.1", "@f5-sales-demo/pi-utils@21.11.1"]);
	});
});

describe("release npm backfill workflow contract", () => {
	it("uses hosted OIDC publishing with a supported pinned Node and npm", async () => {
		const workflow = await fs.readFile(ciWorkflowPath, "utf8");
		const jobStart = workflow.indexOf("  publish-npm:");
		const jobEnd = workflow.indexOf("\n  verify-npm-install:", jobStart);
		expect(jobStart).toBeGreaterThan(-1);
		expect(jobEnd).toBeGreaterThan(jobStart);
		const publishJob = workflow.slice(jobStart, jobEnd);
		expect(publishJob).toContain("runs-on: ubuntu-22.04");
		expect(publishJob).toContain("timeout-minutes: 90");
		expect(publishJob).toContain("id-token: write");
		expect(publishJob).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
		expect(publishJob).toContain('node-version: "22.14.0"');
		expect(publishJob).toContain("npm install --global npm@11.19.1");
		expect(publishJob).not.toContain("NPM_TOKEN");
		expect(publishJob).not.toContain("NODE_AUTH_TOKEN");
		expect(publishJob).not.toContain("_authToken");

		const backfillWorkflow = await fs.readFile(workflowPath, "utf8");
		expect(backfillWorkflow).toContain("runs-on: ubuntu-22.04");
		expect(backfillWorkflow).toContain("timeout-minutes: 90");
		expect(backfillWorkflow).toContain("id-token: write");
		expect(backfillWorkflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
		expect(backfillWorkflow).toContain('node-version: "22.14.0"');
		expect(backfillWorkflow).toContain("npm install --global npm@11.19.1");
		expect(backfillWorkflow).not.toContain("NPM_TOKEN");
		expect(backfillWorkflow).not.toContain("NODE_AUTH_TOKEN");
		expect(backfillWorkflow).not.toContain("_authToken");

		const runnerPolicy = JSON.parse(await fs.readFile(runnerPolicyPath, "utf8"));
		const xcshHosted = runnerPolicy.hosted_exceptions["f5-sales-demo/xcsh"];
		expect(xcshHosted[".github/workflows/ci.yml"]["publish-npm"].runs_on).toBe("ubuntu-22.04");
		expect(xcshHosted[".github/workflows/release-npm-backfill.yml"].backfill.runs_on).toBe("ubuntu-22.04");
	});

	it("binds a manual backfill to an immutable tag and original run", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("tag:");
		expect(workflow).toContain("source_run_id:");
		expect(workflow).toContain('event == "push"');
		expect(workflow).toContain("head_branch == $tag");
		expect(workflow).toContain("head_sha == $tag_sha");
		expect(workflow).toContain(".immutable == true");
		expect(workflow).toContain('jq -e -f scripts/ci-release-source-jobs.jq <<<"$jobs"');

		const sourceJobs = await fs.readFile(sourceJobsPath, "utf8");
		expect(sourceJobs).toContain('"check"');
		expect(sourceJobs).toContain('"test"');
		expect(sourceJobs).toContain('"Test installation methods"');
		expect(sourceJobs).toContain('startswith("Native build (")');
		expect(sourceJobs).toContain('.conclusion == "success"');
	});

	it("publishes from the isolated tag checkout without moving latest", async () => {
		const workflow = await fs.readFile(workflowPath, "utf8");
		expect(workflow).toContain("path: .release-source");
		expect(workflow).toContain("XCSH_RELEASE_SOURCE_ROOT:");
		expect(workflow).toContain("bun scripts/ci-release-publish.ts --tag backfill");
		expect(workflow).not.toContain("NPM_TOKEN");
		expect(workflow).toContain("dist-tags.latest");
		expect(workflow).toContain("LATEST_BEFORE");
		expect(workflow).toContain("@f5-sales-demo/xcsh@");
	});
});
