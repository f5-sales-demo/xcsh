import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
	type CatalogIssue,
	type CatalogPullRequest,
	type ConsoleCatalogGitHub,
	reconcileConsoleCatalogPredecessors,
} from "../../../../scripts/console-catalog-predecessor";

const repository = "f5-sales-demo/xcsh";
const prefix = "chore/console-catalog-";

function branch(sha: string): string {
	return `${prefix}${sha}`;
}

function pullRequest(number: number, sha: string, issue: number): CatalogPullRequest {
	return {
		number,
		headRefName: branch(sha),
		headRepositoryOwner: { login: "f5-sales-demo" },
		isCrossRepository: false,
		state: "OPEN",
		title: `fix(coding-agent): refresh embedded console catalog to console@${sha}`,
		body: `Automated refresh.\n\nCloses #${issue}`,
	};
}

function issue(number: number, sha: string): CatalogIssue {
	return {
		number,
		state: "OPEN",
		title: `chore: refresh embedded console catalog to console@${sha}`,
	};
}

class FakeGitHub implements ConsoleCatalogGitHub {
	pullRequests: CatalogPullRequest[] = [];
	issues = new Map<number, CatalogIssue>();
	branches = new Set<string>();
	calls: string[] = [];

	async listOpenPullRequests(): Promise<CatalogPullRequest[]> {
		return this.pullRequests.filter(pr => pr.state === "OPEN");
	}

	async getIssue(number: number): Promise<CatalogIssue> {
		const value = this.issues.get(number);
		if (!value) throw new Error(`missing issue ${number}`);
		return value;
	}

	async closeIssue(number: number): Promise<void> {
		this.calls.push(`issue:${number}`);
		this.issues.get(number)!.state = "CLOSED";
	}

	async closePullRequest(number: number): Promise<void> {
		this.calls.push(`pr:${number}`);
		this.pullRequests.find(pr => pr.number === number)!.state = "CLOSED";
	}

	async getPullRequest(number: number): Promise<CatalogPullRequest> {
		return this.pullRequests.find(pr => pr.number === number)!;
	}

	async branchExists(name: string): Promise<boolean> {
		return this.branches.has(name);
	}

	async deleteBranch(name: string): Promise<void> {
		this.calls.push(`branch:${name}`);
		this.branches.delete(name);
	}
}

describe("console catalog predecessor reconciliation", () => {
	it("leaves exactly one live PR and issue after two distinct dispatches", async () => {
		const github = new FakeGitHub();
		const firstSha = "1".repeat(40);
		const secondSha = "2".repeat(40);

		const dispatch = async (sha: string, prNumber: number, issueNumber: number) => {
			const result = await reconcileConsoleCatalogPredecessors({ repository, successorBranch: branch(sha) }, github);
			if (!result.successorExists) {
				github.pullRequests.push(pullRequest(prNumber, sha, issueNumber));
				github.issues.set(issueNumber, issue(issueNumber, sha));
				github.branches.add(branch(sha));
			}
		};

		await dispatch(firstSha, 101, 100);
		await dispatch(secondSha, 103, 102);

		expect(github.pullRequests.filter(pr => pr.state === "OPEN").map(pr => pr.number)).toEqual([103]);
		expect([...github.issues.values()].filter(item => item.state === "OPEN").map(item => item.number)).toEqual([102]);
		expect(github.branches).toEqual(new Set([branch(secondSha)]));
		expect(github.calls).toEqual([`issue:100`, `pr:101`, `branch:${branch(firstSha)}`]);
	});

	it("reuses an already-open successor without closing it", async () => {
		const github = new FakeGitHub();
		const sha = "a".repeat(40);
		github.pullRequests.push(pullRequest(201, sha, 200));
		github.issues.set(200, issue(200, sha));
		github.branches.add(branch(sha));

		const result = await reconcileConsoleCatalogPredecessors({ repository, successorBranch: branch(sha) }, github);

		expect(result).toEqual({ successorExists: true, superseded: 0 });
		expect(github.calls).toEqual([]);
	});

	it("fails closed before touching a same-prefix branch with an invalid identity", async () => {
		const github = new FakeGitHub();
		github.pullRequests.push({ ...pullRequest(301, "3".repeat(40), 300), headRefName: `${prefix}not-a-sha` });

		await expect(
			reconcileConsoleCatalogPredecessors({ repository, successorBranch: branch("4".repeat(40)) }, github),
		).rejects.toThrow(/invalid console-catalog branch/);
		expect(github.calls).toEqual([]);
	});
});

describe("console catalog workflow contract", () => {
	it("cleans a verified predecessor before creating the successor", async () => {
		const root = path.resolve(import.meta.dir, "../../../..");
		const workflow = parseYaml(
			await Bun.file(path.join(root, ".github/workflows/console-catalog-update.yml")).text(),
		) as {
			jobs: Record<
				string,
				{ steps: Array<{ name?: string; if?: string; env?: Record<string, string>; run?: string }> }
			>;
		};
		const steps = workflow.jobs["update-console-catalog"].steps;
		const cleanup = steps.findIndex(step => step.name === "Close superseded console-catalog PR");
		const create = steps.findIndex(
			step => step.name === "Create issue and auto-merging PR with the refreshed catalog",
		);

		expect(cleanup).toBeGreaterThan(-1);
		expect(create).toBeGreaterThan(cleanup);
		expect(steps[cleanup].run).toContain("console-catalog-predecessor.ts");
		expect(steps[cleanup].env?.SUCCESSOR_BRANCH).toContain("steps.changes.outputs.catalog_version");
		expect(steps[create].if).toContain("steps.predecessor.outputs.successor_exists != 'true'");
	});
});
