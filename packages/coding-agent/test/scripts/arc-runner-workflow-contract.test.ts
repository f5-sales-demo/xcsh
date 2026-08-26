import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { parse } from "yaml";

interface WorkflowStep {
	run?: unknown;
	uses?: unknown;
}

interface WorkflowJob {
	if?: unknown;
	"runs-on"?: unknown;
	needs?: unknown;
	steps?: WorkflowStep[];
}

interface WorkflowDocument {
	jobs?: Record<string, WorkflowJob>;
	permissions?: unknown;
}

interface LoadedWorkflow {
	document: WorkflowDocument;
	path: string;
	source: string;
}

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../../..");
const WORKFLOW_ROOT = path.join(REPOSITORY_ROOT, ".github/workflows");
const WORKFLOW_DIRECTORIES = [
	WORKFLOW_ROOT,
	path.join(REPOSITORY_ROOT, ".github/workflows-disabled"),
	path.join(REPOSITORY_ROOT, ".github/disabled-workflows"),
];
const CACHE_SMOKE_WORKFLOW = path.join(WORKFLOW_ROOT, "self-hosted-runner-cache-smoke.yml");
const COMPATIBILITY_WORKFLOW = path.join(WORKFLOW_ROOT, "arc-compatibility.yml");

async function collectYamlFiles(directory: string): Promise<string[]> {
	if (!existsSync(directory)) return [];

	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const candidate = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectYamlFiles(candidate)));
		} else if (/\.ya?ml$/.test(entry.name)) {
			files.push(candidate);
		}
	}
	return files.sort();
}

async function loadWorkflowInventory(): Promise<LoadedWorkflow[]> {
	const paths = (await Promise.all(WORKFLOW_DIRECTORIES.map(collectYamlFiles))).flat().sort();
	return await Promise.all(
		paths.map(async workflowPath => {
			const source = await Bun.file(workflowPath).text();
			return {
				document: parse(source) as WorkflowDocument,
				path: path.relative(REPOSITORY_ROOT, workflowPath),
				source,
			};
		}),
	);
}

function embeddedMatrixRows(source: string): Array<Record<string, unknown>> {
	const rows: Array<Record<string, unknown>> = [];
	for (const match of source.matchAll(/fromJSON\('(\[[\s\S]*?\])'\)/g)) {
		const parsed = JSON.parse(match[1] ?? "null");
		if (!Array.isArray(parsed)) throw new Error("fromJSON workflow matrix must be an array");
		for (const value of parsed) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				throw new Error("fromJSON workflow matrix row must be an object");
			}
			rows.push(value as Record<string, unknown>);
		}
	}
	return rows;
}

function jobUsesDocker(job: WorkflowJob): boolean {
	return (
		job.steps?.some(step => {
			if (typeof step.uses === "string" && step.uses.startsWith("docker/")) return true;
			if (typeof step.run !== "string") return false;
			return (
				/^\s*docker(?:\s|$)/m.test(step.run) || /scripts\/(?:tdd-docker|ci-verify-npm-debian)\.sh/.test(step.run)
			);
		}) ?? false
	);
}

test("all workflow inventories reject retired xcsh label arrays, including embedded matrices", async () => {
	const workflows = await loadWorkflowInventory();
	const retiredRoutes = [
		["self-hosted", "Linux", "X64", "xcsh", "ubuntu-24.04"],
		["self-hosted", "Linux", "X64", "xcsh", "container-build"],
	];
	const observedArcRoutes = new Set<string>();

	expect(workflows.length).toBeGreaterThan(0);
	for (const workflow of workflows) {
		for (const job of Object.values(workflow.document.jobs ?? {})) {
			const route = job["runs-on"];
			if (typeof route === "string" && route.startsWith("xcsh-")) observedArcRoutes.add(route);
			for (const retiredRoute of retiredRoutes) expect(route, workflow.path).not.toEqual(retiredRoute);
		}
		for (const row of embeddedMatrixRows(workflow.source)) {
			const route = row.runner;
			if (typeof route === "string" && route.startsWith("xcsh-")) observedArcRoutes.add(route);
			for (const retiredRoute of retiredRoutes) expect(route, workflow.path).not.toEqual(retiredRoute);
			if (row.os === "ubuntu-24.04" && route !== undefined) {
				expect(route, workflow.path).toBe("xcsh-socketless");
			}
		}
	}

	expect(observedArcRoutes).toEqual(new Set(["xcsh-container-build", "xcsh-socketless"]));
});

test("Docker consumers use the container pool and every trust gate is socketless", async () => {
	const workflows = await loadWorkflowInventory();
	const trustGates: string[] = [];
	const dockerConsumers: string[] = [];

	for (const workflow of workflows) {
		for (const [jobId, job] of Object.entries(workflow.document.jobs ?? {})) {
			const location = `${workflow.path}:${jobId}`;
			if (jobId === "trust-gate") {
				trustGates.push(location);
				expect(job["runs-on"], location).toBe("xcsh-socketless");
				continue;
			}
			if (jobUsesDocker(job)) {
				dockerConsumers.push(location);
				expect(job["runs-on"], location).toBe("xcsh-container-build");
			}
		}
	}

	expect(trustGates.sort()).toEqual([
		".github/workflows/ci.yml:trust-gate",
		".github/workflows/container.yml:trust-gate",
		".github/workflows/self-hosted-runner-cache-smoke.yml:trust-gate",
	]);
	expect(dockerConsumers).toContain(".github/workflows/ci.yml:verify-npm-debian");
	expect(dockerConsumers).toContain(".github/workflows/container.yml:container-build");
	expect(dockerConsumers).toContain(".github/workflows/container.yml:publish-ghcr");
	expect(dockerConsumers).toContain(".github/workflows/self-hosted-runner-cache-smoke.yml:container-build-smoke");
	expect(dockerConsumers).toContain(".github/workflows/arc-compatibility.yml:container");
});

test("repository-specific managed callers use the socketless ARC route", async () => {
	const expectedJobs: Record<string, string[]> = {
		"auto-merge.yml": ["require-token"],
		"dependabot-auto-merge.yml": ["auto-merge"],
		"semgrep.yml": ["semgrep"],
		"super-linter.yml": ["linked-issue"],
		"translation-audit.yml": ["audit"],
		"workflow-security-audit.yml": ["audit"],
	};

	for (const [workflowName, jobIds] of Object.entries(expectedJobs)) {
		const document = parse(await Bun.file(path.join(WORKFLOW_ROOT, workflowName)).text()) as WorkflowDocument;
		for (const jobId of jobIds) {
			expect(document.jobs?.[jobId]?.["runs-on"], `${workflowName}:${jobId}`).toBe("xcsh-socketless");
		}
	}
});

test("cache smoke requires and validates the ARC-provided Unix Docker endpoint", async () => {
	const source = await Bun.file(CACHE_SMOKE_WORKFLOW).text();

	expect(source).toMatch(/\$\{DOCKER_HOST:\?ARC DinD must provide DOCKER_HOST\}/);
	expect(source).toMatch(/\$\{DOCKER_HOST#unix:\/\/\}/);
	expect(source).toContain('test -S "$docker_socket"');
	expect(source).toContain('test "$docker_socket" != /run/docker.sock');
	expect(source).not.toContain("${DOCKER_HOST:=");
	expect(source).toContain("docker version");
	expect(source).toContain("docker buildx version");
	expect(source).toContain("docker compose version");
	expect(source).toContain("docker build --tag");
	expect(source).toContain('docker image inspect "$image"');
});

test("release Docker jobs remain tag-only and preserve their release dependencies", async () => {
	const releaseCondition = "startsWith(github.ref, 'refs/tags/v')";
	const containerWorkflow = parse(
		await Bun.file(path.join(WORKFLOW_ROOT, "container.yml")).text(),
	) as WorkflowDocument;
	const ciWorkflow = parse(await Bun.file(path.join(WORKFLOW_ROOT, "ci.yml")).text()) as WorkflowDocument;

	expect(containerWorkflow.jobs?.["publish-ghcr"]?.if).toBe(releaseCondition);
	expect(containerWorkflow.jobs?.["publish-ghcr"]?.needs).toEqual(["container-test"]);
	expect(ciWorkflow.jobs?.["trust-gate"]?.if).toBe(releaseCondition);
	expect(ciWorkflow.jobs?.["trust-gate"]?.needs).toBe("verify-npm-install");
	expect(ciWorkflow.jobs?.["verify-npm-debian"]?.if).toBe(releaseCondition);
	expect(ciWorkflow.jobs?.["verify-npm-debian"]?.needs).toEqual(["verify-npm-install", "trust-gate"]);
});

test("manual ARC compatibility covers both profiles without publication mutation", async () => {
	const source = await Bun.file(COMPATIBILITY_WORKFLOW).text();
	const workflow = parse(source) as WorkflowDocument;

	expect(workflow.jobs?.socketless?.["runs-on"]).toBe("xcsh-socketless");
	expect(workflow.jobs?.container?.["runs-on"]).toBe("xcsh-container-build");
	expect(source).toContain("oven-sh/setup-bun@");
	expect(source).toContain("uses: ./.github/actions/setup-rust");
	expect(source).toContain("uses: ./.github/actions/setup-zig");
	expect(source).toContain("aarch64-unknown-linux-gnu");
	expect(source).toContain("TARGET_ARCH=x64");
	expect(source).toContain("TARGET_ARCH=arm64");
	expect(source).toMatch(/\$\{DOCKER_HOST:\?ARC DinD must provide DOCKER_HOST\}/);
	expect(source).toContain("docker buildx version");
	expect(source).toContain("docker compose version");
	expect(source).toContain("scripts/ci-verify-npm-debian.sh");
	expect(source).toContain("scripts/test-uat-podman-arm64.sh");
	expect(source).not.toMatch(
		/docker\/login-action|docker\/build-push-action|npm publish|gh release|git tag|push: true/,
	);
	expect(workflow.permissions).toEqual({ contents: "read" });
});
