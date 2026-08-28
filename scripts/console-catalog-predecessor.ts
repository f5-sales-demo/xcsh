import { appendFile } from "node:fs/promises";

const BRANCH_PREFIX = "chore/console-catalog-";
const BRANCH_PATTERN = /^chore\/console-catalog-([0-9a-f]{40})$/;

export interface CatalogPullRequest {
	number: number;
	headRefName: string;
	headRepositoryOwner: { login: string } | null;
	isCrossRepository: boolean;
	state: string;
	title: string;
	body: string;
}

export interface CatalogIssue {
	number: number;
	state: string;
	title: string;
}

export interface ConsoleCatalogGitHub {
	listOpenPullRequests(): Promise<CatalogPullRequest[]>;
	getIssue(number: number): Promise<CatalogIssue>;
	closeIssue(number: number): Promise<void>;
	closePullRequest(number: number): Promise<void>;
	getPullRequest(number: number): Promise<CatalogPullRequest>;
	branchExists(name: string): Promise<boolean>;
	deleteBranch(name: string): Promise<void>;
}

export interface ReconcileOptions {
	repository: string;
	successorBranch: string;
}

export interface ReconcileResult {
	successorExists: boolean;
	superseded: number;
}

interface VerifiedPredecessor {
	pullRequest: CatalogPullRequest;
	issue: CatalogIssue;
}

function linkedIssueNumber(body: string): number {
	const matches = [...body.matchAll(/^Closes #(\d+)\s*$/gim)];
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one linked tracking issue, found ${matches.length}`);
	}
	return Number(matches[0][1]);
}

function verifyPullRequest(pr: CatalogPullRequest, repositoryOwner: string): string {
	const match = BRANCH_PATTERN.exec(pr.headRefName);
	if (!match) throw new Error(`Refusing invalid console-catalog branch: ${pr.headRefName}`);
	if (pr.isCrossRepository || pr.headRepositoryOwner?.login !== repositoryOwner) {
		throw new Error(`Refusing non-repository console-catalog branch: ${pr.headRefName}`);
	}
	if (pr.state !== "OPEN") throw new Error(`Expected PR #${pr.number} to be open`);
	const sha = match[1];
	const expectedTitle = `fix(coding-agent): refresh embedded console catalog to console@${sha}`;
	if (pr.title !== expectedTitle) throw new Error(`PR #${pr.number} has an unexpected title`);
	return sha;
}

/**
 * Close only verified, same-repository console-catalog predecessors. Validation of every candidate
 * and linked issue completes before the first mutation, so malformed state fails closed.
 */
export async function reconcileConsoleCatalogPredecessors(
	options: ReconcileOptions,
	github: ConsoleCatalogGitHub,
): Promise<ReconcileResult> {
	if (!BRANCH_PATTERN.test(options.successorBranch)) {
		throw new Error(`Invalid successor branch: ${options.successorBranch}`);
	}
	const repositoryOwner = options.repository.split("/", 1)[0];
	if (!repositoryOwner) throw new Error(`Invalid repository: ${options.repository}`);

	const candidates = (await github.listOpenPullRequests()).filter(pr => pr.headRefName.startsWith(BRANCH_PREFIX));
	const predecessors: VerifiedPredecessor[] = [];
	let successorExists = false;

	for (const pullRequest of candidates) {
		const sha = verifyPullRequest(pullRequest, repositoryOwner);
		const issueNumber = linkedIssueNumber(pullRequest.body);
		const issue = await github.getIssue(issueNumber);
		const expectedIssueTitle = `chore: refresh embedded console catalog to console@${sha}`;
		if (issue.number !== issueNumber || issue.title !== expectedIssueTitle) {
			throw new Error(`PR #${pullRequest.number} does not identify its exact generated tracking issue`);
		}
		if (pullRequest.headRefName === options.successorBranch) {
			if (issue.state !== "OPEN") {
				throw new Error(`Existing successor PR #${pullRequest.number} has no open tracking issue`);
			}
			if (!(await github.branchExists(pullRequest.headRefName))) {
				throw new Error(`Existing successor PR #${pullRequest.number} has no source branch`);
			}
			if (successorExists) throw new Error("More than one open successor PR was returned");
			successorExists = true;
		} else {
			predecessors.push({ pullRequest, issue });
		}
	}

	for (const { pullRequest, issue } of predecessors) {
		if (issue.state === "OPEN") await github.closeIssue(issue.number);
		await github.closePullRequest(pullRequest.number);
		const closed = await github.getPullRequest(pullRequest.number);
		if (closed.state !== "CLOSED" || closed.headRefName !== pullRequest.headRefName) {
			throw new Error(`PR #${pullRequest.number} did not close with its verified head intact`);
		}
		if (await github.branchExists(pullRequest.headRefName)) {
			await github.deleteBranch(pullRequest.headRefName);
		}
	}

	return { successorExists, superseded: predecessors.length };
}

async function command(args: string[]): Promise<string> {
	const process = Bun.spawn(args, { stdout: "pipe", stderr: "inherit" });
	const output = await new Response(process.stdout).text();
	const status = await process.exited;
	if (status !== 0) throw new Error(`${args[0]} command failed with status ${status}`);
	return output.trim();
}

function cli(repository: string): ConsoleCatalogGitHub {
	return {
		async listOpenPullRequests() {
			return JSON.parse(
				await command([
					"gh", "pr", "list", "--repo", repository, "--state", "open", "--base", "main", "--limit", "100",
					"--json", "number,headRefName,headRepositoryOwner,isCrossRepository,state,title,body",
				]),
			) as CatalogPullRequest[];
		},
		async getIssue(number) {
			return JSON.parse(await command(["gh", "issue", "view", String(number), "--repo", repository, "--json", "number,state,title"]));
		},
		async closeIssue(number) {
			await command(["gh", "issue", "close", String(number), "--repo", repository, "--comment", "Superseded by a newer automated console-catalog refresh."]);
		},
		async closePullRequest(number) {
			await command(["gh", "pr", "close", String(number), "--repo", repository, "--comment", "Superseded by a newer automated console-catalog refresh."]);
		},
		async getPullRequest(number) {
			return JSON.parse(await command(["gh", "pr", "view", String(number), "--repo", repository, "--json", "number,headRefName,headRepositoryOwner,isCrossRepository,state,title,body"]));
		},
		async branchExists(name) {
			const refs = JSON.parse(
				await command(["gh", "api", `repos/${repository}/git/matching-refs/heads/${name}`]),
			) as Array<{ ref?: string }>;
			return refs.some(candidate => candidate.ref === `refs/heads/${name}`);
		},
		async deleteBranch(name) {
			await command(["gh", "api", "--method", "DELETE", `repos/${repository}/git/refs/heads/${name}`]);
		},
	};
}

if (import.meta.main) {
	const repository = process.env.GITHUB_REPOSITORY;
	const successorBranch = process.env.SUCCESSOR_BRANCH;
	if (!repository || !successorBranch) throw new Error("GITHUB_REPOSITORY and SUCCESSOR_BRANCH are required");
	const result = await reconcileConsoleCatalogPredecessors({ repository, successorBranch }, cli(repository));
	const output = process.env.GITHUB_OUTPUT;
	if (!output) throw new Error("GITHUB_OUTPUT is required");
	await appendFile(output, `successor_exists=${result.successorExists}\nsuperseded=${result.superseded}\n`);
}
